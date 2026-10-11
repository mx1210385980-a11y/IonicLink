import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseSimpleCsv, parseSimpleTable, simpleRowsFromCells } from "./simpleTable";

async function run() {
  const csv = '\uFEFF阳离子,阴离子,基底,温度,载荷,摩擦系数\r\n"EMIM, test",BF4,"steel\n polished",25 °C,5 nN,0.1\r\n';
  const parsed = await parseSimpleTable("results.csv", new TextEncoder().encode(csv));
  assert.equal(parsed[0].cation, "EMIM, test"); assert.equal(parsed[0].substrate, "steel\n polished");
  assert.equal(parsed[0].load, "5 nN");
  assert.deepEqual(parseSimpleCsv('"a""b",c'), [['a"b', 'c']]);
  assert.throws(() => parseSimpleCsv('"broken,c'), /quote/);
  assert.throws(() => simpleRowsFromCells([["cation", "anion"], ["EMIM", "BF4"]]), /header/);
  assert.throws(() => simpleRowsFromCells([["cation", "anion", "substrate", "temperature", "load", "cof", "cof"], ["a"]]), /exactly one/);
  assert.throws(() => simpleRowsFromCells([["cation", "anion", "substrate", "temperature", "load", "cof"]]), /1–100/);
  await assert.rejects(parseSimpleTable("old.xls", new Uint8Array([1])), /CSV/);
  await assert.rejects(parseSimpleTable("bad.csv", new Uint8Array([0xff, 0xfe, 0xfe])), /UTF-8/);
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("results");
  sheet.addRow(["cation", "anion", "substrate", "temperature", "load", "cof"]);
  sheet.addRow(["EMIM", "BF4", "steel", "298.15 K", "1 N", 0.1]);
  assert.equal((await parseSimpleTable("test.xlsx", new Uint8Array(await workbook.xlsx.writeBuffer())))[0].cof, "0.1");
  sheet.getCell("F2").value = { formula: "1/10", result: 0.1 };
  await assert.rejects(parseSimpleTable("test.xlsx", new Uint8Array(await workbook.xlsx.writeBuffer())), /formulas/);
  console.log("simple table parser tests passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
