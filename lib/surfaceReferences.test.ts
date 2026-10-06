import assert from "node:assert/strict";
import { getSurfaceReferenceProfile } from "./surfaceReferences";

const silicaInEan = getSurfaceReferenceProfile({
  substrate: "silica (SiO2 wafer)",
  medium: "EAN",
});
assert.equal(silicaInEan.surfaceEnergy?.displayValue, "310 ± 20 mJ/m²");
assert.equal(silicaInEan.surfaceEnergy?.kind, "computed");
assert.equal(silicaInEan.surfaceEnergy?.matchLevel, "material-state");
assert.equal(silicaInEan.surfaceEnergy?.source.doi, "10.1103/PhysRevB.81.155432");
assert.equal(silicaInEan.contactAngle?.displayValue, "0°");
assert.equal(silicaInEan.contactAngle?.conditions.probeLiquid, "water");
assert.equal(silicaInEan.contactAngle?.source.doi, "10.1073/pnas.1722263115");
assert.equal(silicaInEan.surfaceChargeDensity, undefined);

const ptfeInAir = getSurfaceReferenceProfile({ substrate: "PTFE", medium: "air" });
assert.equal(ptfeInAir.surfaceEnergy?.displayValue, "12.6 ± 0.4 mJ/m²");
assert.equal(ptfeInAir.contactAngle?.displayValue, "115.8 ± 2.2°");
assert.equal(ptfeInAir.surfaceEnergy?.kind, "experimental");
assert.equal(ptfeInAir.surfaceEnergy?.matchLevel, "material-only");
assert.equal(ptfeInAir.surfaceEnergy?.source.doi, "10.1098/rsif.2012.0347");
assert.equal(ptfeInAir.surfaceChargeDensity, undefined);

assert.deepEqual(getSurfaceReferenceProfile({ substrate: "unknown coating" }), {});

console.log("Surface reference catalog tests passed");
