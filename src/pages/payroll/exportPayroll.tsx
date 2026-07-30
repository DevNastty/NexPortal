
import * as XLSX from "xlsx";
import { supabase } from "../../supabase";
import type { PayrollPreviewRow } from "../../types/invoice";

const DAY_HEADERS = ["SUN", "MON", "TUES", "WED", "THURS", "FRI", "SAT"] as const;

type RateRow = {
  rate_sheet_id: string;
  job_code: string;
  description: string | null;
  unit_rate: number;
};

function normalizeCode(value: string): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function safeSheetName(value: string): string {
  const cleaned = value.replace(/[\\/?*\[\]:]/g, "-").trim() || "Sheet";
  return cleaned.slice(0, 31);
}

function excelDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

function weekEndingSaturday(rows: PayrollPreviewRow[]): Date {
  const dates = rows
    .map(row => row.completion_date)
    .filter((value): value is string => Boolean(value))
    .map(value => new Date(`${value}T12:00:00`))
    .filter(date => !Number.isNaN(date.getTime()));

  const latest = dates.length
    ? new Date(Math.max(...dates.map(date => date.getTime())))
    : new Date();

  const daysUntilSaturday = (6 - latest.getDay() + 7) % 7;
  latest.setDate(latest.getDate() + daysUntilSaturday);
  return latest;
}

