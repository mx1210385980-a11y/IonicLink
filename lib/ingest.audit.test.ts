import assert from "node:assert/strict";
import { ingest } from "./ingest";
import { parseQuantity } from "./units";

const base = { paper: { title: "Audit regression" }, cation: "[EMIM]", anion: "[EtSO4]", substrate: "mica", cof: 0.12 };
for (const load of ["0–35 mN m−1 (normalized by probe radius)", ">2 mN/m", "0.2–1 mN m⁻¹ (normalised by 2πR)"]) {
  assert.equal(parseQuantity(load, "force")?.std, null, `normalized load is not force: ${load}`);
  assert.equal(ingest({ ...base, load }).core.load?.std, null);
}
assert.equal(parseQuantity("5 nN", "force")?.std, 5e-9);
const film = ingest({ ...base, filmThickness: "0.23 ± 0.15 nm (1 layer)" });
assert.ok(Math.abs(film.extended.filmThickness!.std! - 0.23e-9) < 1e-20);
assert.equal(film.extended.filmLayers, 1);
assert.equal(ingest({ ...base, filmThickness: "a single ion layer" }).extended.filmLayers, 1);
assert.equal(ingest({ ...base, filmThickness: "3 layers" }).extended.filmLayers, 3);
console.log("audit ingestion regressions passed");
