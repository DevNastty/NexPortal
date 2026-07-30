export type PayrollRegion = string;

export type PayrollRegionRecord = {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
};

export type PayrollWorkerType = "cable" | "locator";

export type PayrollSection =
  | "dashboard"
  | "companies"
  | "technicians"
  | "regions"
  | "rateSheets"
  | "invoiceUpload"
  | "history";

export type PortalUser = {
  username: string;
  role: "tech" | "bp_owner" | "supervisor" | "director";
  displayName?: string;
};

export type PayrollCompany = {
  id: string;
  company_name: string;
  legal_name: string | null;
  active: boolean;
  payee_id: string | null;
};

export type PayrollPayee = {
  id: string;
  display_name: string;
  payee_type: "individual" | "company";
  active: boolean;
};

export type PayrollRateSheet = {
  id: string;
  name: string;
  region: string | null;
  effective_from: string;
  active: boolean;
  payroll_type?: "cable" | "locates";
};

export type PayrollTechnician = {
  id: string;
  tech_number: string;
  full_name: string | null;
  worker_type: PayrollWorkerType;
  state: string | null;
  region: string | null;
  company_id: string | null;
  payee_id: string;
  rate_sheet_id: string | null;
  truck_lease_active: boolean;
  truck_lease_amount: 0 | 125 | 175;
  meter_lease_active: boolean;
  meter_lease_amount: number;
  active: boolean;
  payroll_companies?: { company_name: string } | null;
  payroll_payees?: { display_name: string } | null;
  payroll_rate_sheets?: { name: string } | null;
};

export type ParsedRateRow = {
  job_code: string;
  description: string | null;
  unit_rate: number;
};
