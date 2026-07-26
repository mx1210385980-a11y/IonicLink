import assert from "node:assert/strict";
import { ingest } from "./ingest";
import type { ExtractedFields } from "./schema";

const close = (a: number | null | undefined, b: number, tol = 1e-9) =>
  a != null && Math.abs(a - b) < tol;

const base: ExtractedFields = {
  paper: { title: "Default temperature test" },
  cation: "[BMIM]",
  anion: "[PF6]",
  substrate: "graphite",
  load: "5 nN",
  cof: 0.1,
};

const missingTemperature = ingest(base);
assert.ok(close(missingTemperature.core.temperature?.std, 293.15), "missing temperature defaults to 293.15 K");
assert.equal(missingTemperature.core.temperature?.raw, "not stated");

const ambientTemperature = ingest({ ...base, temperature: "ambient conditions" });
assert.ok(close(ambientTemperature.core.temperature?.std, 293.15), "ambient conditions defaults to 293.15 K");
assert.equal(ambientTemperature.core.temperature?.raw, "ambient conditions");

const notStatedTemperature = ingest({ ...base, temperature: "not stated" });
assert.ok(close(notStatedTemperature.core.temperature?.std, 293.15), "not stated temperature defaults to 293.15 K");
assert.equal(notStatedTemperature.core.temperature?.raw, "not stated");
assert.equal(notStatedTemperature.provenance?.temperature?.basis, "assumed");

const hopgFromEvidence = ingest({
  ...base,
  substrate: "graphite",
  provenance: [
    {
      field: "substrate",
      page: 2,
      quote: "The highly oriented pyrolytic graphite (HOPG) was purchased from Mikromasch as the supporting substrate.",
    },
  ],
});
assert.equal(hopgFromEvidence.core.substrate, "HOPG", "HOPG evidence takes priority over generic graphite");

const genericGraphite = ingest({ ...base, substrate: "graphite" });
assert.equal(genericGraphite.core.substrate, "graphite", "generic graphite stays graphite when HOPG is not evidenced");

const auSurface = ingest({
  ...base,
  substrate: "Au(1 1 1)",
  contactAngle: "62°",
  surfaceEnergy: "0.072 J/m2",
  provenance: [{ field: "contactAngle", page: 3, quote: "The contact angle was 62° on Au(111)." }],
});
assert.equal(auSurface.extended.surface?.plane, "(111)");
assert.equal(auSurface.extended.surface?.materialClass, "metal");
assert.equal(auSurface.extended.surface?.contactAngle?.raw, "62°");
assert.equal(auSurface.extended.surface?.surfaceEnergy?.std, 72);
assert.equal(auSurface.provenance?.contactAngle?.page, 3);
assert.equal(auSurface.provenance?.surfaceChargeDensity?.basis, "assumed");

const afmMicroVelocity = ingest({
  ...base,
  method: "AFM",
  velocity: "6 mm s−1",
  afm: { scanSize: "100 nm", scanRate: "30 Hz" },
  provenance: [{ field: "scanSize", page: 2, quote: "The scan size was 100 nm.", basis: "direct" }],
});
assert.ok(close(afmMicroVelocity.extended.velocity?.std, 6e-6), "AFM scan parameters correct µm/s misread as mm/s");
assert.equal(afmMicroVelocity.extended.velocity?.raw, "6 µm/s");
assert.equal(afmMicroVelocity.extended.velocitySource, "derived");
assert.equal(afmMicroVelocity.provenance?.velocity?.page, 2);
assert.equal(afmMicroVelocity.provenance?.velocity?.basis, "inferred");

const afmReportedMicroVelocity = ingest({
  ...base,
  method: "Friction Force Microscopy (FFM)",
  scale: "nano",
  velocity: "40 mm s−1",
});
assert.ok(close(afmReportedMicroVelocity.extended.velocity?.std, 40e-6), "AFM/FFM mm/s extraction is treated as a µm/s text loss");
assert.equal(afmReportedMicroVelocity.extended.velocity?.raw, "40 µm/s");

const macroMillimeterVelocity = ingest({
  ...base,
  method: "tribometer",
  scale: "macro",
  velocity: "15 mm/s",
});
assert.ok(close(macroMillimeterVelocity.extended.velocity?.std, 15e-3), "macro mm/s velocity remains millimeter per second");
assert.equal(macroMillimeterVelocity.extended.velocity?.raw, "15 mm/s");

console.log("Tribology ingest temperature default tests passed");
