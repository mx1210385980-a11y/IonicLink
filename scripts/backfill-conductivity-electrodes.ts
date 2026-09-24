import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  backupDomainDatabase,
  getSource,
  listRecords,
  updateRecord,
} from "../lib/db";
import { buildConductivityCellModel } from "../lib/conductivity/electrodes";
import { toFields } from "../lib/conductivity/ingest";
import type {
  ConductivityExtractedFields,
  ConductivityRecord,
} from "../lib/conductivity/schema";
import type { FieldProvenance, SourceDoc } from "../lib/schema";

type ElectrodeField =
  | "cellConfiguration"
  | "cellSetup"
  | "workingElectrode"
  | "counterElectrode"
  | "referenceElectrode";

type ElectrodeValues = Pick<ConductivityExtractedFields, ElectrodeField>;

interface BackfillRule {
  key: string;
  title: string;
  ids?: string[];
  evidence: RegExp;
  values: (record: ConductivityRecord) => ElectrodeValues;
  inferredFields?: ElectrodeField[];
  basisNote?: string;
}

const range = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, index) => `#${String(start + index).padStart(3, "0")}`);

const RULES: BackfillRule[] = [
  {
    key: "pyr13-na-swage",
    title: "Physicochemical and electrochemical properties of Pyr13TFSI/NaTFSI electrolytes",
    evidence: /three-electrodes\s+Swagelok-type\s+cells\s+employing\s+carbon-coated\s+aluminum\s+as\s+working,\s+Na\s+metal\s+both\s+as\s+counter\s+and\s+reference\s+electrode/i,
    values: () => ({
      cellConfiguration: "three-electrode",
      cellSetup: "three-electrode Swagelok-type cell",
      workingElectrode: "carbon-coated aluminum",
      counterElectrode: "Na metal",
      referenceElectrode: "Na metal",
    }),
  },
  {
    key: "ilbmb-sensor",
    title: "ILBMB/rGO-Au nanoparticle electrochemical sensor",
    evidence: /three-electrode\s+system\s+with\s+CPO-\s*ILBMB\/rGO-Au\s+NPs\/GCE,\s+a\s+saturated\s+calomel\s+electrode,\s+and\s+a\s+carbon\s+rod\s+serve\s+as\s+the\s+working\s+electrode,\s+reference\s+electrode,\s+and\s+auxiliary\s+electrode\s+respectively/i,
    values: (record) => ({
      cellConfiguration: "three-electrode",
      cellSetup: "three-electrode system",
      workingElectrode: record.core.surface,
      counterElectrode: "carbon rod",
      referenceElectrode: "saturated calomel electrode (SCE)",
    }),
    inferredFields: ["workingElectrode"],
    basisNote: "The paper states that all electrochemical tests used this three-electrode system; the record-specific working-electrode assembly is taken from the curated surface field.",
  },
  {
    key: "niba-sensor",
    title: "NIBA ionic-liquid/MWCNT electrochemical interface",
    evidence: /conventional\s+three\s+electrode\s+system,\s+consisting\s+of\s+a\s+modified\/unmodified\s+GCE\s+as\s+the\s+working\s+electrode,\s+a\s+Ag\|AgCl\s+reference\s+electrode\s+and\s+a\s+platinum\s+wire\s+counter\s+electrode/i,
    values: (record) => ({
      cellConfiguration: "three-electrode",
      cellSetup: "conventional three-electrode system",
      workingElectrode: record.core.surface,
      counterElectrode: "platinum wire",
      referenceElectrode: "Ag|AgCl",
    }),
    inferredFields: ["workingElectrode"],
    basisNote: "The methods apply the stated three-electrode system to modified/unmodified GCEs; the exact modification is taken from this record's curated surface field.",
  },
  {
    key: "lanthanide-pt111",
    title: "Lanthanide electrodeposition from [BMP][DCA] on Pt(111)",
    evidence: /The\s+counter\s+electrode\s+was\s+Pt\s+foil\.\s+The\s+reference\s+electrode\s+was\s+a\s+leakless\s+Ag\/AgCl\s+\(Edaq\)\s+reference\s+electrode/i,
    values: (record) => ({
      cellConfiguration: "three-electrode",
      workingElectrode: record.core.surface,
      counterElectrode: "Pt foil",
      referenceElectrode: "leakless Ag/AgCl (Edaq)",
    }),
    inferredFields: ["cellConfiguration", "workingElectrode"],
    basisNote: "The paper explicitly names counter and reference electrodes; the three-electrode classification and Pt(111) working role follow from those roles and the curated measurement surface.",
  },
  {
    key: "mxene-ambipolar",
    title: "Ambipolar electrochemistry of pre-intercalated Ti3C2Tx MXene in ionic liquid",
    evidence: /The\s+3-electrode\s+measure-\s*ments\s+were\s+performed[\s\S]{0,360}?employed\s+as\s+the\s+working\s+electrode\s+with\s+over-capacitive\s+AC\s+film\s+and\s+Ag\s+wire[\s\S]{0,80}?as\s+the\s+counter\s+and\s+reference\s+electrodes,\s+respectively/i,
    values: () => ({
      cellConfiguration: "three-electrode",
      cellSetup: "3-electrode measurement",
      workingElectrode: "pre-intercalated Ti3C2Tx",
      counterElectrode: "over-capacitive activated-carbon film",
      referenceElectrode: "Ag wire",
    }),
  },
  {
    key: "ilemb-sensor",
    title: "ILEMB/Au@MoS2 electrochemical sensor",
    evidence: /using\s+three-electrode\s+system\.\s+The\s+modified\s+glassy\s+carbon\s+electrode\s+was\s+used\s+as\s+the\s+working\s+electrode,\s+the\s+ref-\s*erence\s+electrode\s+was\s+a\s+saturated\s+calomel\s+electrode\s+\(SCE\)\s+and\s+the\s+counter\s+electrode\s+was\s+a\s+platinum\s+electrode/i,
    values: (record) => ({
      cellConfiguration: "three-electrode",
      cellSetup: "three-electrode system",
      workingElectrode: record.core.surface,
      counterElectrode: "platinum electrode",
      referenceElectrode: "saturated calomel electrode (SCE)",
    }),
    inferredFields: ["workingElectrode"],
    basisNote: "The method states a modified glassy-carbon working electrode; the record-specific modification is taken from the curated surface field.",
  },
  {
    key: "multi-methoxy-lsv",
    title: "Ionic liquid electrolytes based on multi-methoxyethyl substituted ammoniums and perfluorinated sulfonimides: Preparation, characterization, and properties",
    ids: range(38, 45),
    evidence: /standard\s+three-electrode\s+cell\s+equipped\s+with\s+a\s+glassy\s+carbon\s+electrode[\s\S]{0,100}?a\s+Pt\s+wire\s+counter\s+electrode,\s+and\s+an\s+I3[−-]\/I[−-]\s+reference\s+electrode/i,
    values: () => ({
      cellConfiguration: "three-electrode",
      cellSetup: "standard three-electrode cell",
      workingElectrode: "glassy carbon electrode",
      counterElectrode: "Pt wire",
      referenceElectrode: "I3−/I− reference electrode",
    }),
  },
  {
    key: "mild-steel-corrosion",
    title: "Experimental, density functional theory and molecular dynamics supported adsorption behavior of environmental benign imidazolium based ionic liquids on mild steel surface in acidic medium",
    evidence: /configured\s+to\s+use\s+three\s+electrodes\s+system\s+with\s+mild\s+steel\s+as\s+working\s+electrode,\s+graphite\s+\(rod\)\s+as\s+counter\s+electrode\s+and\s+Ag\/AgCl\s+as\s+reference\s+electrode/i,
    values: () => ({
      cellConfiguration: "three-electrode",
      cellSetup: "three-electrode system",
      workingElectrode: "mild steel",
      counterElectrode: "graphite rod",
      referenceElectrode: "Ag/AgCl",
    }),
  },
  {
    key: "au-hkl-lsv",
    title: "Dataset of the electrochemical potential windows for the Au(hkl)|ionic liquid interfaces defined by the cut-off current densities",
    evidence: /LSV\s+was\s+performed\s+for\s+Au\(hkl\)\s+working\s+electrodes[\s\S]{0,180}?in\s+three-electrode\s+cells\s+with\s+Pt\s+wires\s+as\s+counter\s+and\s+quasi-reference\s+electrodes/i,
    values: (record) => ({
      cellConfiguration: "three-electrode",
      cellSetup: "three-electrode cell",
      workingElectrode: record.core.surface,
      counterElectrode: "Pt wire",
      referenceElectrode: "Pt wire quasi-reference",
    }),
  },
];

