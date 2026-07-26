import assert from "node:assert/strict";
import { parseQuantity, stdLabel } from "./units";

const close = (a: number | null | undefined, b: number, tol = 1e-9) =>
  a != null && Math.abs(a - b) < tol;

assert.ok(close(parseQuantity("25 °C", "temperature")?.std, 298.15), "25 °C -> 298.15 K");
assert.equal(stdLabel(parseQuantity("25 °C", "temperature")), "298.1 K");

assert.ok(close(parseQuantity("25 ℃", "temperature")?.std, 298.15), "25 ℃ -> 298.15 K");
assert.ok(close(parseQuantity("25 ◦C (298 K)", "temperature")?.std, 298.15), "25 ◦C (298 K) uses the stated Celsius value");
assert.equal(stdLabel(parseQuantity("25 ◦C (298 K)", "temperature")), "298.1 K");
assert.ok(close(parseQuantity("25 摄氏度", "temperature")?.std, 298.15), "25 摄氏度 -> 298.15 K");
assert.ok(close(parseQuantity("25 ± 1 °C", "temperature")?.std, 298.15), "25 ± 1 °C uses the main value");

const loadRange = parseQuantity("15-30 nN", "force");
assert.equal(loadRange?.value, 30, "ASCII hyphen force ranges use the upper value");
assert.equal(loadRange?.approx, true, "ASCII hyphen force ranges are marked approximate");
assert.deepEqual(loadRange?.range, { min: 15, max: 30, unit: "nN", stdMin: 15e-9, stdMax: 30e-9 });
assert.equal(stdLabel(loadRange), "15-30 nN");

const compactLoadRange = parseQuantity("15-30nN", "force");
assert.equal(compactLoadRange?.value, 30, "compact ASCII hyphen force ranges use the upper value");
assert.equal(stdLabel(compactLoadRange), "15-30 nN");

const spacedNanoLoadRange = parseQuantity("15-30n N", "force");
assert.equal(spacedNanoLoadRange?.value, 30, "spaced n N force ranges use the upper value");
assert.equal(spacedNanoLoadRange?.unit, "nN");
assert.equal(stdLabel(spacedNanoLoadRange), "15-30 nN");

const negativeLoad = parseQuantity("-30 nN", "force");
assert.equal(negativeLoad?.value, -30, "leading minus remains a negative value");
assert.equal(stdLabel(negativeLoad), "-30 nN");

assert.equal(stdLabel(parseQuantity(">10 nN", "force")), ">10 nN");
assert.equal(stdLabel(parseQuantity("≤30 nN", "force")), "≤30 nN");
assert.equal(stdLabel(parseQuantity("higher than 30 nN; up to 80 nN in Fig. 1a", "force")), ">30 nN");
assert.equal(stdLabel(parseQuantity("above B30 nN", "force")), ">≈30 nN");
assert.equal(stdLabel(parseQuantity("below 11 nN", "force")), "<11 nN");
assert.equal(stdLabel(parseQuantity("up to 50 nN", "force")), "≤50 nN");
assert.equal(stdLabel(parseQuantity("~0.1 nm", "length")), "≈0.1 nm");

assert.ok(close(parseQuantity("6.5 μm s−1", "velocity")?.std, 6.5e-6), "μm s−1 velocity -> m/s");
assert.ok(close(parseQuantity("12 µm s-1", "velocity")?.std, 12e-6), "µm s-1 velocity -> m/s");
assert.ok(close(parseQuantity("15 mm s− 1", "velocity")?.std, 15e-3), "mm s− 1 velocity -> m/s");
assert.equal(stdLabel(parseQuantity("6.5 μm s−1", "velocity")), "6.5 µm/s");

assert.ok(close(parseQuantity("room temperature", "temperature")?.std, 293.15), "room temperature -> 293.15 K");
assert.ok(close(parseQuantity("ambient conditions", "temperature")?.std, 293.15), "ambient conditions -> 293.15 K");
assert.equal(parseQuantity("ambient conditions", "temperature")?.raw, "ambient conditions");
assert.ok(close(parseQuantity("not stated", "temperature")?.std, 293.15), "not stated -> 293.15 K");
assert.equal(stdLabel(parseQuantity("not stated", "temperature")), "≈293.1 K");
assert.ok(close(parseQuantity("0.072 J/m2", "surfaceEnergy")?.std, 72), "0.072 J/m2 -> 72 mJ/m²");
assert.ok(close(parseQuantity("2 µC/cm2", "surfaceChargeDensity")?.std, 0.02), "2 µC/cm2 -> 0.02 C/m²");
assert.ok(close(parseQuantity("75°", "angle")?.std, 75), "75° -> 75°");

console.log("Unit temperature conversion tests passed");
