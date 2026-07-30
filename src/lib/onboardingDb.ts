import { supabase } from "../supabase";
import type { OnbRow } from "./onboarding";

function sourceKey(row: OnbRow): string {
  return [row.submittedAt || "", row.email || "", row.fullName || ""].join("|").toLowerCase();
}

function toDb(row: OnbRow, source: "portal" | "google_sheet" | "manual_import" = "portal") {
  return {
    source_key: sourceKey(row),
    source,
    location: row.location || null,
    manager: row.manager || null,
    full_name: row.fullName || null,
    address: row.address || null,
    email: row.email || null,
    phone: row.phone || null,
    drug_zip: row.drugZip || null,
    dl_number: row.dlNumber || null,
    dl_expiration: row.dlExpiration || null,
    birth_date: row.birthDate || null,
    tech_num: row.techNum || null,
    region: row.region || null,
    start_date: row.startDate || null,
    bg: row.bg || "pending",
    drug: row.drug || "pending",
    paperwork: Boolean(row.paperwork),
    credentials: Boolean(row.credentials),
    tools: Boolean(row.tools),
    truck: Boolean(row.truck),
    meter: Boolean(row.meter),
    mentor: row.mentor || null,
    notes: row.notes || null,
    submitted_at: row.submittedAt || new Date().toISOString(),
  };
}

function fromDb(row: any): OnbRow {
  return {
    id: row.id, archivedAt: row.archived_at || "",
    location: row.location || "", manager: row.manager || "", fullName: row.full_name || "",
    address: row.address || "", email: row.email || "", phone: row.phone || "",
    drugZip: row.drug_zip || "", dlNumber: row.dl_number || "", dlExpiration: row.dl_expiration || "",
    birthDate: row.birth_date || "", techNum: row.tech_num || "", region: row.region || "",
    startDate: row.start_date || "", bg: row.bg || "pending", drug: row.drug || "pending",
    paperwork: Boolean(row.paperwork), credentials: Boolean(row.credentials), tools: Boolean(row.tools),
    truck: Boolean(row.truck), meter: Boolean(row.meter), mentor: row.mentor || "", notes: row.notes || "",
    submittedAt: row.submitted_at || "",
  };
}

export async function saveOnboardingToDatabase(row: OnbRow): Promise<void> {
  const { error } = await supabase.from("portal_onboarding").insert(toDb(row, "portal"));
  if (error) throw error;
}

export async function syncOnboardingRows(rows: OnbRow[]): Promise<number> {
  if (!rows.length) return 0;
  const payload = rows.map(row => toDb(row, "google_sheet"));
  const { error } = await supabase.from("portal_onboarding").upsert(payload, { onConflict: "source_key", ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}

export async function loadOnboardingFromDatabase(): Promise<OnbRow[]> {
  const { data, error } = await supabase
    .from("portal_onboarding")
    .select("*")
    .is("archived_at", null)
    .order("submitted_at", { ascending: false });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw error;
  }
  return (data || []).map(fromDb);
}


export async function archiveOnboardingApplication(id: string): Promise<void> {
  const { error } = await supabase
    .from("portal_onboarding")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
