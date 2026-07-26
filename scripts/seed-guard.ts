import type { Domain } from "../lib/domain";
import { backupDomainDatabase, countByStatus, resetAll } from "../lib/db";

interface SeedGuardDependencies {
  countByStatus: (domain: Domain) => { official: number; review: number };
  backupDomainDatabase: (domain: Domain) => string | null;
  resetAll: (domain: Domain) => void;
}

const defaultDependencies: SeedGuardDependencies = { backupDomainDatabase, countByStatus, resetAll };

const seedCommand: Record<Domain, string> = {
  tribology: "npm run seed",
  conductivity: "npm run seed:conductivity",
  diffusion: "npm run seed:diffusion",
};

/** Refuse to overwrite existing records unless the caller explicitly opts in. */
export function prepareSeed(
  domain: Domain,
  args: string[] = process.argv.slice(2),
  dependencies: SeedGuardDependencies = defaultDependencies
): void {
  const counts = dependencies.countByStatus(domain);
  const total = counts.official + counts.review;
  const resetRequested = args.includes("--reset");

  if (total > 0 && !resetRequested) {
    throw new Error(
      `Refusing to seed ${domain}: found ${total} existing record(s) ` +
        `(${counts.official} official, ${counts.review} review). No data was changed. ` +
        `To delete and rebuild this domain's records, run: ${seedCommand[domain]} -- --reset`
    );
  }

  if (resetRequested) {
    const backup = total > 0 ? dependencies.backupDomainDatabase(domain) : null;
    if (backup) console.log(`Backed up ${domain} database to ${backup}`);
    dependencies.resetAll(domain);
  }
}