function formatWeekEnding(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

function triggerDownload(workbook: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(workbook, filename, {
    bookType: "xlsx",
    compression: true,
  });
}

export async function exportPayrollWorkbook(preview: PayrollPreviewRow[]): Promise<void> {
  const matched = preview.filter(row => row.match_status === "matched");
  const issues = preview.length - matched.length;

  if (!matched.length) {
    throw new Error("There are no matched payroll rows to export.");
  }

  if (issues > 0) {
    throw new Error(`Fix the ${issues} payroll issue${issues === 1 ? "" : "s"} before downloading.`);
  }

  const rateSheetIds = Array.from(
    new Set(matched.map(row => row.rate_sheet_id).filter((id): id is string => Boolean(id)))
  );

  const { data: rateData, error: rateError } = await supabase
    .from("payroll_rates")
    .select("rate_sheet_id, job_code, description, unit_rate")
    .in("rate_sheet_id", rateSheetIds)
    .order("job_code");

  if (rateError) throw rateError;

  const rates = (rateData || []) as RateRow[];
  const ratesBySheet = new Map<string, RateRow[]>();
  for (const rate of rates) {
    const current = ratesBySheet.get(rate.rate_sheet_id) || [];
    current.push(rate);
    ratesBySheet.set(rate.rate_sheet_id, current);
  }

  const workbook = XLSX.utils.book_new();
  const weekEnding = weekEndingSaturday(matched);
  const weekEndingText = formatWeekEnding(weekEnding);

  const rowsByTech = new Map<string, PayrollPreviewRow[]>();
  for (const row of matched) {
    const current = rowsByTech.get(row.tech_number) || [];
    current.push(row);
    rowsByTech.set(row.tech_number, current);
  }

  const summaryRows: (string | number)[][] = [
    ["BPS PAYROLL SUMMARY"],
    ["Week Ending", weekEndingText],
    [],
    ["TECH #", "TECH NAME", "REGION", "COMPANY", "PAYEE", "PAY SHEET", "INVOICE TOTAL", "CONTRACTOR PAY", "MARGIN"],
  ];

  for (const [techNumber, techRows] of Array.from(rowsByTech.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const first = techRows[0];
    const invoiceTotal = techRows.reduce((sum, row) => sum + row.invoice_total, 0);
    const contractorPay = techRows.reduce((sum, row) => sum + (row.contractor_pay || 0), 0);
    const margin = techRows.reduce((sum, row) => sum + (row.company_margin || 0), 0);

    summaryRows.push([
      techNumber,
      first.technician_name || "",
      first.region || "",
      first.company_name || "",
      first.payee_name || "",
      first.rate_sheet_name || "",
      invoiceTotal,
      contractorPay,
      margin,
    ]);
  }

  summaryRows.push([]);
  summaryRows.push([
    "TOTAL",
    "",
    "",
    "",
    "",
    "",
    matched.reduce((sum, row) => sum + row.invoice_total, 0),
    matched.reduce((sum, row) => sum + (row.contractor_pay || 0), 0),
    matched.reduce((sum, row) => sum + (row.company_margin || 0), 0),
  ]);

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];
  summarySheet["!cols"] = [
    { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 20 }, { wch: 22 },
    { wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
  ];
  summarySheet["!autofilter"] = { ref: `A4:I${summaryRows.length}` };
  for (let row = 5; row <= summaryRows.length; row++) {
    for (const col of ["G", "H", "I"]) {
      const cell = summarySheet[`${col}${row}`];
      if (cell) cell.z = "$#,##0.00";
    }
  }
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  const usedSheetNames = new Set<string>(["Summary"]);
  const uniqueName = (base: string) => {
    let name = safeSheetName(base);
    let attempt = 1;
    while (usedSheetNames.has(name)) {
      const suffix = `-${attempt++}`;
      name = safeSheetName(base).slice(0, 31 - suffix.length) + suffix;
    }
    usedSheetNames.add(name);
    return name;
  };

  for (const [techNumber, techRows] of Array.from(rowsByTech.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const first = techRows[0];
    const rateSheetId = first.rate_sheet_id;
    const sheetRates = rateSheetId ? ratesBySheet.get(rateSheetId) || [] : [];

    const byCode = new Map<string, PayrollPreviewRow[]>();
    for (const row of techRows) {
      const key = normalizeCode(row.job_code);
      const current = byCode.get(key) || [];
      current.push(row);
      byCode.set(key, current);
    }

    const weeklyRows: (string | number)[][] = [
      ["", "BPS"],
      [`COMCAST PG RESIDENTIAL INSTALLS - TECH NAME: ${first.technician_name || techNumber}`],
      [`Week Ending: ${weekEndingText}`],
      ["CODE", "DESCRIPTION", ...DAY_HEADERS, "TTL", "UNIT PRICE", "TOTAL"],
    ];

    const representedCodes = new Set<string>();
    for (const rate of sheetRates) {
      const codeKey = normalizeCode(rate.job_code);
      representedCodes.add(codeKey);
      const codeRows = byCode.get(codeKey) || [];
      const dayQuantities = Array(7).fill(0) as number[];

      for (const row of codeRows) {
        if (!row.completion_date) continue;
        const date = new Date(`${row.completion_date}T12:00:00`);
        if (!Number.isNaN(date.getTime())) dayQuantities[date.getDay()] += row.quantity;
      }

      const totalQty = dayQuantities.reduce((sum, value) => sum + value, 0);
      const unitRate = Number(rate.unit_rate);
      weeklyRows.push([
        rate.job_code,
        rate.description || codeRows[0]?.description || "",
        ...dayQuantities,
        totalQty,
        unitRate,
        totalQty * unitRate,
      ]);
    }

    for (const [codeKey, codeRows] of byCode.entries()) {
      if (representedCodes.has(codeKey)) continue;
      const firstCodeRow = codeRows[0];
      const dayQuantities = Array(7).fill(0) as number[];
      for (const row of codeRows) {
        if (!row.completion_date) continue;
        const date = new Date(`${row.completion_date}T12:00:00`);
        if (!Number.isNaN(date.getTime())) dayQuantities[date.getDay()] += row.quantity;
      }
      const totalQty = dayQuantities.reduce((sum, value) => sum + value, 0);
      const unitRate = firstCodeRow.contractor_unit_rate || 0;
      weeklyRows.push([
        firstCodeRow.job_code,
        firstCodeRow.description || "",
        ...dayQuantities,
        totalQty,
        unitRate,
        totalQty * unitRate,
      ]);
    }

    weeklyRows.push([]);
    weeklyRows.push([
      "",
      "TOTAL PAY",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      techRows.reduce((sum, row) => sum + (row.contractor_pay || 0), 0),
    ]);

    const weeklySheet = XLSX.utils.aoa_to_sheet(weeklyRows);
    weeklySheet["!merges"] = [
      { s: { r: 0, c: 1 }, e: { r: 0, c: 11 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 11 } },
    ];
    weeklySheet["!cols"] = [
      { wch: 14 }, { wch: 52 },
      { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
      { wch: 9 }, { wch: 13 }, { wch: 14 },
    ];
    weeklySheet["!freeze"] = { xSplit: 2, ySplit: 4 };
    weeklySheet["!autofilter"] = { ref: `A4:L${Math.max(4, weeklyRows.length - 2)}` };

    for (let row = 5; row <= weeklyRows.length; row++) {
      const unitCell = weeklySheet[`K${row}`];
      const totalCell = weeklySheet[`L${row}`];
      if (unitCell) unitCell.z = "$#,##0.00";
      if (totalCell) totalCell.z = "$#,##0.00";
    }

    XLSX.utils.book_append_sheet(workbook, weeklySheet, uniqueName(techNumber));

    const paidRows: (string | number)[][] = [
      ["CODE", "COMPLETION DATE", "QTY", "JOB NUMBER", "DESCRIPTION", "UNIT RATE", "TOTAL PAY"],
      ...techRows
        .slice()
        .sort((a, b) =>
          String(a.completion_date || "").localeCompare(String(b.completion_date || "")) ||
          String(a.job_number || "").localeCompare(String(b.job_number || "")) ||
          a.job_code.localeCompare(b.job_code)
        )
        .map(row => [
          row.job_code,
          excelDate(row.completion_date),
          row.quantity,
          row.job_number || "",
          row.description || "",
          row.contractor_unit_rate || 0,
          row.contractor_pay || 0,
        ]),
    ];

    const paidSheet = XLSX.utils.aoa_to_sheet(paidRows);
    paidSheet["!cols"] = [
      { wch: 14 }, { wch: 18 }, { wch: 9 }, { wch: 18 }, { wch: 44 }, { wch: 13 }, { wch: 14 },
    ];
    paidSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    paidSheet["!autofilter"] = { ref: `A1:G${paidRows.length}` };
    for (let row = 2; row <= paidRows.length; row++) {
      const rateCell = paidSheet[`F${row}`];
      const payCell = paidSheet[`G${row}`];
      if (rateCell) rateCell.z = "$#,##0.00";
      if (payCell) payCell.z = "$#,##0.00";
    }

    XLSX.utils.book_append_sheet(workbook, paidSheet, uniqueName(`Paid-${techNumber}`));
  }

  triggerDownload(workbook, `BPS_Payroll_${weekEndingText.replace(/\//g, "-")}.xlsx`);
}