const AMBIGUOUS_TITLES = new Set([
  "Poly(1-acetamide-3-vinylimidazolium bromide) as a corrosion inhibitor",
]);

const CURATED_AUDIT_FILES = [
  "data/conductivity/electrochem-manual-audit.json",
  "data/conductivity/conductivity-corpus-curated-audit.json",
];

function ruleFor(record: ConductivityRecord): BackfillRule | undefined {
  return RULES.find((rule) =>
    rule.title === record.paper.title && (!rule.ids || rule.ids.includes(record.id))
  );
}

function evidenceFrom(source: SourceDoc, pattern: RegExp): Omit<FieldProvenance, "basis" | "basisNote"> | null {
  for (const page of source.pages) {
    const match = page.text.match(pattern);
    if (!match || match.index == null) continue;
    const quote = match[0].trim();
    const start = Math.max(0, match.index - 180);
    const end = Math.min(page.text.length, match.index + match[0].length + 180);
    return {
      page: page.page,
      quote,
      context: page.text.slice(start, end).trim(),
    };
  }
  return null;
}

function mergeProvenance(
  record: ConductivityRecord,
  fields: ElectrodeField[],
  evidence: Omit<FieldProvenance, "basis" | "basisNote">,
  rule: BackfillRule,
) {
  const current = new Map(Object.entries(record.provenance ?? {}));
  for (const field of fields) {
    const inferred = rule.inferredFields?.includes(field) ?? false;
    current.set(field, {
      ...evidence,
      basis: inferred ? "inferred" : "direct",
      ...(inferred && rule.basisNote ? { basisNote: rule.basisNote } : {}),
    });
  }
  return [...current].map(([field, provenance]) => ({ field, ...provenance }));
}

