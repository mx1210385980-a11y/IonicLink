import assert from "node:assert/strict";
import { getDiffusionMode, type DiffusionMode } from "./mode";

const cases: Array<{ geometry: string; expected: DiffusionMode }> = [
  { geometry: "slit pore", expected: "2D" },
  { geometry: "carbon nanotube", expected: "1D" },
  { geometry: "MOF framework", expected: "3D-Cage" },
  { geometry: "parallel plate", expected: "2D" },
  { geometry: "cylindrical pore", expected: "1D" },
  { geometry: "isolated liquid droplets", expected: "0D-Pools" },
  { geometry: "bicontinuous gyroid", expected: "Gyroid" },
  { geometry: "mesoporous carbon network", expected: "Membrane" },
  { geometry: "unknown geometry", expected: "Membrane" },
  { geometry: "", expected: "Membrane" },
];

for (const { geometry, expected } of cases) {
  assert.equal(
    getDiffusionMode(geometry),
    expected,
    `geometry=${JSON.stringify(geometry)} should map to ${expected}`
  );
}

console.log("getDiffusionMode tests passed");
