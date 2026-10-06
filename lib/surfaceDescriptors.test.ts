import assert from "node:assert/strict";
import { applySurfaceDescriptorsToRecord, buildSurfaceDescriptors, surfaceDescriptorDefaults } from "./surfaceDescriptors";

const hopg = surfaceDescriptorDefaults("HOPG");
assert.equal(hopg?.materialClass, "carbon");
assert.equal(hopg?.plane, "(0001)");
assert.equal(hopg?.surfaceEnergy, undefined);
assert.equal(hopg?.contactAngle, undefined);
assert.equal(hopg?.surfaceChargeDensity, undefined);
assert.equal(hopg?.roughness, undefined);

const ptfe = surfaceDescriptorDefaults("PTFE");
assert.equal(ptfe?.materialClass, "polymer");
assert.equal(ptfe?.plane, "amorphous");
assert.equal(ptfe?.conductor, false);

const au = buildSurfaceDescriptors({
  substrate: "Au(1 1 1)",
  reported: {
    contactAngle: "62°",
    surfaceEnergy: "0.072 J/m2",
  },
  provenance: {
    contactAngle: { basis: "direct", page: 3, quote: "water contact angle was 62°" },
    surfaceEnergy: { basis: "direct", page: 3, quote: "surface energy was 0.072 J/m2" },
  },
});
assert.equal(au.descriptors.plane, "(111)");
assert.equal(au.descriptors.materialClass, "metal");
assert.equal(au.descriptors.contactAngle?.raw, "62°");
assert.equal(au.descriptors.contactAngle?.std, 62);
assert.equal(au.provenance.contactAngle?.basis, "direct");
assert.equal(au.descriptors.surfaceEnergy?.std, 72);
assert.equal(au.descriptors.surfaceChargeDensity, undefined);
assert.equal(au.descriptors.roughness, undefined);
assert.equal(au.provenance.surfaceChargeDensity, undefined);

const unverified = buildSurfaceDescriptors({
  substrate: "silica",
  reported: {
    surfaceEnergy: "200 mJ/m2",
    surfaceChargeDensity: "-0.07 C/m2",
    contactAngle: "20.7°",
  },
});
assert.equal(unverified.descriptors.surfaceEnergy, undefined);
assert.equal(unverified.descriptors.surfaceChargeDensity, undefined);
assert.equal(unverified.descriptors.contactAngle, undefined);

const unknown = buildSurfaceDescriptors({ substrate: "polyether ether ketone" });
assert.equal(unknown.descriptors.materialClass, "polymer");
assert.equal(unknown.descriptors.surfaceEnergy, undefined);
assert.equal(unknown.provenance.surfaceEnergy, undefined);

const cleanedAssumption = applySurfaceDescriptorsToRecord({
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
assert.equal(cleanedAssumption.extended?.surface?.surfaceEnergy, undefined);
assert.equal(cleanedAssumption.provenance?.surfaceEnergy, undefined);

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
