import { TEACHING_FIELDS, type SimpleRow } from "./simpleShared";
import type { TeachingFieldKey } from "../teachingShared";

type TableField<Key extends string> = { key: Key; label: string };

const ALIASES: Record<string, string[]> = {
  cation: ["cation", "阳离子"], anion: ["anion", "阴离子"],
  substrate: ["substrate", "基底", "基材"], temperature: ["temperature", "温度"],
  load: ["load", "载荷", "负载"], cof: ["cof", "摩擦系数", "coefficient of friction"],
};
export const MAX_TABLE_BYTES = 5 * 1024 * 1024;
export function emptySimpleRow(): SimpleRow {
  return { cation: "", anion: "", substrate: "", temperature: "", load: "", cof: "" };
}

// Quoted CSV cells may contain commas, escaped quotes and newlines.
export function parseSimpleCsv(text: string, separator = ","): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell === "") quoted = !quoted;
      else cell += char;
    } else if (!quoted && char === separator) { row.push(cell); cell = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Unclosed CSV quote. Check the table format.");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function simpleRowsFromCells<FieldKey extends string = TeachingFieldKey>(
  cells: string[][],
  fields: readonly TableField<FieldKey>[] = TEACHING_FIELDS as unknown as readonly TableField<FieldKey>[],
): Array<Record<FieldKey, string>> {
  const meaningful = cells.filter((row) => row.some((cell) => cell.trim()));
  const headers = meaningful.shift()?.map((header) => header.trim().toLowerCase()) ?? [];
  const indices = fields.map(({ key, label }) => {
    const aliases = ALIASES[key] ?? [key.toLowerCase(), label.toLowerCase()];
    const matches = headers.flatMap((header, index) => aliases.includes(header) ? [index] : []);
    if (matches.length !== 1) throw new Error(`The header must contain exactly one ${label} column. Use the template.`);
    return matches[0];
  });
  if (!meaningful.length || meaningful.length > 100) throw new Error("The table must contain 1–100 records.");
  return meaningful.map((row) => Object.fromEntries(fields.map(({ key }, index) => {
    const value = (row[indices[index]] ?? "").trim();
    if (value.length > 500) throw new Error("Each field must be at most 500 characters.");
    return [key, value];
  })) as Record<FieldKey, string>);
}

export async function parseSimpleTable<FieldKey extends string = TeachingFieldKey>(
  name: string,
  bytes: Uint8Array,
  fields: readonly TableField<FieldKey>[] = TEACHING_FIELDS as unknown as readonly TableField<FieldKey>[],
): Promise<Array<Record<FieldKey, string>>> {
  if (!bytes.length || bytes.length > MAX_TABLE_BYTES) throw new Error("Upload a table no larger than 5 MB.");
  if (/\.xlsx$/i.test(name)) {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as never);
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount > 101 || sheet.columnCount > 100) throw new Error("Place data on the first worksheet, with at most 100 records and 100 columns.");
    const cells: string[][] = [];
    sheet.eachRow((row) => {
      const values: string[] = [];
      for (let col = 1; col <= sheet.columnCount; col++) {
        const cell = row.getCell(col);
        if (cell.type === ExcelJS.ValueType.Formula) throw new Error("The table contains formulas. Paste them as values before uploading.");
        values.push(cell.text);
      }
      cells.push(values);
    });
    return simpleRowsFromCells(cells, fields);
  }
  if (!/\.(csv|tsv)$/i.test(name)) throw new Error("Select a CSV, TSV, or XLSX table.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("Save the CSV as UTF-8 before uploading."); }
  return simpleRowsFromCells(parseSimpleCsv(text, /\.tsv$/i.test(name) ? "\t" : ","), fields);
}

export function simpleTemplateCsv<FieldKey extends string = TeachingFieldKey>(
  fields: readonly { key: FieldKey }[] = TEACHING_FIELDS as unknown as readonly { key: FieldKey }[],
): string {
  return "\uFEFF" + fields.map(({ key }) => key).join(",") + "\r\n";
}