function sameValue(a: unknown, b: unknown): boolean {
  return (a ?? "") === (b ?? "");
}

function syncCuratedAuditFiles(records: ConductivityRecord[]): { files: number; records: number } {
  let syncedFiles = 0;
  let syncedRecords = 0;
  for (const filename of CURATED_AUDIT_FILES) {
    const absolute = path.resolve(filename);
    const document = JSON.parse(readFileSync(absolute, "utf8")) as {
      papers?: Array<{ records?: ConductivityExtractedFields[] }>;
    };
    let fileChanged = false;
    for (const paper of document.papers ?? []) {
      for (const fields of paper.records ?? []) {
        const candidates = records.filter((record) =>
          record.paper.title === fields.paper.title &&
          record.core.ionicLiquid.cation === fields.cation &&
          record.core.ionicLiquid.anion === fields.anion &&
          record.core.surface === (fields.surface ?? "")
        );
        const record = candidates.find((candidate) => {
          const current = toFields(candidate);
          return [
            "conductivity",
            "capacitance",
            "electricField",
            "temperature",
            "electrodePotential",
            "electrochemicalWindow",
            "chargeTransferResistance",
            "viscosity",
            "pressure",
            "waterContent",
            "concentration",
          ].every((key) => sameValue(
            current[key as keyof ConductivityExtractedFields],
            fields[key as keyof ConductivityExtractedFields],
          ));
        });
        if (!record || !ruleFor(record)) continue;
        const current = toFields(record);
        const electrodeFields: ElectrodeField[] = [
          "cellConfiguration",
          "cellSetup",
          "workingElectrode",
          "counterElectrode",
          "referenceElectrode",
        ];
        for (const key of electrodeFields) {
          if (current[key]) fields[key] = current[key];
        }
        const provenance = new Map((fields.provenance ?? []).map((item) => [item.field, item]));
        for (const item of current.provenance ?? []) {
          if (electrodeFields.includes(item.field as ElectrodeField)) provenance.set(item.field, item);
        }
        fields.provenance = [...provenance.values()];
        fileChanged = true;
        syncedRecords += 1;
      }
    }
    if (fileChanged) {
      writeFileSync(absolute, `${JSON.stringify(document, null, 2)}\n`, "utf8");
      syncedFiles += 1;
    }
  }
  return { files: syncedFiles, records: syncedRecords };
}

