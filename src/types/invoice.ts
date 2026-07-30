export type ParsedInvoiceRow = {
  source_row_number: number;
  tech_number: string;
  completion_date: string | null;
  job_number: string | null;
  job_code: string;
  description: string | null;
  quantity: number;
  invoice_unit_amount: number | null;
  invoice_total: number;
  raw_row: Record<string, unknown>;
};

export type PayrollPreviewRow = ParsedInvoiceRow & {
  technician_id: string | null;
  technician_name: string | null;
  region: string | null;
  company_name: string | null;
  payee_id: string | null;
  payee_name: string | null;
  rate_sheet_id: string | null;
  rate_sheet_name: string | null;
  truck_lease_active: boolean;
  truck_lease_amount: number;
  meter_lease_active: boolean;
  meter_lease_amount: number;
  missed_qc_count: number;
  missed_qc_deduction: number;
  manual_adjustment_amount?: number;
  manual_adjustment_reason?: string;
  contractor_unit_rate: number | null;
  contractor_pay: number | null;
  company_margin: number | null;
  match_status:
    | "matched"
    | "unknown_tech"
    | "missing_payee"
    | "missing_rate_sheet"
    | "missing_rate";
};
