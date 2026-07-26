import { listRecords, updateRecord } from "../lib/db";
import type { FieldProvenance, IonicRecord } from "../lib/schema";

function numericId(id: string): number {
  return Number(id.replace(/\D/g, "")) || 0;
}

function fpNumber(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "" : value.toPrecision(8);
}

function evidenceKey(record: IonicRecord): string {
  return [record.paper.title, fpNumber(record.extended.velocity?.std)].join("|");
}

function inferredFromScan(record: IonicRecord): FieldProvenance | null {
  const scan = record.provenance?.scanRate ?? record.provenance?.scanSize;
  if (!scan) return null;
  return {
    ...scan,
    basis: scan.basis === "assumed" ? "assumed" : "inferred",
    basisNote:
      scan.basisNote ??
      "Velocity standardized from the AFM scan parameters; inspect scanRate/scanSize evidence for the reported basis.",
  };
}

function main() {
  const write = process.argv.includes("--write");
  const minIdArg = process.argv.find((arg) => arg.startsWith("--min-id="));
  const minId = minIdArg ? Number(minIdArg.slice("--min-id=".length)) : 109;
  const records = listRecords("tribology", { status: "official" }) as IonicRecord[];
  const byVelocity = new Map<string, FieldProvenance>();
  for (const record of records) {
    if (record.extended.velocity?.std != null && record.provenance?.velocity) {
      byVelocity.set(evidenceKey(record), record.provenance.velocity);
    }
  }

  let candidates = 0;
  let fromSibling = 0;
  let fromScan = 0;
  let missing = 0;

  for (const record of records) {
    if (numericId(record.id) < minId || !record.extended.velocity || record.provenance?.velocity) continue;
    candidates++;
    const sibling = byVelocity.get(evidenceKey(record));
    const prov = sibling ?? inferredFromScan(record);
    if (!prov) {
      missing++;
      continue;
    }
    if (sibling) fromSibling++;
    else fromScan++;
    if (write) updateRecord("tribology", record.id, { setProvenance: { field: "velocity", prov } });
  }

  console.log(`velocityProvenance.candidates=${candidates}`);
  console.log(`velocityProvenance.fromSibling=${fromSibling}`);
  console.log(`velocityProvenance.fromScan=${fromScan}`);
  console.log(`velocityProvenance.missing=${missing}`);
  console.log(write ? "velocityProvenance.write=done" : "dry-run only; pass --write to update records");
}

main();
