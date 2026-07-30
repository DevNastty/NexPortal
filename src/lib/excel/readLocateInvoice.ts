import * as XLSX from "xlsx";
import type { ParsedInvoiceRow } from "../../types/invoice";

function parseDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? `${parsed.y}-${String(parsed.m).padStart(2,"0")}-${String(parsed.d).padStart(2,"0")}` : null;
  }
  const raw = String(value).trim();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw || null : d.toISOString().slice(0,10);
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export async function readLocateInvoice(file: File): Promise<ParsedInvoiceRow[]> {
  if (!/\.(xls|xlsx)$/i.test(file.name)) throw new Error("Use an .xls or .xlsx locate invoice.");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The workbook does not contain a worksheet.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
  const parsed: ParsedInvoiceRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const code = String(row[15] ?? "").trim().toUpperCase(); // K
    const rawQuantity = numberValue(row[17]); // M
    const locator = String(row[19] ?? "").trim(); // O
    const completed = parseDate(row[16]); // Q
    if (!code || !locator || rawQuantity <= 0) continue;
    if (/^(code|total|totals)$/i.test(code) || /^(locator|name)$/i.test(locator)) continue;
    const tickets = Math.ceil(rawQuantity / 500);
    parsed.push({
      source_row_number: i + 1,
      tech_number: locator,
      completion_date: completed,
      job_number: null,
      job_code: code,
      description: null,
      quantity: tickets,
      invoice_unit_amount: null,
      invoice_total: 0,
      raw_row: { locate_code: code, raw_quantity: rawQuantity, tickets, locator, date_done: completed },
    });
  }
  if (!parsed.length) throw new Error("No locate lines were found using P=code, R=quantity, T=locator, Q=date done.");
  return parsed;
}
