import assert from "node:assert/strict";
import { parseQuantity } from "../units";

// 优化后的 close 函数，避免重复计算
const close = (a: number | null | undefined, b: number, tol = 1e-9) =>
  a != null && Math.abs(a - b) < tol;

// conductivity → S/m
const conductivityTests = [
  { input: "12 mS/cm", expected: 1.2, description: "12 mS/cm = 1.2 S/m" },
  { input: "1 S/cm", expected: 100, description: "1 S/cm = 100 S/m" },
  { input: "120 µS/cm", expected: 0.012, description: "120 µS/cm = 0.012 S/m" },
  { input: "3.5 mS/cm", expected: 0.35, description: "3.5 mS/cm = 0.35 S/m" },
  { input: "0.5 S/m", expected: 0.5, description: "0.5 S/m unchanged" },
  { input: "0 µS/cm", expected: 0, description: "0 µS/cm = 0 S/m" }, // 边界值测试
  { input: "10−5 S/cm", expected: 0.001, description: "10−5 S/cm = 0.001 S/m" },
];

// 批量测试 conductivity
conductivityTests.forEach(({ input, expected, description }) => {
  assert.ok(close(parseQuantity(input, "conductivity")?.std, expected), description);
});

// viscosity → Pa·s
const viscosityTests = [
  { input: "45 cP", expected: 0.045, description: "45 cP = 0.045 Pa·s" },
  { input: "45 mPa·s", expected: 0.045, description: "45 mPa·s = 0.045 Pa·s" },
  { input: "0.045 Pa·s", expected: 0.045, description: "0.045 Pa·s unchanged" },
  { input: "1 P", expected: 0.1, description: "1 P = 0.1 Pa·s" },
  { input: "28 mPas", expected: 0.028, description: "mPas alias → mPa·s" },
  { input: "0 cP", expected: 0, description: "0 cP = 0 Pa·s" }, // 边界值测试
];

// 批量测试 viscosity
viscosityTests.forEach(({ input, expected, description }) => {
  assert.ok(close(parseQuantity(input, "viscosity")?.std, expected), description);
});

const electricalTests = [
  { input: "120 pF", dimension: "capacitance" as const, expected: 1.2e-10, description: "120 pF = 1.2e-10 F" },
  { input: "1 µF", dimension: "capacitance" as const, expected: 1e-6, description: "1 µF = 1e-6 F" },
  { input: "1 uF", dimension: "capacitance" as const, expected: 1e-6, description: "1 uF = 1e-6 F" },
  { input: "0.5 F", dimension: "capacitance" as const, expected: 0.5, description: "0.5 F unchanged" },
  { input: "1 kV/m", dimension: "electricField" as const, expected: 1000, description: "1 kV/m = 1000 V/m" },
  { input: "500 V/m", dimension: "electricField" as const, expected: 500, description: "500 V/m unchanged" },
  { input: "2 kV/cm", dimension: "electricField" as const, expected: 200000, description: "2 kV/cm = 200000 V/m" },
  { input: "0.5 MV/m", dimension: "electricField" as const, expected: 500000, description: "0.5 MV/m = 500000 V/m" },
  { input: "0.2 V/Å", dimension: "electricField" as const, expected: 2e9, description: "0.2 V/Å = 2e9 V/m" },
  { input: "4.2 kΩ", dimension: "resistance" as const, expected: 4200, description: "4.2 kΩ = 4200 Ω" },
];

electricalTests.forEach(({ input, dimension, expected, description }) => {
  assert.ok(close(parseQuantity(input, dimension)?.std, expected), description);
});

const arealCapacitance = parseQuantity("82.9 µF/cm²", "capacitance");
assert.equal(arealCapacitance?.value, 82.9);
assert.equal(arealCapacitance?.unit, "µF/cm2");
assert.equal(arealCapacitance?.std, null, "areal capacitance must not be converted to absolute F");

const specificResistance = parseQuantity("255.5 Ω cm²", "resistance");
assert.equal(specificResistance?.value, 255.5);
assert.equal(specificResistance?.unit, "Ω/cm2");
assert.equal(specificResistance?.std, null, "area-normalized resistance must not be converted to absolute Ω");

// 测试原始单位是否保留
const rawUnitTests = [
  { input: "12 mS/cm", type: "conductivity" as const, expected: "mS/cm" },
  { input: "45 cP", type: "viscosity" as const, expected: "cP" },
];

rawUnitTests.forEach(({ input, type, expected }) => {
  assert.equal(parseQuantity(input, type)?.unit, expected, `${input} retains unit ${expected}`);
});

console.log("Conductivity unit conversion tests passed");
