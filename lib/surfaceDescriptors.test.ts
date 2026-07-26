import assert from "node:assert/strict";
import { applySurfaceDescriptorsToRecord, buildSurfaceDescriptors, surfaceDescriptorDefaults } from "./surfaceDescriptors";

const hopg = surfaceDescriptorDefaults("HOPG");
assert.equal(hopg?.materialClass, "carbon");
assert.equal(hopg?.plane, "(0001)");
assert.equal(hopg?.surfaceEnergy?.std, 50);
assert.equal(hopg?.contactAngle?.std, 85);
assert.equal(hopg?.surfaceChargeDensity?.std, -0.0002);
assert.equal(hopg?.roughness?.std, 0.89e-9);

const au = buildSurfaceDescriptors({
  substrate: "Au(1 1 1)",
  reported: {
    contactAngle: "62°",
    surfaceEnergy: "0.072 J/m2",
  },
});
assert.equal(au.descriptors.plane, "(111)");
assert.equal(au.descriptors.materialClass, "metal");
assert.equal(au.descriptors.contactAngle?.raw, "62°");
assert.equal(au.descriptors.contactAngle?.std, 62);
assert.equal(au.provenance.contactAngle?.basis, undefined);
assert.equal(au.descriptors.surfaceEnergy?.std, 72);
assert.equal(au.descriptors.surfaceChargeDensity?.std, -0.02);
assert.equal(au.descriptors.roughness?.raw, "0.835 nm");
assert.equal(au.provenance.surfaceChargeDensity?.basis, "assumed");
assert.match(au.provenance.surfaceChargeDensity?.basisNote ?? "", /WFF-calibrated model prior/);
assert.match(au.provenance.surfaceChargeDensity?.basisNote ?? "", /not a reported material property/);

const unknown = buildSurfaceDescriptors({ substrate: "polyether ether ketone" });
assert.equal(unknown.descriptors.materialClass, "polymer");
assert.equal(unknown.descriptors.surfaceEnergy, undefined);
assert.equal(unknown.provenance.surfaceEnergy, undefined);

const recalibrated = applySurfaceDescriptorsToRecord({
  core: { substrate: "Au(1 1 1)" },
  extended: {
    surface: {
      surfaceEnergy: { raw: "70 mJ/m2", value: 70, unit: "mJ/m2", std: 70, stdUnit: "mJ/m²" },
    },
  },
  provenance: {
    surfaceEnergy: { basis: "assumed", basisNote: "old default" },
  },
});
assert.equal(recalibrated.extended?.surface?.surfaceEnergy?.raw, "700 mJ/m2");

const preservedDirect = applySurfaceDescriptorsToRecord({
  core: { substrate: "Au(1 1 1)" },
  extended: {
    surface: {
      surfaceEnergy: { raw: "0.072 J/m2", value: 0.072, unit: "J/m2", std: 72, stdUnit: "mJ/m²" },
    },
  },
  provenance: {
    surfaceEnergy: { basis: "direct", page: 3, quote: "surface energy was 0.072 J/m2" },
  },
});
assert.equal(preservedDirect.extended?.surface?.surfaceEnergy?.raw, "0.072 J/m2");

console.log("Surface descriptor defaults tests passed");
