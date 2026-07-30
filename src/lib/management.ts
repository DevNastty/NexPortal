import { supabase } from "../supabase";

export type PortalLocation = {
  id: string;
  name: string;
  work_type: "cable" | "locates";
  state: string | null;
  region: string | null;
  drug_test_zip: string | null;
  active: boolean;
};

export type PortalManager = {
  id: string;
  name: string;
  company_name: string;
  region: string | null;
  email: string | null;
  active: boolean;
};

export type PortalSettings = {
  qc_deduction: number;
  meter_lease_amount: number;
  default_region: string;
  support_email: string;
};

export const DEFAULT_LOCATIONS = [
  "PC 434 Maryland / Virginia",
  "PC 403 Breezeline",
  "PC 410 Pennsylvania",
  "PC 427 New Jersey",
  "PC 703 Virgina Locates",
  "PC 715 Fiber Light",
];

export const DEFAULT_MANAGERS = [
  "Joshua Blair (BPS)",
  "Austin Lovejoy (BPS)",
  "Stanley Martin (Knockout Entertainment LLC)",
  "Dontae Peterson (Ultra Scream Networks LLC)",
  "Oleksandr Iots (Ukeetech Cable LLC)",
  "John Clayton (B.I.T.E LLC)",
  "Stephen Hogan (G.R.O.S.S LLC)",
];

export async function loadPortalLocations(): Promise<PortalLocation[]> {
  const { data, error } = await supabase
    .from("portal_locations")
    .select("id,name,work_type,state,region,drug_test_zip,active")
    .order("name");
  if (error) throw error;
  return (data || []) as PortalLocation[];
}

export async function loadPortalManagers(): Promise<PortalManager[]> {
  const { data, error } = await supabase
    .from("portal_managers")
    .select("id,name,company_name,region,email,active")
    .order("name");
  if (error) throw error;
  return (data || []) as PortalManager[];
}

export async function loadPortalSettings(): Promise<PortalSettings> {
  const defaults: PortalSettings = {
    qc_deduction: 30,
    meter_lease_amount: 15,
    default_region: "Keystone",
    support_email: "",
  };
  const { data, error } = await supabase.from("portal_settings").select("key,value");
  if (error) throw error;
  for (const row of data || []) {
    if (row.key in defaults) (defaults as any)[row.key] = row.value;
  }
  return defaults;
}
