import ExcelJS from "exceljs";
import type { TabularScalar, TabularSheet } from "./types";

const MAX_ROWS = 50_000;
const MAX_COLUMNS = 256;

export async function parseTabularFile(filename: string, bytes: Uint8Array): Promise<TabularSheet[]> {
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "csv" || extension === "tsv") {
    const delimiter = extension === "tsv" ? "\t" : ",";
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
    return [rowsToSheet(filename, parseDelimitedRows(text, delimiter))];
  }
  if (extension !== "xlsx") throw new Error("Supported dataset formats: .xlsx, .csv, .tsv");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const sheets: TabularSheet[] = [];
  workbook.eachSheet((worksheet) => {
    if (worksheet.rowCount > MAX_ROWS) {
      throw new Error(`${worksheet.name}: ${worksheet.rowCount} rows exceeds the ${MAX_ROWS} row limit`);
    }
    if (worksheet.columnCount > MAX_COLUMNS) {
      throw new Error(`${worksheet.name}: ${worksheet.columnCount} columns exceeds the ${MAX_COLUMNS} column limit`);
    }
    const rows: TabularScalar[][] = [];
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row: TabularScalar[] = [];
      for (let column = 1; column <= worksheet.columnCount; column += 1) {
        row.push(cellValue(worksheet.getCell(rowNumber, column).value));
      }
      rows.push(row);
    }
    sheets.push(rowsToSheet(worksheet.name, rows));
  });
  return sheets.filter((sheet) => sheet.headers.some(Boolean));
}

function rowsToSheet(name: string, rows: TabularScalar[][]): TabularSheet {
  if (rows.length > MAX_ROWS) throw new Error(`${name}: ${rows.length} rows exceeds the ${MAX_ROWS} row limit`);
  const headerIndex = rows.findIndex((row) => row.some((value) => displayValue(value).trim()));
  if (headerIndex < 0) return { name, headerRow: 1, headers: [], rows: [] };
  const headers = rows[headerIndex].map((value, index) => displayValue(value).trim() || `column_${index + 1}`);
  if (headers.length > MAX_COLUMNS) throw new Error(`${name}: ${headers.length} columns exceeds the ${MAX_COLUMNS} column limit`);
  return {
    name,
    headerRow: headerIndex + 1,
    headers,
    rows: rows.slice(headerIndex + 1).flatMap((values, index) =>
      values.some((value) => displayValue(value).trim())
        ? [{ rowNumber: headerIndex + index + 2, values: values.slice(0, headers.length) }]
        : []
    ),
  };
}

function cellValue(value: ExcelJS.CellValue): TabularScalar {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date) {
    return value as TabularScalar;
  }
  if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("hyperlink" in value) return value.text || value.hyperlink;
  return String(value);
}

export function displayValue(value: TabularScalar): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function parseDelimitedRows(text: string, delimiter: string): TabularScalar[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}
