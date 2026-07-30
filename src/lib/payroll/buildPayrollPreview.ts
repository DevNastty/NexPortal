import { supabase } from "../../supabase";
import type { ParsedInvoiceRow, PayrollPreviewRow } from "../../types/invoice";

type TechnicianRecord = {
  id: string;
  tech_number: string;
  full_name: string | null;
  region: string | null;
  company_id: string | null;
  payee_id: string | null;
  rate_sheet_id: string | null;
  truck_lease_active: boolean | null;
  truck_lease_amount: number | null;
  meter_lease_active: boolean | null;
  meter_lease_amount: number | null;
  payroll_companies?: { company_name: string } | null;
  payroll_payees?: { display_name: string } | null;
  payroll_rate_sheets?: { name: string } | null;
};

type RateRecord = {
  rate_sheet_id: string;
  job_code: string;
  unit_rate: number;
};

function normalizePayrollCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function resolveMeterLease(technician: TechnicianRecord): { active: boolean; amount: number } {
  const active = Boolean(technician.meter_lease_active);
  if (!active) return { active: false, amount: 0 };

  const savedAmount = Number(technician.meter_lease_amount ?? 15);
  return {
    active: true,
    amount: savedAmount > 0 ? savedAmount : 15,
  };
}

export async function buildPayrollPreview(
  invoiceRows: ParsedInvoiceRow[]
): Promise<PayrollPreviewRow[]> {
  const techNumbers = Array.from(new Set(invoiceRows.map(row => row.tech_number)));

  const { data: techData, error: techError } = await supabase
    .from("payroll_technicians")
    .select(`
      id,
      tech_number,
      full_name,
      region,
      company_id,
      payee_id,
      rate_sheet_id,
      truck_lease_active,
      truck_lease_amount,
      meter_lease_active,
      meter_lease_amount,
      payroll_companies(company_name),
      payroll_payees(display_name),
      payroll_rate_sheets(name)
    `)
    .in("tech_number", techNumbers);

  if (techError) throw techError;

  const technicians = (techData || []) as unknown as TechnicianRecord[];
  const techMap = new Map(
    technicians.map(technician => [technician.tech_number.toUpperCase(), technician])
  );

  const sheetIds = Array.from(
    new Set(
      technicians
        .map(technician => technician.rate_sheet_id)
        .filter((value): value is string => Boolean(value))
    )
  );

  let rates: RateRecord[] = [];

  if (sheetIds.length) {
    const { data: rateData, error: rateError } = await supabase
      .from("payroll_rates")
      .select("rate_sheet_id, job_code, unit_rate")
      .in("rate_sheet_id", sheetIds);

    if (rateError) throw rateError;
    rates = (rateData || []) as RateRecord[];
  }

  const rateMap = new Map(
    rates.map(rate => [
      `${rate.rate_sheet_id}|${normalizePayrollCode(rate.job_code)}`,
      Number(rate.unit_rate),
    ])
  );

  return invoiceRows.map(row => {
    const technician = techMap.get(row.tech_number.toUpperCase()) || null;

    if (!technician) {
      return {
        ...row,
        technician_id: null,
        technician_name: null,
        region: null,
        company_name: null,
        payee_id: null,
        payee_name: null,
        rate_sheet_id: null,
        rate_sheet_name: null,
        truck_lease_active: false,
        truck_lease_amount: 0,
        meter_lease_active: false,
        meter_lease_amount: 0,
        missed_qc_count: 0,
        missed_qc_deduction: 0,
        contractor_unit_rate: null,
        contractor_pay: null,
        company_margin: null,
        match_status: "unknown_tech",
      };
    }

    if (!technician.payee_id) {
      return {
        ...row,
        technician_id: technician.id,
        technician_name: technician.full_name,
        region: technician.region,
        company_name: technician.payroll_companies?.company_name || null,
        payee_id: null,
        payee_name: null,
        rate_sheet_id: technician.rate_sheet_id,
        rate_sheet_name: technician.payroll_rate_sheets?.name || null,
        truck_lease_active: Number(technician.truck_lease_amount ?? (technician.truck_lease_active ? 175 : 0)) > 0,
        truck_lease_amount: Number(technician.truck_lease_amount ?? (technician.truck_lease_active ? 175 : 0)),
        meter_lease_active: resolveMeterLease(technician).active,
        meter_lease_amount: resolveMeterLease(technician).amount,
        missed_qc_count: 0,
        missed_qc_deduction: 0,
        contractor_unit_rate: null,
        contractor_pay: null,
        company_margin: null,
        match_status: "missing_payee",
      };
    }

    if (!technician.rate_sheet_id) {
      return {
        ...row,
        technician_id: technician.id,
        technician_name: technician.full_name,
        region: technician.region,
        company_name: technician.payroll_companies?.company_name || null,
        payee_id: technician.payee_id,
        payee_name: technician.payroll_payees?.display_name || null,
        rate_sheet_id: null,
        rate_sheet_name: null,
        truck_lease_active: false,
        truck_lease_amount: 0,
        meter_lease_active: false,
        meter_lease_amount: 0,
        missed_qc_count: 0,
        missed_qc_deduction: 0,
        contractor_unit_rate: null,
        contractor_pay: null,
        company_margin: null,
        match_status: "missing_rate_sheet",
      };
    }

    const contractorUnitRate =
      rateMap.get(`${technician.rate_sheet_id}|${normalizePayrollCode(row.job_code)}`) ?? null;

    if (contractorUnitRate == null) {
      return {
        ...row,
        technician_id: technician.id,
        technician_name: technician.full_name,
        region: technician.region,
        company_name: technician.payroll_companies?.company_name || null,
        payee_id: technician.payee_id,
        payee_name: technician.payroll_payees?.display_name || null,
        rate_sheet_id: technician.rate_sheet_id,
        rate_sheet_name: technician.payroll_rate_sheets?.name || null,
        truck_lease_active: Number(technician.truck_lease_amount ?? (technician.truck_lease_active ? 175 : 0)) > 0,
        truck_lease_amount: Number(technician.truck_lease_amount ?? (technician.truck_lease_active ? 175 : 0)),
        meter_lease_active: resolveMeterLease(technician).active,
        meter_lease_amount: resolveMeterLease(technician).amount,
        missed_qc_count: 0,
        missed_qc_deduction: 0,
        contractor_unit_rate: null,
        contractor_pay: null,
        company_margin: null,
        match_status: "missing_rate",
      };
    }

    const contractorPay = contractorUnitRate * row.quantity;

    return {
      ...row,
      technician_id: technician.id,
      technician_name: technician.full_name,
      region: technician.region,
      company_name: technician.payroll_companies?.company_name || null,
      payee_id: technician.payee_id,
      payee_name: technician.payroll_payees?.display_name || null,
      rate_sheet_id: technician.rate_sheet_id,
      rate_sheet_name: technician.payroll_rate_sheets?.name || null,
      truck_lease_active: Number(technician.truck_lease_amount ?? (technician.truck_lease_active ? 175 : 0)) > 0,
      truck_lease_amount: Number(technician.truck_lease_amount ?? (technician.truck_lease_active ? 175 : 0)),
      meter_lease_active: resolveMeterLease(technician).active,
      meter_lease_amount: resolveMeterLease(technician).amount,
      missed_qc_count: 0,
      missed_qc_deduction: 0,
      contractor_unit_rate: contractorUnitRate,
      contractor_pay: contractorPay,
      company_margin: row.invoice_total - contractorPay,
      match_status: "matched",
    };
  });
}
