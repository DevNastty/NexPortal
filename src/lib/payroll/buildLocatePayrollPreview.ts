import { supabase } from "../../supabase";
import type { ParsedInvoiceRow, PayrollPreviewRow } from "../../types/invoice";

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const normName = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export async function buildLocatePayrollPreview(rows: ParsedInvoiceRow[]): Promise<PayrollPreviewRow[]> {
  const { data: techData, error: techError } = await supabase.from("payroll_technicians").select(`
    id, tech_number, full_name, worker_type, region, company_id, payee_id, rate_sheet_id,
    truck_lease_active, truck_lease_amount, meter_lease_active, meter_lease_amount,
    payroll_companies(company_name), payroll_payees(display_name), payroll_rate_sheets(name)
  `).eq("active", true);
  if (techError) throw techError;
  const technicians = (techData || []) as any[];
  const byName = new Map<string, any>();
  for (const tech of technicians) {
    if (tech.worker_type && tech.worker_type !== "locator") continue;
    byName.set(normName(tech.full_name), tech);
    byName.set(normName(tech.tech_number), tech);
  }
  const sheetIds = [...new Set(technicians.map(t => t.rate_sheet_id).filter(Boolean))] as string[];
  let rateData: any[] = [];
  if (sheetIds.length) {
    const result = await supabase.from("payroll_rates").select("rate_sheet_id,job_code,unit_rate").in("rate_sheet_id", sheetIds);
    if (result.error) throw result.error;
    rateData = result.data || [];
  }
  const rateMap = new Map(rateData.map(r => [`${r.rate_sheet_id}|${norm(r.job_code)}`, Number(r.unit_rate)]));
  return rows.map(row => {
    const tech = byName.get(normName(row.tech_number)) || null;
    const base: any = {
      ...row, technician_id: tech?.id || null, technician_name: tech?.full_name || null,
      region: tech?.region || null, company_name: tech?.payroll_companies?.company_name || null,
      payee_id: tech?.payee_id || null, payee_name: tech?.payroll_payees?.display_name || null,
      rate_sheet_id: tech?.rate_sheet_id || null, rate_sheet_name: tech?.payroll_rate_sheets?.name || null,
      truck_lease_active: false, truck_lease_amount: 0,
      meter_lease_active: Boolean(tech?.meter_lease_active), meter_lease_amount: Boolean(tech?.meter_lease_active) ? Number(tech?.meter_lease_amount || 15) : 0,
      missed_qc_count: 0, missed_qc_deduction: 0,
      contractor_unit_rate: null, contractor_pay: null, company_margin: null,
    };
    if (!tech) return { ...base, match_status: "unknown_tech" };
    if (!tech.payee_id) return { ...base, match_status: "missing_payee" };
    if (!tech.rate_sheet_id) return { ...base, match_status: "missing_rate_sheet" };
    const rate = rateMap.get(`${tech.rate_sheet_id}|${norm(row.job_code)}`);
    if (rate == null) return { ...base, match_status: "missing_rate" };
    const pay = rate * row.quantity;
    return { ...base, contractor_unit_rate: rate, contractor_pay: pay, company_margin: -pay, match_status: "matched" };
  });
}
