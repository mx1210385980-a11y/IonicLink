import assert from "node:assert/strict";
import { ingest, toFields } from "./ingest";
import { deriveConductivityDependencies } from "./dependencies";
import type { ConductivityRecord } from "./schema";

function record(id: string, temperature: string, conductivity: string): ConductivityRecord {
  const draft = ingest({
    paper: { title: "Temperature-series paper" },
    cation: "[EMIM]",
    anion: "[TFSI]",
    surface: "bulk liquid",
    temperature,
    conductivity,
    concentration: "neat IL",
    method: "conductivity cell",
  });
  return { ...draft, id, createdAt: "", status: "official" };
}

const series = [
  record("#a", "283 K", "2 mS/cm"),
  record("#b", "298 K", "5 mS/cm"),
  record("#c", "313 K", "9 mS/cm"),
];
const dependencies = deriveConductivityDependencies(series[1], series);
const temperature = dependencies.find((dependency) => dependency.independentVariable === "temperature");
assert.ok(temperature);
assert.equal(temperature.dependentField, "conductivity");
assert.equal(temperature.trend, "increases");
assert.equal(temperature.observations.length, 3);
assert.equal(temperature.source, "record-comparison");
assert.match(temperature.statement, /not a causal claim/);

const mixed = record("#mixed", "328 K", "12 mS/cm");
mixed.extended.concentration = "50 wt%";
assert.equal(
  deriveConductivityDependencies(series[1], [...series.slice(0, 1), mixed]).length,
  0,
  "a changed composition must not be mislabelled as a clean temperature dependence",
);

const tableDraft = ingest({
  paper: { title: "Table-series paper" }, cation: "[EMIM]", anion: "[TFSI]", surface: "bulk liquid", conductivity: "5 mS/cm",
  propertyDependencies: [{
    label: "表 2 电导率–温度依赖", dependentField: "conductivity", independentVariable: "temperature", trend: "increases",
    statement: "表 2 显示电导率随温度升高。", source: "paper-text", evidence: "Table 2", sourcePage: 4,
    observations: [{ x: "298 K", y: "5 mS/cm" }, { x: "318 K", y: "8 mS/cm" }],
  }],
});
assert.equal(tableDraft.extended.propertyDependencies?.[0].observations.length, 2);
assert.deepEqual(toFields(tableDraft).propertyDependencies, tableDraft.extended.propertyDependencies);

console.log("Conductivity dependency tests passed");
