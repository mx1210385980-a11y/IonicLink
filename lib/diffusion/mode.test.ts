import assert from "node:assert/strict";
import { getDiffusionMode, type DiffusionMode } from "./mode";

const cases: Array<{ geometry: string; expected: DiffusionMode }> = [
  { geometry: "slit pore", expected: "2D" },
  { geometry: "carbon nanotube", expected: "1D" },
  { geometry: "cellulose ionogel matrix", expected: "3D" },
  { geometry: "parallel plate", expected: "2D" },
  { geometry: "cylindrical channel", expected: "1D" },
  { geometry: "graphene oxide film", expected: "2D" },
  { geometry: "mesoporous carbon network", expected: "3D" },
  { geometry: "unknown geometry", expected: "3D" },
  { geometry: "", expected: "3D" },
];

for (const { geometry, expected } of cases) {
  assert.equal(
    getDiffusionMode(geometry),
    expected,
    `geometry=${JSON.stringify(geometry)} should map to ${expected}`
  );
}

console.log("getDiffusionMode tests passed");
