import * as XLSX from "xlsx";
import type { ParsedInvoiceRow } from "../../types/invoice";

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
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

function parseDate(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;

  return date.toISOString().slice(0, 10);
}

function findColumn(headers: string[], choices: string[]): number {
  return headers.findIndex((header: string) =>
    choices.some(choice => header === choice || header.includes(choice))
  );
}

export async function readInvoice(file: File): Promise<ParsedInvoiceRow[]> {
  if (!/\.(xls|xlsx)$/i.test(file.name)) {
    throw new Error("Use an .xls or .xlsx invoice file.");
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
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

  let headerRowIndex = -1;
  let headers: string[] = [];

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 40); rowIndex++) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    const normalized: string[] = row.map(normalizeHeader);

    const techIndex = findColumn(normalized, [
      "tech#",
      "tech #",
      "tech number",
      "technician",
      "tech",
    ]);

    const codeIndex = findColumn(normalized, [
      "job code",
      "billing code",
      "item code",
      "code",
    ]);

    if (techIndex >= 0 && codeIndex >= 0) {
      headerRowIndex = rowIndex;
      headers = normalized;
      break;
    }
  }

  if (headerRowIndex < 0) {
    throw new Error('Could not find invoice headers such as "Tech#" and "Job Code".');
  }

  const techColumn = findColumn(headers, [
    "tech#",
    "tech #",
    "tech number",
    "technician",
    "tech",
  ]);
  const dateColumn = findColumn(headers, [
    "completion date",
    "completed date",
    "date completed",
    "completion",
    "date",
  ]);
  const jobNumberColumn = findColumn(headers, [
    "job number",
    "job #",
    "work order",
    "order number",
    "job",
  ]);
  const jobCodeColumn = findColumn(headers, [
    "job code",
    "billing code",
    "item code",
    "code",
  ]);
  const descriptionColumn = findColumn(headers, [
    "description",
    "item description",
    "job description",
  ]);
  const quantityColumn = findColumn(headers, ["qty", "quantity"]);
  const unitAmountColumn = findColumn(headers, [
    "unit amount",
    "unit price",
    "invoice rate",
    "price",
  ]);
  const totalColumn = findColumn(headers, [
    "item total",
    "line total",
    "invoice total",
    "extended amount",
    "total",
  ]);

  const parsed: ParsedInvoiceRow[] = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    const techNumber = String(row[techColumn] ?? "").trim().toUpperCase();
    const jobCode = String(row[jobCodeColumn] ?? "").trim().toUpperCase();

    if (!techNumber || !jobCode) continue;
    if (/^(total|totals)$/i.test(techNumber) || /^(total|totals)$/i.test(jobCode)) continue;

    const quantityRaw = quantityColumn >= 0 ? parseMoney(row[quantityColumn]) : 1;
    const quantity = Number.isFinite(quantityRaw) && quantityRaw !== 0 ? quantityRaw : 1;

    const unitRaw = unitAmountColumn >= 0 ? parseMoney(row[unitAmountColumn]) : Number.NaN;
    const totalRaw = totalColumn >= 0 ? parseMoney(row[totalColumn]) : Number.NaN;

    const invoiceUnitAmount = Number.isFinite(unitRaw) ? unitRaw : null;
    const invoiceTotal = Number.isFinite(totalRaw)
      ? totalRaw
      : invoiceUnitAmount != null
        ? invoiceUnitAmount * quantity
        : 0;

    const rawRow: Record<string, unknown> = {};
    headers.forEach((header: string, index: number) => {
      if (header) rawRow[header] = row[index];
    });

    parsed.push({
      source_row_number: rowIndex + 1,
      tech_number: techNumber,
      completion_date: dateColumn >= 0 ? parseDate(row[dateColumn]) : null,
      job_number:
        jobNumberColumn >= 0 ? String(row[jobNumberColumn] ?? "").trim() || null : null,
      job_code: jobCode,
      description:
        descriptionColumn >= 0
          ? String(row[descriptionColumn] ?? "").trim() || null
          : null,
      quantity,
      invoice_unit_amount: invoiceUnitAmount,
      invoice_total: invoiceTotal,
      raw_row: rawRow,
    });
  }

  if (!parsed.length) {
    throw new Error("No invoice line items were found.");
  }

  return parsed;
}
