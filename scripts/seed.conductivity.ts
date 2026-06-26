/**
 * Seed the CONDUCTIVITY database with standardized, three-layer records — the
 * same ingest path live extraction uses. Writes to data/conductivity.db only.
 *
 * Run: npm run seed:conductivity
 */
import { createRecords, resetAll } from "../lib/db";
import { ingest } from "../lib/conductivity/ingest";
import type { ConductivityExtractedFields } from "../lib/conductivity/schema";

const REF = {
  title: "Temperature dependence of ionic conductivity in imidazolium ionic liquids",
  journal: "Journal of Physical Chemistry B",
  year: 2018,
  doi: "10.1021/example.conductivity",
};

const OFFICIAL: ConductivityExtractedFields[] = [
  {
    paper: REF,
    cation: "[BMIM]",
    anion: "[BF4]",
    cationSmiles: "CCCCn1cc[n+](C)c1",
    anionSmiles: "[B-](F)(F)(F)F",
    surface: "Pt",
    temperature: "298.15 K",
    conductivity: "3.5 mS/cm", // → 0.35 S/m
    method: "EIS",
    viscosity: "104 cP",
    waterContent: "85 ppm",
    provenance: [
      { field: "conductivity", page: 3, table: "Table 1", quote: "σ = 3.5 mS cm−1 at 298 K" },
      { field: "temperature", page: 3, quote: "measured at 298.15 K" },
    ],
    confidence: 1,
  },
];

const REVIEW: ConductivityExtractedFields[] = [
  {
    paper: REF,
    cation: "[BMIM]",
    anion: "[BF4]",
    cationSmiles: "CCCCn1cc[n+](C)c1",
    anionSmiles: "[B-](F)(F)(F)F",
    surface: "Pt",
    temperature: "353.15 K",
    conductivity: "12 mS/cm",
    method: "EIS",
    viscosity: "28 cP",
    confidence: 0.82,
  },
  {
    paper: {
      title: "Conductivity of pyrrolidinium ionic liquids on a glassy carbon electrode",
      journal: "Electrochimica Acta",
      year: 2020,
    },
    cation: "[PYR14]",
    anion: "[TFSI]",
    surface: "glassy carbon",
    temperature: "25 °C", // standardizes to 298.15 K
    conductivity: "2.6 mS/cm",
    method: "conductivity cell",
    waterContent: "120 ppm",
    confidence: 0.71,
  },
  {
    // Intentionally incomplete — missing conductivity — to demonstrate the
    // base-layer completeness gate (cannot be approved as-is).
    paper: {
      title: "Phosphonium ionic-liquid electrolytes for supercapacitors",
      journal: "Journal of Power Sources",
      year: 2021,
    },
    cation: "[P6,6,6,14]",
    anion: "[TFSI]",
    surface: "stainless steel",
    temperature: "298 K",
    conductivity: undefined,
    confidence: 0.4,
  },
];

resetAll("conductivity");
const official = createRecords("conductivity", OFFICIAL.map(ingest), "official");
const review = createRecords("conductivity", REVIEW.map(ingest), "review");
console.log(`Seeded ${official.length} official + ${review.length} review conductivity records.`);
