import assert from "node:assert/strict";
import { parseQuantity, formatStd, stdLabel } from "../units";

const close = (a: number | null | undefined, b: number, tol?: number) =>
  a != null && Math.abs(a - b) < (tol ?? Math.abs(b) * 1e-9);

// the dominant literature notations all standardize to m²/s
assert.ok(close(parseQuantity("5.2 × 10⁻¹¹ m² s⁻¹", "diffusion")?.std, 5.2e-11), "superscript sci form");
assert.ok(close(parseQuantity("3.7 × 10−11 m2 s−1", "diffusion")?.std, 3.7e-11), "unicode-minus sci form");
assert.ok(close(parseQuantity("8.0e-12 m2/s", "diffusion")?.std, 8.0e-12), "e-notation");
assert.ok(close(parseQuantity("1.0 × 10-6 cm2/s", "diffusion")?.std, 1.0e-10), "cm²/s NMR convention");
assert.ok(close(parseQuantity("52 µm2/s", "diffusion")?.std, 5.2e-11), "µm²/s");
assert.ok(close(parseQuantity("52 µm²/s", "diffusion")?.std, 5.2e-11), "µm²/s superscript");

// digit-bearing unit ("m2 s-1") must not pollute the numeric value
assert.ok(close(parseQuantity("6.2 × 10⁻¹¹ m² s⁻¹", "diffusion")?.value ?? null, 6.2e-11), "value not corrupted by unit digits");

// ranges keep the upper value
assert.ok(close(parseQuantity("1–5 × 10⁻¹¹ m² s⁻¹", "diffusion")?.std, 5e-11), "range upper value");
assert.equal(parseQuantity("1–5 × 10⁻¹¹ m² s⁻¹", "diffusion")?.approx, true, "range flagged approx");

// display: canonical ladder reads in µm²/s for typical IL magnitudes
assert.equal(formatStd(5.2e-11, "m²/s"), "52 µm²/s");
assert.equal(stdLabel(parseQuantity("8.0e-12 m2/s", "diffusion")), "8 µm²/s");

// the sci-notation collapse only fires on signed exponents — "× 10 nN" is NOT
// rewritten to e-notation (the value stays the leading number, 5 nN)
assert.ok(close(parseQuantity("5 × 10 nN", "force")?.std ?? null, 5e-9, 1e-12), "unsigned ×10 untouched");
assert.ok(close(parseQuantity("45 cP", "viscosity")?.std, 0.045), "viscosity unaffected");

console.log("Diffusion unit conversion tests passed");
