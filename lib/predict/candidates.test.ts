import assert from "node:assert/strict";
import { buildAtlas, buildVocabulary, passesConstraints, rankCandidates } from "./candidates";
import { buildDataset } from "./dataset";
import { describeIon, featureNorm, ionVocabulary } from "./descriptors";

const NORM = featureNorm([...ionVocabulary("cation"), ...ionVocabulary("anion")]);

let nextId = 0;
function rec(cation: string, anion: string, sigma: number, tempK = 298.15) {
  nextId += 1;
  return {
    id: `#a${String(nextId).padStart(3, "0")}`,
    status: "official",
    createdAt: "2026-06-10",
    paper: { title: `P ${cation}${anion}` },
    core: {
      ionicLiquid: { cation, anion },
      surface: "Pt",
      temperature: { raw: `${tempK} K`, value: tempK, unit: "K", std: tempK, stdUnit: "K" },
      conductivity: { raw: `${sigma} S/m`, value: sigma, unit: "S/m", std: sigma, stdUnit: "S/m" },
    },
    extended: {},
    flexible: [],
  };
}

const RECORDS = [
  rec("[C2MIM]", "[BF4]", 1.0),
  rec("[C4MIM]", "[BF4]", 0.6),
  rec("[C6MIM]", "[BF4]", 0.35),
  rec("[C8MIM]", "[BF4]", 0.2),
  rec("[C2MIM]", "[TFSI]", 0.9),
  rec("[C4MIM]", "[TFSI]", 0.55),
  rec("[C6MIM]", "[TFSI]", 0.3),
  rec("[PYR14]", "[TFSI]", 0.25),
  rec("[C4MIM]", "[PF6]", 0.45),
];

/* ---- constraints ---- */
{
  const cl = describeIon("[Cl]", "anion");
  const tfsi = describeIon("[TFSI]", "anion");
  const c12 = describeIon("[C12MIM]", "cation");
  assert.equal(passesConstraints(cl, { halideFree: true }), false);
  assert.equal(passesConstraints(tfsi, { halideFree: true }), true);
  assert.equal(passesConstraints(tfsi, { fluorineFree: true }), false);
  assert.equal(passesConstraints(c12, { maxChainLength: 8 }), false);
  assert.equal(passesConstraints(c12, { maxChainLength: 12 }), true);
  assert.equal(passesConstraints(tfsi, { familiesExcluded: ["sulfonylimide"] }), false);
}

/* ---- vocabulary includes dataset ions ---- */
{
  const ds = buildDataset("conductivity", RECORDS);
  const cations = buildVocabulary("cation", ds);
  assert.ok(cations.some((c) => c.key === "pyr14"));
  assert.ok(cations.some((c) => c.key === "c4mim"));
}

/* ---- ungated atlas: measured cells are measured, novel cells get predictions ---- */
{
  const ds = buildDataset("conductivity", RECORDS);
  const atlas = buildAtlas("conductivity", ds, NORM, { tempK: 298.15 });
  assert.equal(atlas.gated, false);
  const flat = atlas.cells.flat();
  const measured = flat.filter((c) => c.kind === "measured");
  assert.equal(measured.length, 9, "every measured pair appears as a measured cell");
  assert.ok(measured.every((c) => c.prediction === null), "measured cells never carry a model output");
  const predicted = flat.filter((c) => c.kind === "predicted");
  assert.ok(predicted.length > 0, "novel cells near the data get predictions");
  assert.ok(predicted.every((c) => c.value != null && c.value > 0));

  const ranked = rankCandidates(atlas, "max", { limit: 5 });
  assert.equal(ranked.length, 5);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok((ranked[i - 1].cell.value as number) >= (ranked[i].cell.value as number), "ranking respects the objective");
  }
  assert.ok(ranked.some((r) => !r.novel), "measured pairs compete in the shortlist");

  const rankedMin = rankCandidates(atlas, "min", { limit: 5 });
  assert.ok((rankedMin[0].cell.value as number) <= (ranked[0].cell.value as number));
}

/* ---- gated atlas (n<8): coverage only, no predictions, no ranking ---- */
{
  const ds = buildDataset("conductivity", RECORDS.slice(0, 3));
  const atlas = buildAtlas("conductivity", ds, NORM, { tempK: 298.15 });
  assert.equal(atlas.gated, true);
  const flat = atlas.cells.flat();
  assert.ok(flat.every((c) => c.kind !== "predicted"), "no predicted cells below the gate");
  assert.equal(flat.filter((c) => c.kind === "measured").length, 3);
  assert.deepEqual(rankCandidates(atlas, "max"), [], "ranking disabled below the gate");
}

/* ---- diffusion atlas hard-facets by species: no cross-species "measured" cells ---- */
{
  let dn = 0;
  const drec = (cation: string, anion: string, d: number, species: string) => {
    dn += 1;
    return {
      id: `#dx${dn}`,
      status: "review",
      createdAt: "2026-06-10",
      paper: { title: `DP ${cation}${anion}` },
      core: {
        ionicLiquid: { cation, anion },
        species,
        temperature: { raw: "303 K", value: 303, unit: "K", std: 303, stdUnit: "K" },
        diffusion: { raw: `${d} m²/s`, value: d, unit: "m²/s", std: d, stdUnit: "m²/s" },
      },
      extended: {},
      flexible: [],
    };
  };
  const ds = buildDataset("diffusion", [
    drec("[BMIM]", "[TFSI]", 1e-11, "cation"),
    drec("[BMIM]", "[TFSI]", 9e-11, "anion"),
  ]);
  const atlas = buildAtlas("diffusion", ds, NORM, { tempK: 303, species: "tracer" });
  const cell = atlas.cells.flat().find((c) => c.pairKey === "c4mim|ntf2");
  assert.ok(cell);
  assert.notEqual(cell?.kind, "measured", "a species with zero measurements must not show a 'measured' cell");
  assert.equal(cell?.value, null);
  assert.equal(atlas.usableN, 0, "the atlas gate counts the species-faceted pool, not the mixed pool");

  const anionAtlas = buildAtlas("diffusion", ds, NORM, { tempK: 303, species: "anion" });
  const anionCell = anionAtlas.cells.flat().find((c) => c.pairKey === "c4mim|ntf2");
  assert.equal(anionCell?.kind, "measured");
  assert.equal(anionCell?.value, 9e-11, "the anion view shows only the anion measurement, never a cross-species median");
}

/* ---- constraints prune the atlas axes ---- */
{
  const ds = buildDataset("conductivity", RECORDS);
  const atlas = buildAtlas("conductivity", ds, NORM, { tempK: 298.15 }, { fluorineFree: true });
  assert.ok(atlas.anions.every((a) => a.nF === 0));
  assert.ok(!atlas.anions.some((a) => a.key === "bf4"));
}

console.log("predict/candidates tests passed");
