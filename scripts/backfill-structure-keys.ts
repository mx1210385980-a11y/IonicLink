import { backupDomainDatabase, backfillStructureKeys } from "../lib/db";
import { DOMAINS, isDomain, type Domain } from "../lib/domain";

const requested = process.argv.slice(2);
const domains: Domain[] = requested.length
  ? requested.map((value) => {
      if (!isDomain(value)) throw new Error(`Unknown domain: ${value}`);
      return value;
    })
  : DOMAINS;

for (const domain of domains) {
  const backup = backupDomainDatabase(domain);
  const result = backfillStructureKeys(domain);
  console.log(
    JSON.stringify({
      domain,
      backup,
      ...result,
    })
  );
}
