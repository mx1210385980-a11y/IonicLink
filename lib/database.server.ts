import { countByStatus, listPapers, listRecords, type ListOptions } from "@/lib/db";
import type { DatabasePayload } from "@/lib/databasePayload";
import type { Domain } from "@/lib/domain";

export function getDatabasePayload(domain: Domain, options: ListOptions): DatabasePayload {
  return {
    records: listRecords(domain, options),
    counts: countByStatus(domain),
    // Keep the source picker scoped to the selected queue, but independent of
    // the current paper filter so every switch target remains available.
    papers: listPapers(domain, options.status),
  };
}
