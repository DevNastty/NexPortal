import * as XLSX from "xlsx";
import type { PayrollPreviewRow } from "../../types/invoice";

function safeSheetName(value: string): string {
  return value
    .replace(/[\\/?*\[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31) || "Sheet";
}

function safeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim() || "Payroll";
}

function numberValue(value: number | null | undefined): number {
  return Number(value || 0);
}

const CURRENCY_FORMAT = "$#,##0.00";

function formatCurrencyColumn(
  sheet: XLSX.WorkSheet,
  columnIndex: number,
  startRowIndex: number,
  endRowIndex?: number
): void {
  if (!sheet["!ref"]) return;

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const lastRow = endRowIndex ?? range.e.r;

  for (let rowIndex = startRowIndex; rowIndex <= lastRow; rowIndex++) {
    const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
    const cell = sheet[address];

    if (!cell || typeof cell.v !== "number") continue;

    cell.t = "n";
    cell.z = CURRENCY_FORMAT;
    cell.s = {
      ...(cell.s || {}),
      alignment: {
        ...((cell.s && cell.s.alignment) || {}),
        horizontal: "right",
      },
    };
  }
}

function formatHeaderRow(
  sheet: XLSX.WorkSheet,
  rowIndex: number,
  startColumnIndex: number,
  endColumnIndex: number
): void {
  for (
    let columnIndex = startColumnIndex;
    columnIndex <= endColumnIndex;
    columnIndex++
  ) {
    const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
    const cell = sheet[address];
    if (!cell) continue;

    cell.s = {
      ...(cell.s || {}),
      font: {
        ...((cell.s && cell.s.font) || {}),
        bold: true,
        color: { rgb: "FFFFFF" },
      },
      fill: {
        patternType: "solid",
        fgColor: { rgb: "1E3A5F" },
      },
      alignment: {
        ...((cell.s && cell.s.alignment) || {}),
        horizontal: "center",
      },
    };
  }
}

function isBPS(companyName: string | null | undefined): boolean {
  const normalized = String(companyName || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "");

  return normalized === "jcomm" || normalized === "jcomm llc";
}

function getWeekEnding(rows: PayrollPreviewRow[]): string {
  const validDates = rows
    .map(row => row.completion_date)
    .filter((value): value is string => Boolean(value))
    .map(value => new Date(`${value}T12:00:00`))
    .filter(date => !Number.isNaN(date.getTime()));

  if (!validDates.length) {
    return new Date().toISOString().slice(0, 10);
  }

  const latest = new Date(Math.max(...validDates.map(date => date.getTime())));
  const daysUntilSaturday = (6 - latest.getDay() + 7) % 7;
  latest.setDate(latest.getDate() + daysUntilSaturday);

  return latest.toISOString().slice(0, 10);
}

function getTruckLeaseDeduction(rows: PayrollPreviewRow[]): number {
  const first = rows.find(row => numberValue(row.truck_lease_amount) > 0);
  return first ? numberValue(first.truck_lease_amount) : 0;
}

function getMeterLeaseDeduction(rows: PayrollPreviewRow[]): number {
  const first = rows.find(
    row => row.meter_lease_active && numberValue(row.meter_lease_amount) > 0
  );
  return first ? numberValue(first.meter_lease_amount) : 0;
}

function getMissedQcDeduction(rows: PayrollPreviewRow[]): number {
  const first = rows.find(row => numberValue(row.missed_qc_deduction) > 0);
  return first ? numberValue(first.missed_qc_deduction) : 0;
}

function getManualAdjustment(rows: PayrollPreviewRow[]): number {
  const first = rows.find(row => Number(row.manual_adjustment_amount || 0) !== 0);
  return first ? numberValue(first.manual_adjustment_amount) : 0;
}

function getManualAdjustmentReason(rows: PayrollPreviewRow[]): string {
  return String(rows.find(row => String(row.manual_adjustment_reason || "").trim())?.manual_adjustment_reason || "").trim();
}

function getTotalDeductions(rows: PayrollPreviewRow[]): number {
  return (
    getTruckLeaseDeduction(rows) +
    getMeterLeaseDeduction(rows) +
    getMissedQcDeduction(rows) -
    getManualAdjustment(rows)
  );
}

function dayIndex(dateValue: string | null): number | null {
  if (!dateValue) return null;

  const date = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  return date.getDay();
}

function createWeeklySheet(rows: PayrollPreviewRow[]): XLSX.WorkSheet {
  const first = rows[0];
  const weekEnding = getWeekEnding(rows);

  const grouped = new Map<
    string,
    {
      description: string;
      quantities: number[];
      totalQty: number;
      unitRate: number;
      totalPay: number;
    }
  >();

  for (const row of rows) {
    const key = row.job_code;
    const current = grouped.get(key) || {
      description: row.description || "",
      quantities: [0, 0, 0, 0, 0, 0, 0],
      totalQty: 0,
      unitRate: numberValue(row.contractor_unit_rate),
      totalPay: 0,
    };

    const index = dayIndex(row.completion_date);
    if (index != null) current.quantities[index] += row.quantity;

    current.totalQty += row.quantity;
    current.unitRate = numberValue(row.contractor_unit_rate);
    current.totalPay = current.totalQty * current.unitRate;

    grouped.set(key, current);
  }

  const rowsOut: (string | number)[][] = [
    ["BPS"],
    [
      `COMCAST PG RESIDENTIAL INSTALLS - TECH NAME: ${
        first.technician_name || first.tech_number
      }`,
    ],
    [`Week Ending: ${weekEnding}`],
    [
      "CODE",
      "DESCRIPTION",
      "SUN",
      "MON",
      "TUES",
      "WED",
      "THURS",
      "FRI",
      "SAT",
      "TTL",
      "UNIT PRICE",
      "TOTAL",
    ],
  ];

  for (const [code, item] of Array.from(grouped.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    rowsOut.push([
      code,
      item.description,
      ...item.quantities,
      item.totalQty,
      item.unitRate,
      item.totalPay,
    ]);
  }

  const grossPay = rows.reduce(
    (sum, row) => sum + numberValue(row.contractor_pay),
    0
  );
  const truckLease = getTruckLeaseDeduction(rows);
  const meterLease = getMeterLeaseDeduction(rows);
  const missedQc = getMissedQcDeduction(rows);
  const manualAdjustment = getManualAdjustment(rows);
  const manualReason = getManualAdjustmentReason(rows);
  const deductions = truckLease + meterLease + missedQc;

  rowsOut.push([]);
  rowsOut.push(["", "GROSS PAY", "", "", "", "", "", "", "", "", "", grossPay]);

  if (truckLease > 0) {
    rowsOut.push(["", "TRUCK LEASE DEDUCTION", "", "", "", "", "", "", "", "", "", -truckLease]);
  }

  if (meterLease > 0) {
    rowsOut.push(["", "METER LEASE DEDUCTION", "", "", "", "", "", "", "", "", "", -meterLease]);
  }

  if (missedQc > 0) {
    const missedCount = rows.find(row => row.missed_qc_count > 0)?.missed_qc_count || 0;
    rowsOut.push([
      "",
      `MISSED QC DEDUCTION (${missedCount} × $30)`,
      "", "", "", "", "", "", "", "", "",
      -missedQc,
    ]);
  }

  if (manualAdjustment !== 0) {
    rowsOut.push([
      "",
      `${manualAdjustment > 0 ? "ADDITIONAL PAY" : "MISC DEDUCTION"}${manualReason ? ` — ${manualReason}` : ""}`,
      "", "", "", "", "", "", "", "", "",
      manualAdjustment,
    ]);
  }

  rowsOut.push([
    "",
    "AMOUNT DUE",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    grossPay - deductions + manualAdjustment,
  ]);

  const sheet = XLSX.utils.aoa_to_sheet(rowsOut);

  sheet["!cols"] = [
    { wch: 14 },
    { wch: 42 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 12 },
    { wch: 14 },
  ];

  // Pay Sheet: K = UNIT PRICE, L = TOTAL.
  formatCurrencyColumn(sheet, 10, 4);
  formatCurrencyColumn(sheet, 11, 4);
  formatHeaderRow(sheet, 3, 0, 11);
  sheet["!autofilter"] = { ref: `A4:L${Math.max(rowsOut.length, 4)}` };

  return sheet;
}

function createPaidSheet(rows: PayrollPreviewRow[]): XLSX.WorkSheet {
  const paidRows: (string | number)[][] = [
    ["CODE", "COMPLETION DATE", "QTY", "JOB NUMBER", "DESCRIPTION", "PAY"],
    ...rows
      .slice()
      .sort(
        (a, b) =>
          String(a.completion_date || "").localeCompare(
            String(b.completion_date || "")
          ) ||
          a.tech_number.localeCompare(b.tech_number) ||
          a.job_code.localeCompare(b.job_code)
      )
      .map(row => [
        row.job_code,
        row.completion_date || "",
        row.quantity,
        row.job_number || "",
        row.description || "",
        numberValue(row.contractor_pay),
      ]),
  ];

  const sheet = XLSX.utils.aoa_to_sheet(paidRows);

  sheet["!cols"] = [
    { wch: 14 },
    { wch: 16 },
    { wch: 8 },
    { wch: 18 },
    { wch: 42 },
    { wch: 12 },
  ];

  // Paid: F = PAY.
  formatCurrencyColumn(sheet, 5, 1);
  formatHeaderRow(sheet, 0, 0, 5);
  sheet["!autofilter"] = { ref: `A1:F${Math.max(paidRows.length, 1)}` };

  return sheet;
}

function createIndividualWorkbook(rows: PayrollPreviewRow[]): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    createWeeklySheet(rows),
    "Pay Sheet"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    createPaidSheet(rows),
    "Paid"
  );

  return workbook;
}

