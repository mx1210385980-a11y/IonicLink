import type { Domain, DomainRecord } from "./domain";
import { getModule } from "./modules/registry.server";

/**
 * Flatten records to CSV using the domain module's header + row mapping. Each
 * module emits BOTH the original (raw) and the canonical value for every
 * standardized quantity — so the export is directly comparable AND traceable
 * back to the source text. Cell escaping is shared.
 */
export function recordsToCsv(domain: Domain, records: DomainRecord<any, any>[]): string {
  const mod = getModule(domain);
  const rows = records.map((r) => mod.csvRow(r));
  return [mod.csvHeaders, ...rows].map((row) => row.map(escapeCell).join(",")).join("\n");
}

function escapeCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
