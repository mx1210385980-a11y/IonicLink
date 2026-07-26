/**
 * Seed the DIFFUSION database with standardized, three-layer records — the same
 * ingest path live extraction uses. Writes to data/diffusion.db only.
 *
 * Run: npm run seed:diffusion (empty database) or
 * npm run seed:diffusion -- --reset (replace existing records)
 */
import { createRecords } from "../lib/db";
import { ingest } from "../lib/diffusion/ingest";
import type { DiffusionExtractedFields } from "../lib/diffusion/schema";
import { prepareSeed } from "./seed-guard";

const REF = {
  title: "Self-diffusion of imidazolium ionic liquids confined in mesoporous silica by PFG-NMR",
  journal: "Journal of Physical Chemistry B",
  year: 2017,
  doi: "10.1021/example.diffusion",
};

const OFFICIAL: DiffusionExtractedFields[] = [
  {
    paper: REF,
    cation: "[EMIM]",
    anion: "[TFSI]",
    cationSmiles: "CCn1cc[n+](C)c1",
    anionSmiles: "[N-](S(=O)(=O)C(F)(F)F)S(=O)(=O)C(F)(F)F",
    species: "cation",
    temperature: "303 K",
    diffusion: "6.2 × 10⁻¹¹ m² s⁻¹", // → 6.2e-11 m²/s
    systemName: "MCM-41 pores",
    poreSize: "3.8 nm",
    method: "PFG-NMR",
    nucleus: "¹H",
    viscosity: "28 cP",
    provenance: [
      { field: "diffusion", page: 4, table: "Table 2", quote: "D+ = 6.2 × 10−11 m2 s−1 at 303 K", basis: "direct" },
      { field: "temperature", page: 4, quote: "measured at 303 K", basis: "direct" },
    ],
    confidence: 1,
  },
];

const REVIEW: DiffusionExtractedFields[] = [
  {
    // the paired anion measurement — same IL, same T, separate record
    paper: REF,
    cation: "[EMIM]",
    anion: "[TFSI]",
    cationSmiles: "CCn1cc[n+](C)c1",
    anionSmiles: "[N-](S(=O)(=O)C(F)(F)F)S(=O)(=O)C(F)(F)F",
    species: "anion",
    temperature: "303 K",
    diffusion: "3.7 × 10⁻¹¹ m² s⁻¹",
    systemName: "MCM-41 pores",
    poreSize: "3.8 nm",
    method: "PFG-NMR",
    nucleus: "¹⁹F",
    viscosity: "28 cP",
    confidence: 0.85,
  },
  {
    paper: {
      title: "Transport of ionic liquids in nanoporous Vycor glass",
      journal: "Physical Chemistry Chemical Physics",
      year: 2019,
    },
    cation: "[BMIM]",
    anion: "[PF6]",
    cationSmiles: "CCCCn1cc[n+](C)c1",
    species: "cation",
    temperature: "30 °C", // standardizes to 303.15 K
    diffusion: "8.0e-12 m2/s",
    systemName: "Vycor glass nanopores",
    poreSize: "4 nm",
    method: "PFG-NMR",
    nucleus: "¹H",
    viscosity: "270 cP",
    waterContent: "20 ppm",
    confidence: 0.72,
  },
  {
    // Intentionally incomplete — missing temperature — to demonstrate the
    // base-layer completeness gate (cannot be approved as-is). Note it still
    // carries a D: drafts with NO D at all are dropped by acceptDraft and
    // never reach the review queue.
    paper: {
      title: "Ionic liquid dynamics in carbon nanotube membranes by MD",
      journal: "Electrochimica Acta",
      year: 2022,
    },
    cation: "[PYR14]",
    anion: "[TFSI]",
    species: "anion",
    temperature: undefined,
    diffusion: "1.4 × 10⁻¹¹ m² s⁻¹",
    systemName: "CNT membrane channels",
    poreSize: "2 nm",
    method: "MD simulation",
    confidence: 0.4,
  },
];

prepareSeed("diffusion");
const official = createRecords("diffusion", OFFICIAL.map(ingest), "official");
const review = createRecords("diffusion", REVIEW.map(ingest), "review");
console.log(`Seeded ${official.length} official + ${review.length} review diffusion records.`);
