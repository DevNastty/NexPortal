import { supabase } from "../../supabase";
import type { PayrollPreviewRow } from "../../types/invoice";
import type { PayrollRegion } from "../../types/payroll";

export type PayrollRunRegion = {
  id: string;
  payroll_run_id: string;
  region: PayrollRegion;
  payroll_type: "cable" | "locates";
  invoice_file_name: string;
  status: "draft" | "complete";
  invoice_total: number;
  gross_pay: number;
  truck_deductions: number;
  meter_deductions: number;
  qc_deductions: number;
  net_pay: number;
  company_margin: number;
  issue_count: number;
  skipped_count: number;
  preview_json: PayrollPreviewRow[];
  skipped_rows_json: number[];
  qc_by_tech_json: Record<string, number>;
  saved_at: string;
};

export type PayrollRun = {
  id: string;
  week_ending: string;
  status: "draft" | "locked";
  locked_at: string | null;
  created_at: string;
  payroll_run_regions?: PayrollRunRegion[];
};

export async function savePayrollRegion(input: {
  weekEnding: string;
  region: PayrollRegion;
  payrollType: "cable" | "locates";
  fileName: string;
  status: "draft" | "complete";
  totals: {
    invoice: number; grossPay: number; truckLease: number; meterLease: number;
    missedQc: number; manualAdjustment: number; pay: number; margin: number; issues: number;
  };
  preview: PayrollPreviewRow[];
  skippedRows: number[];
  qcByTech: Record<string, number>;
}): Promise<void> {
  const { data: run, error: runError } = await supabase
    .from("payroll_runs")
    .upsert({ week_ending: input.weekEnding }, { onConflict: "week_ending" })
    .select("id,status")
    .single();
  if (runError) throw runError;
  if (run.status === "locked") throw new Error("This payroll week is locked.");

  const { error } = await supabase.from("payroll_run_regions").upsert({
    payroll_run_id: run.id,
    region: input.region,
    payroll_type: input.payrollType,
    invoice_file_name: input.fileName,
    status: input.status,
    invoice_total: input.totals.invoice,
    gross_pay: input.totals.grossPay,
    truck_deductions: input.totals.truckLease,
    meter_deductions: input.totals.meterLease,
    qc_deductions: input.totals.missedQc,
    net_pay: input.totals.pay,
    company_margin: input.totals.margin,
    issue_count: input.totals.issues,
    skipped_count: input.skippedRows.length,
    preview_json: input.preview,
    skipped_rows_json: input.skippedRows,
    qc_by_tech_json: input.qcByTech,
    saved_at: new Date().toISOString(),
  }, { onConflict: "payroll_run_id,region,payroll_type" });
  if (error) throw error;
}

export async function deletePayrollDraft(input: {
  runId: string;
  regionId: string;
}): Promise<void> {
  const { data: run, error: runError } = await supabase
    .from("payroll_runs")
    .select("id,status")
    .eq("id", input.runId)
    .single();
  if (runError) throw runError;
  if (run.status === "locked") throw new Error("Locked payroll weeks cannot be changed.");

  const { data: region, error: regionError } = await supabase
    .from("payroll_run_regions")
    .select("id,status,region")
    .eq("id", input.regionId)
    .eq("payroll_run_id", input.runId)
    .single();
  if (regionError) throw regionError;
  if (region.status !== "draft") throw new Error("Only payroll drafts can be deleted.");

  const { error: deleteError } = await supabase
    .from("payroll_run_regions")
    .delete()
    .eq("id", input.regionId)
    .eq("payroll_run_id", input.runId)
    .eq("status", "draft");
  if (deleteError) throw deleteError;

  const { count, error: countError } = await supabase
    .from("payroll_run_regions")
    .select("id", { count: "exact", head: true })
    .eq("payroll_run_id", input.runId);
  if (countError) throw countError;

  if ((count ?? 0) === 0) {
    const { error: deleteRunError } = await supabase
      .from("payroll_runs")
      .delete()
      .eq("id", input.runId)
      .neq("status", "locked");
    if (deleteRunError) throw deleteRunError;
  }
}

export async function listPayrollRuns(): Promise<PayrollRun[]> {
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("id,week_ending,status,locked_at,created_at,payroll_run_regions(*)")
    .order("week_ending", { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as PayrollRun[];
}

export async function lockPayrollRun(runId: string): Promise<void> {
  const { error } = await supabase.from("payroll_runs").update({
    status: "locked", locked_at: new Date().toISOString(), locked_by: (await supabase.auth.getUser()).data.user?.id || null,
  }).eq("id", runId);
  if (error) throw error;
}