function createCompanyWorkbook(
  companyName: string,
  rows: PayrollPreviewRow[]
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const byTech = new Map<string, PayrollPreviewRow[]>();

  for (const row of rows) {
    const list = byTech.get(row.tech_number) || [];
    list.push(row);
    byTech.set(row.tech_number, list);
  }

  const summaryRows: (string | number)[][] = [
    [companyName],
    [`Week Ending: ${getWeekEnding(rows)}`],
    [],
    [
      "TECH #",
      "TECHNICIAN",
      "JOBS",
      "GROSS PAY",
      "TRUCK LEASE",
      "METER LEASE",
      "MISSED QCs",
      "ADJUSTMENT",
      "AMOUNT DUE",
    ],
  ];

  for (const [techNumber, techRows] of Array.from(byTech.entries()).sort(
    (a, b) => a[0].localeCompare(b[0])
  )) {
    const grossPay = techRows.reduce(
      (sum, row) => sum + numberValue(row.contractor_pay),
      0
    );
    const truckLease = getTruckLeaseDeduction(techRows);
    const meterLease = getMeterLeaseDeduction(techRows);
    const missedQc = getMissedQcDeduction(techRows);
    const manualAdjustment = getManualAdjustment(techRows);

    summaryRows.push([
      techNumber,
      techRows[0].technician_name || techNumber,
      techRows.length,
      grossPay,
      truckLease > 0 ? -truckLease : 0,
      meterLease > 0 ? -meterLease : 0,
      missedQc > 0 ? -missedQc : 0,
      manualAdjustment,
      grossPay - truckLease - meterLease - missedQc + manualAdjustment,
    ]);
  }

  const companyGross = rows.reduce(
    (sum, row) => sum + numberValue(row.contractor_pay),
    0
  );
  const companyTruckLease = Array.from(byTech.values()).reduce(
    (sum, techRows) => sum + getTruckLeaseDeduction(techRows),
    0
  );
  const companyMeterLease = Array.from(byTech.values()).reduce(
    (sum, techRows) => sum + getMeterLeaseDeduction(techRows),
    0
  );
  const companyMissedQc = Array.from(byTech.values()).reduce(
    (sum, techRows) => sum + getMissedQcDeduction(techRows),
    0
  );
  const companyManualAdjustment = Array.from(byTech.values()).reduce(
    (sum, techRows) => sum + getManualAdjustment(techRows),
    0
  );

  summaryRows.push([]);
  summaryRows.push([
    "",
    "",
    "COMPANY TOTAL",
    companyGross,
    companyTruckLease > 0 ? -companyTruckLease : 0,
    companyMeterLease > 0 ? -companyMeterLease : 0,
    companyMissedQc > 0 ? -companyMissedQc : 0,
    companyManualAdjustment,
    companyGross - companyTruckLease - companyMeterLease - companyMissedQc + companyManualAdjustment,
  ]);

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [
    { wch: 14 },
    { wch: 24 },
    { wch: 12 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
  ];

  // Company Summary: D-I are money columns.
  for (let columnIndex = 3; columnIndex <= 8; columnIndex++) {
    formatCurrencyColumn(summarySheet, columnIndex, 4);
  }
  formatHeaderRow(summarySheet, 3, 0, 8);
  summarySheet["!autofilter"] = {
    ref: `A4:I${Math.max(summaryRows.length, 4)}`,
  };

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  for (const [techNumber, techRows] of Array.from(byTech.entries()).sort(
    (a, b) => a[0].localeCompare(b[0])
  )) {
    const baseName = safeSheetName(techNumber);

    XLSX.utils.book_append_sheet(
      workbook,
      createWeeklySheet(techRows),
      baseName
    );

    XLSX.utils.book_append_sheet(
      workbook,
      createPaidSheet(techRows),
      safeSheetName(`Paid-${techNumber}`)
    );
  }

  return workbook;
}

function createMasterSummaryWorkbook(
  rows: PayrollPreviewRow[]
): XLSX.WorkBook {
  const grouped = new Map<
    string,
    {
      paymentType: string;
      payee: string;
      company: string;
      techCount: Set<string>;
      grossPay: number;
      deductions: number;
      amountDue: number;
    }
  >();

  for (const row of rows) {
    const company = row.company_name || "Unknown Company";
    const individual = isBPS(company);
    const key = individual
      ? `tech:${row.tech_number}`
      : `company:${company}`;

    const current = grouped.get(key) || {
      paymentType: individual ? "Individual" : "Company",
      payee: individual
        ? row.payee_name || row.technician_name || row.tech_number
        : row.payee_name || company,
      company,
      techCount: new Set<string>(),
      grossPay: 0,
      deductions: 0,
      amountDue: 0,
    };

    current.techCount.add(row.tech_number);
    current.grossPay += numberValue(row.contractor_pay);

    grouped.set(key, current);
  }

  for (const [key, item] of grouped) {
    const groupRows = rows.filter(row => {
      const company = row.company_name || "Unknown Company";
      return isBPS(company)
        ? key === `tech:${row.tech_number}`
        : key === `company:${company}`;
    });

    const byTech = new Map<string, PayrollPreviewRow[]>();
    for (const row of groupRows) {
      const list = byTech.get(row.tech_number) || [];
      list.push(row);
      byTech.set(row.tech_number, list);
    }

    item.deductions = Array.from(byTech.values()).reduce(
      (sum, techRows) => sum + getTotalDeductions(techRows),
      0
    );
    item.amountDue = item.grossPay - item.deductions;
  }

  const summaryRows: (string | number)[][] = [
    ["PAYMENT TYPE", "PAYEE", "COMPANY", "TECH COUNT", "AMOUNT DUE"],
    ...Array.from(grouped.values())
      .sort(
        (a, b) =>
          a.company.localeCompare(b.company) || a.payee.localeCompare(b.payee)
      )
      .map(item => [
        item.paymentType,
        item.payee,
        item.company,
        item.techCount.size,
        item.amountDue,
      ]),
  ];

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(summaryRows);

  sheet["!cols"] = [
    { wch: 16 },
    { wch: 26 },
    { wch: 24 },
    { wch: 12 },
    { wch: 16 },
  ];

  // Master Summary: E = AMOUNT DUE.
  formatCurrencyColumn(sheet, 4, 1);
  formatHeaderRow(sheet, 0, 0, 4);
  sheet["!autofilter"] = {
    ref: `A1:E${Math.max(summaryRows.length, 1)}`,
  };

  XLSX.utils.book_append_sheet(workbook, sheet, "Summary");
  return workbook;
}

export async function exportIndividualPayrollFiles(
  rows: PayrollPreviewRow[]
): Promise<void> {
  const matchedRows = rows.filter(
    row => row.match_status === "matched" && row.contractor_pay != null
  );

  if (!matchedRows.length) {
    throw new Error("There are no matched payroll rows to export.");
  }

  const weekEnding = getWeekEnding(matchedRows);

  const jcommByTech = new Map<string, PayrollPreviewRow[]>();
  const otherCompanies = new Map<string, PayrollPreviewRow[]>();

  for (const row of matchedRows) {
    const companyName = row.company_name || "Unknown Company";

    if (isBPS(companyName)) {
      const list = jcommByTech.get(row.tech_number) || [];
      list.push(row);
      jcommByTech.set(row.tech_number, list);
    } else {
      const list = otherCompanies.get(companyName) || [];
      list.push(row);
      otherCompanies.set(companyName, list);
    }
  }

  for (const [techNumber, techRows] of jcommByTech) {
    const workbook = createIndividualWorkbook(techRows);
    const techName =
      techRows[0].technician_name ||
      techRows[0].payee_name ||
      techNumber;

    XLSX.writeFile(
      workbook,
      `${safeFileName(techName)} ${safeFileName(
        techNumber
      )} ${weekEnding}.xlsx`
    );

    await new Promise(resolve => setTimeout(resolve, 150));
  }

  for (const [companyName, companyRows] of otherCompanies) {
    const workbook = createCompanyWorkbook(companyName, companyRows);

    XLSX.writeFile(
      workbook,
      `${safeFileName(companyName)} ${weekEnding}.xlsx`
    );

    await new Promise(resolve => setTimeout(resolve, 150));
  }

  const summaryWorkbook = createMasterSummaryWorkbook(matchedRows);

  XLSX.writeFile(
    summaryWorkbook,
    `Payroll Summary ${weekEnding}.xlsx`
  );
}

export async function exportPayrollWorkbook(
  rows: PayrollPreviewRow[]
): Promise<void> {
  return exportIndividualPayrollFiles(rows);
}
