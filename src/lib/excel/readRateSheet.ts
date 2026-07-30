import * as XLSX from "xlsx";
import type { ParsedRateRow } from "../../types/payroll";

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizePayrollCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function parseMoney(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const cleaned = String(value ?? "")
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .trim();

  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

export async function readRateSheet(file: File): Promise<ParsedRateRow[]> {
  if (!/\.(xls|xlsx)$/i.test(file.name)) {
    throw new Error("Use an .xls or .xlsx rate-sheet file.");
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("The workbook does not contain a worksheet.");
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    defval: "",
  });

  if (!rows.length) {
    throw new Error("The first worksheet is empty.");
  }

  let headerRowIndex = -1;
  let codeColumn = -1;
  let descriptionColumn = -1;
  let rateColumn = -1;

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex++) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    const headers: string[] = row.map(normalizeHeader);

    const possibleCode = headers.findIndex((header: string) =>
      header === "code" ||
      header === "job code" ||
      header === "billing code" ||
      header.includes("job code")
    );

    const possibleRate = headers.findIndex((header: string) =>
      header === "unit price" ||
      header === "unit rate" ||
      header === "rate" ||
      header === "contractor rate" ||
      header === "pay rate" ||
      header.includes("unit price") ||
      header.includes("pay rate")
    );

    if (possibleCode >= 0 && possibleRate >= 0) {
      headerRowIndex = rowIndex;
      codeColumn = possibleCode;
      rateColumn = possibleRate;
      descriptionColumn = headers.findIndex((header: string) =>
        header === "description" ||
        header === "job description" ||
        header.includes("description")
      );
      break;
    }
  }

  if (headerRowIndex < 0) {
    throw new Error(
      'Could not find the headers. Expected columns such as "Code" and "Unit Price".'
    );
  }

  const deduped = new Map<string, ParsedRateRow>();

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    const rawCode = String(row[codeColumn] ?? "").trim();
    const rate = parseMoney(row[rateColumn]);
    const description =
      descriptionColumn >= 0
        ? String(row[descriptionColumn] ?? "").trim()
        : "";

    if (!rawCode || !Number.isFinite(rate) || rate < 0) continue;
    if (/^(code|job code|total|totals)$/i.test(rawCode)) continue;

    const code = rawCode.toUpperCase().trim();
    const normalizedCode = normalizePayrollCode(code);
    if (!normalizedCode) continue;

    deduped.set(normalizedCode, {
      job_code: code,
      description: description || null,
      unit_rate: rate,
    });
  }

  const parsed = Array.from(deduped.values()).sort((a, b) =>
    a.job_code.localeCompare(b.job_code)
  );

  if (!parsed.length) {
    throw new Error("No valid code and rate rows were found.");
  }

  return parsed;
}
