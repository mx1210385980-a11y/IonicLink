/**
 * Seed the database with standardized, three-layer records. Each entry is a flat
 * ExtractedFields object run through `ingest` — the same path live extraction
 * uses — so units are standardized and fields stratified into core/extended/flexible.
 *
 * Run: npm run seed
 */
import { createRecords, resetAll } from "../lib/db";
import { ingest } from "../lib/ingest";
import type { ExtractedFields } from "../lib/schema";

const REF_PAPER = {
  title: "Ionic liquid lubrication: influence of ion structure, surface potential and sliding velocity",
  journal: "Physical Chemistry Chemical Physics",
  year: 2013,
  doi: "10.1039/c3cp51288d",
};

const OFFICIAL: ExtractedFields[] = [
  {
    paper: REF_PAPER,
    cation: "[BMIM]",
    anion: "[I]",
    cationSmiles: "CCCCn1cc[n+](C)c1",
    anionSmiles: "[I-]",
    substrate: "Au(111)",
    temperature: "293.15 K",
    load: ">5 nN",
    cof: 0.12,
    cofMethod: "lateral force / load",
    scale: "nano",
    method: "AFM",
    probe: "Silica",
    probeType: "Colloid probe",
    potential: "+0.5 V",
    velocity: "2 µm/s", // reported; afm params independently confirm it
    afm: { scanRate: "1 Hz", scanSize: "1 µm" },
    provenance: [
      { field: "cof", page: 4, figure: "Fig. 5b", quote: "a friction coefficient of ~0.12" },
      { field: "load", page: 3, section: "2.2 AFM", quote: "normal loads exceeding 5 nN" },
      { field: "substrate", page: 3, quote: "Au(111) single crystal" },
    ],
    confidence: 1,
  },
];

const REVIEW: ExtractedFields[] = [
  {
    paper: REF_PAPER,
    cation: "[BMIM]",
    anion: "[I]",
    cationSmiles: "CCCCn1cc[n+](C)c1",
    anionSmiles: "[I-]",
    substrate: "Au(111)",
    temperature: "293.15 K",
    load: ">5 nN",
    cof: 0.18,
    scale: "nano",
    method: "AFM",
    probe: "Silica",
    probeType: "Colloid probe",
    potential: "-0.5 V",
    // velocity omitted → derived from scan params (2 × 1 Hz × 1 µm = 2 µm/s)
    afm: { scanRate: "1 Hz", scanSize: "1 µm" },
    confidence: 0.82,
  },
  {
    paper: { title: "Nanoscale lubrication of ionic surfactant aggregates at the silica–water interface", journal: "Langmuir", year: 2019 },
    cation: "[C12MIM]",
    anion: "[Cl]",
    cationSmiles: "CCCCCCCCCCCCn1cc[n+](C)c1",
    anionSmiles: "[Cl-]",
    substrate: "Mica",
    temperature: "25 °C", // standardizes to 298.15 K — shows the conversion layer
    load: "10 nN",
    cof: 0.045,
    scale: "nano",
    method: "AFM",
    probe: "Silica",
    probeType: "Colloid probe",
    roughness: "0.3 nm",
    afm: { scanRate: "2 Hz", scanSize: "0.25 µm" }, // → 1 µm/s
    flexible: [{ key: "humidity", value: "30% RH", note: "controlled chamber humidity" }],
    provenance: [
      { field: "cof", page: 6, figure: "Fig. 3", quote: "COF as low as 0.045" },
      { field: "temperature", page: 2, quote: "measurements at 25 °C" },
    ],
    confidence: 0.74,
  },
  {
    paper: { title: "Macroscale friction of phosphonium ionic liquids on steel under boundary lubrication", journal: "Tribology International", year: 2021 },
    cation: "[P6,6,6,14]",
    anion: "[NTf2]",
    anionSmiles: "[N-](S(=O)(=O)C(F)(F)F)S(=O)(=O)C(F)(F)F",
    substrate: "AISI 52100 steel",
    temperature: "298 K",
    load: "5 N",
    cof: 0.11,
    scale: "macro",
    method: "Tribometer",
    probe: "Steel ball",
    probeType: "Ball-on-disk",
    velocity: "5 mm/s",
    roughness: "20 nm",
    additives: "1 wt% benzotriazole",
    confidence: 0.69,
  },
  {
    // Intentionally incomplete — missing substrate, temperature, and COF — to
    // demonstrate the base-layer completeness gate (cannot be approved as-is).
    paper: { title: "Confined ionic liquid films probed by frequency-modulation AFM", journal: "J. Phys. Chem. C", year: 2020 },
    cation: "[EMIM]",
    anion: "[BF4]",
    substrate: "",
    load: "8 nN",
    cof: null,
    scale: "nano",
    method: "AFM",
    afm: { scanRate: "1 Hz", scanSize: "2 µm" },
    confidence: 0.4,
  },
];

resetAll("tribology");
const official = createRecords("tribology", OFFICIAL.map(ingest), "official");
const review = createRecords("tribology", REVIEW.map(ingest), "review");
console.log(`Seeded ${official.length} official + ${review.length} review records.`);