function main() {
  const write = process.argv.includes("--write") || process.argv.includes("--apply");
  const outputPath = path.resolve(
    write
      ? "data/conductivity/electrode-backfill-audit.json"
      : "data/conductivity/electrode-backfill-preview.json",
  );
  const records = listRecords("conductivity", { status: "official" }) as ConductivityRecord[];
  const evidenceCache = new Map<string, ReturnType<typeof evidenceFrom>>();
  const planned: Array<{
    id: string;
    title: string;
    source: string | null;
    rule: string;
    page: number | null;
    changedFields: ElectrodeField[];
    values: ElectrodeValues;
  }> = [];
  const missingEvidence: Array<{ id: string; title: string; rule: string }> = [];
  const notApplicable: Array<{ id: string; title: string; method?: string; surface: string }> = [];
  const manualReview: Array<{ id: string; title: string; reason: string }> = [];

  for (const record of records) {
    const rule = ruleFor(record);
    if (!rule) {
      const model = buildConductivityCellModel(record);
      if (model.applicability === "not-applicable") {
        notApplicable.push({
          id: record.id,
          title: record.paper.title,
          method: record.extended.method,
          surface: record.core.surface,
        });
      } else if (model.configuration === "unknown") {
        manualReview.push({
          id: record.id,
          title: record.paper.title,
          reason: AMBIGUOUS_TITLES.has(record.paper.title)
            ? "Electrochemical measurement is present, but the extracted source text does not unambiguously report the complete electrode configuration and materials."
            : "No source-backed electrode rule is available for this record.",
        });
      }
      continue;
    }

    const source = record.sourceId ? getSource("conductivity", record.sourceId) : null;
    const cacheKey = `${record.sourceId ?? "none"}:${rule.key}`;
    if (!evidenceCache.has(cacheKey)) {
      evidenceCache.set(cacheKey, source ? evidenceFrom(source, rule.evidence) : null);
    }
    const evidence = evidenceCache.get(cacheKey) ?? null;
    if (!evidence) {
      missingEvidence.push({ id: record.id, title: record.paper.title, rule: rule.key });
      continue;
    }

    const currentFields = toFields(record);
    const values = rule.values(record);
    const valueFields = (Object.keys(values) as ElectrodeField[]).filter((field) => values[field]);
    const changedFields = valueFields.filter((field) =>
      !sameValue(currentFields[field], values[field]) || !record.provenance?.[field]
    );
    planned.push({
      id: record.id,
      title: record.paper.title,
      source: source?.filename ?? null,
      rule: rule.key,
      page: evidence.page ?? null,
      changedFields,
      values,
    });
  }

  if (write && missingEvidence.length) {
    throw new Error(`Refusing to write: ${missingEvidence.length} matched records have no exact source evidence.`);
  }

  let backup: string | null = null;
  let updated = 0;
  if (write && planned.some((item) => item.changedFields.length)) {
    backup = backupDomainDatabase("conductivity");
    for (const item of planned) {
      if (!item.changedFields.length) continue;
      const record = records.find((candidate) => candidate.id === item.id)!;
      const rule = RULES.find((candidate) => candidate.key === item.rule)!;
      const evidence = evidenceCache.get(`${record.sourceId ?? "none"}:${rule.key}`)!;
      const fields = {
        ...toFields(record),
        ...item.values,
        provenance: mergeProvenance(
          record,
          Object.keys(item.values).filter((field) => item.values[field as ElectrodeField]) as ElectrodeField[],
          evidence!,
          rule,
        ),
      };
      const result = updateRecord("conductivity", record.id, { fields });
      if (result.error) throw new Error(`Could not update ${record.id}: ${result.error}`);
      updated += 1;
    }
  } else if (write) {
    const backupDir = path.resolve("data/backups");
    if (existsSync(backupDir)) {
      const latest = readdirSync(backupDir)
        .filter((name) => /^conductivity-.*\.db$/i.test(name))
        .sort()
        .at(-1);
      backup = latest ? path.join(backupDir, latest) : null;
    }
  }

  const finalRecords = write
    ? listRecords("conductivity", { status: "official" }) as ConductivityRecord[]
    : records;
  const syncedAudits = write && process.argv.includes("--sync-audits")
    ? syncCuratedAuditFiles(finalRecords)
    : { files: 0, records: 0 };
  const configurationCounts = finalRecords.reduce(
    (counts, record) => {
      const model = buildConductivityCellModel(record);
      counts[model.configuration] += 1;
      counts[model.applicability] += 1;
      return counts;
    },
    {
      "two-electrode": 0,
      "three-electrode": 0,
      unknown: 0,
      electrochemical: 0,
      "not-applicable": 0,
      unverified: 0,
    } as Record<string, number>,
  );
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: write ? "applied" : "dry-run",
    policy: {
      threeElectrode: "WE/CE/RE roles are stored without assigning fixed positive/negative polarity.",
      twoElectrode: "Positive/negative signs are stored only when the paper explicitly assigns polarity.",
      bulkProperties: "Bulk conductivity, viscosity, MD, and simulation records are not forced into a 2E/3E electrochemical-cell model.",
      provenance: "Every automated electrode value must match an exact text span in its stored source PDF; inferred fields are labelled inferred.",
    },
    summary: {
      officialRecords: records.length,
      ruleMatchedRecords: planned.length,
      evidenceBackfilledRecords: planned.length - missingEvidence.length,
      recordsNeedingUpdate: planned.filter((item) => item.changedFields.length).length,
      updatedRecordsThisRun: updated,
      syncedAuditFiles: syncedAudits.files,
      syncedAuditRecords: syncedAudits.records,
      missingEvidence: missingEvidence.length,
      notApplicableRecords: notApplicable.length,
      manualReviewRecords: manualReview.length,
      configurationCounts,
      backup,
    },
    evidenceBackfill: planned,
    missingEvidence,
    notApplicable,
    manualReview,
  };
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`electrodeAudit.mode=${report.mode}`);
  console.log(`electrodeAudit.ruleMatched=${planned.length}`);
  console.log(`electrodeAudit.needUpdate=${report.summary.recordsNeedingUpdate}`);
  console.log(`electrodeAudit.updated=${updated}`);
  console.log(`electrodeAudit.syncedAudits=${syncedAudits.files} files / ${syncedAudits.records} records`);
  console.log(`electrodeAudit.notApplicable=${notApplicable.length}`);
  console.log(`electrodeAudit.manualReview=${manualReview.length}`);
  console.log(`electrodeAudit.missingEvidence=${missingEvidence.length}`);
  console.log(`electrodeAudit.configurations=${JSON.stringify(configurationCounts)}`);
  if (backup) console.log(`electrodeAudit.backup=${backup}`);
  console.log(`electrodeAudit.report=${outputPath}`);
  if (!write) console.log("dry-run only; pass --write to back up the database and apply evidence-backed updates");
}

main();
