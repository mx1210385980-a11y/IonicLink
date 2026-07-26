import assert from "node:assert/strict";
import { parseQuantity } from "../units";

const close = (a: number | null | undefined, b: number, tol = 1e-9) =>
  a != null && Math.abs(a - b) < tol;

// conductivity → S/m
assert.ok(close(parseQuantity("12 mS/cm", "conductivity")?.std, 1.2), "12 mS/cm = 1.2 S/m");
assert.ok(close(parseQuantity("1 S/cm", "conductivity")?.std, 100), "1 S/cm = 100 S/m");
assert.ok(close(parseQuantity("120 µS/cm", "conductivity")?.std, 0.012), "120 µS/cm = 0.012 S/m");
assert.ok(close(parseQuantity("3.5 mS/cm", "conductivity")?.std, 0.35), "3.5 mS/cm = 0.35 S/m");
assert.ok(close(parseQuantity("0.5 S/m", "conductivity")?.std, 0.5), "0.5 S/m unchanged");

// viscosity → Pa·s
assert.ok(close(parseQuantity("45 cP", "viscosity")?.std, 0.045), "45 cP = 0.045 Pa·s");
assert.ok(close(parseQuantity("45 mPa·s", "viscosity")?.std, 0.045), "45 mPa·s = 0.045 Pa·s");
assert.ok(close(parseQuantity("0.045 Pa·s", "viscosity")?.std, 0.045), "0.045 Pa·s unchanged");
assert.ok(close(parseQuantity("1 P", "viscosity")?.std, 0.1), "1 P = 0.1 Pa·s");
// ASCII spelling variants resolve
assert.ok(close(parseQuantity("28 mPas", "viscosity")?.std, 0.028), "mPas alias → mPa·s");

// raw unit label is preserved for display
assert.equal(parseQuantity("12 mS/cm", "conductivity")?.unit, "mS/cm");
assert.equal(parseQuantity("45 cP", "viscosity")?.unit, "cP");

console.log("Conductivity unit conversion tests passed");
