import { MAX_TABLE_BYTES, parseSimpleCsv } from "./simpleTable";
import { liveFields, validateLiveRows, type LiveDomain, type LiveRow } from "./liveFields";

export async function parseLiveTable(name: string, bytes: Uint8Array, domain: LiveDomain): Promise<LiveRow[]> {
  if (!bytes.length || bytes.length > MAX_TABLE_BYTES) throw new Error("Upload a table no larger than 5 MB.");
  let cells: string[][];
  if (/\.xlsx$/i.test(name)) {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as never);
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount > 101 || sheet.columnCount > 100) throw new Error("Use the first worksheet, with at most 100 records and 100 columns.");
    cells = [];
    sheet.eachRow((row) => {
      const values: string[] = [];
      for (let col = 1; col <= sheet.columnCount; col++) {
        const cell = row.getCell(col);
        if (cell.type === ExcelJS.ValueType.Formula) throw new Error("Paste spreadsheet formulas as values before uploading.");
        values.push(cell.text);
      }
      cells.push(values);
    });
  } else {
    if (!/\.(csv|tsv)$/i.test(name)) throw new Error("Select CSV, TSV, or XLSX.");
    cells = parseSimpleCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes), /\.tsv$/i.test(name) ? "\t" : ",");
  }
  const meaningful = cells.filter((row) => row.some((cell) => cell.trim()));
  const headers = meaningful.shift()?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const fields = liveFields(domain);
  const indices = fields.map(({ key, label }) => {
    const matches = headers.flatMap((header, i) => [key.toLowerCase(), label.toLowerCase()].includes(header) ? [i] : []);
    if (matches.length !== 1) throw new Error(`Use the ${domain} template: exactly one ${key} column is required.`);
    return matches[0];
  });
  return validateLiveRows(meaningful.map((row) => Object.fromEntries(fields.map(({ key }, i) => {
    const raw = row[indices[i]] ?? "";
    // Reverse only the explicit spreadsheet-safety prefix used by our CSV exporter.
    return [key, /^'\s*[=+@-]/.test(raw) ? raw.slice(1) : raw];
  }))), domain);
}
