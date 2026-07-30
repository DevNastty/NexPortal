import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import Companies from "./payroll/Companies";
import type { PayrollCompany } from "../types/payroll";
import type { ViewKey, UserRole } from "../types/navigation";
import {
  loadPortalLocations,
  loadPortalManagers,
  loadPortalSettings,
  type PortalLocation,
  type PortalManager,
  type PortalSettings,
} from "../lib/management";
import {
  deletePortalUser,
  invitePortalUser,
  listPortalProfiles,
  sendPasswordResetCode,
  setPortalUserActive,
  setTimeOffApprover,
  updatePortalUser,
  type PortalProfile,
} from "../lib/portalAuth";

type AdministrationSection =
  | "adminCompanies"
  | "adminLocations"
  | "adminManagers"
  | "adminUsers"
  | "adminSettings";

type AdministrationProps = {
  section: AdministrationSection;
};

const META: Record<AdministrationSection, { title: string; description: string; icon: string }> = {
  adminCompanies: { title: "Companies", description: "Manage company records shared by payroll, onboarding and reporting.", icon: "🏢" },
  adminLocations: { title: "Locations", description: "Manage onboarding locations, regions and drug-test ZIP defaults.", icon: "📍" },
  adminManagers: { title: "Managers", description: "Manage the manager directory used by technician onboarding.", icon: "👔" },
  adminUsers: { title: "Users", description: "Review portal accounts and role access loaded from the login directory.", icon: "👥" },
  adminSettings: { title: "Settings", description: "Manage shared payroll and portal defaults.", icon: "⚙" },
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function Administration({ section }: AdministrationProps) {
  const meta = META[section];
  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6">
      <section className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/75 shadow-2xl shadow-black/20">
        <div className="border-b border-white/10 bg-gradient-to-r from-slate-900 via-slate-900 to-blue-950/40 px-6 py-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-600/15 text-2xl ring-1 ring-blue-400/20">{meta.icon}</div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-300">Director Management</div>
              <h1 className="mt-1 text-2xl font-bold text-white">{meta.title}</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">{meta.description}</p>
            </div>
          </div>
        </div>
        <div className="p-6">
          {section === "adminCompanies" && <CompaniesManagement />}
          {section === "adminLocations" && <LocationsManagement />}
          {section === "adminManagers" && <ManagersManagement />}
          {section === "adminUsers" && <UsersManagement />}
          {section === "adminSettings" && <SettingsManagement />}
        </div>
      </section>
    </main>
  );
}

function Notice({ message, error }: { message: string; error: string }) {
  if (!message && !error) return null;
  return <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${error ? "border-red-400/20 bg-red-500/10 text-red-200" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"}`}>{error || message}</div>;
}

function CompaniesManagement() {
  const [companies, setCompanies] = useState<PayrollCompany[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function load() {
    const result = await supabase.from("payroll_companies").select("id,company_name,legal_name,active,payee_id").order("company_name");
    if (result.error) { setError(result.error.message); return; }
    setCompanies((result.data || []) as PayrollCompany[]);
  }
  useEffect(() => { void load(); }, []);
  return <><Notice message={notice} error={error} /><Companies companies={companies} onChanged={load} onNotice={m => { setNotice(m); setError(""); }} onError={m => { setError(m); setNotice(""); }} /></>;
}

function LocationsManagement() {
  const [rows, setRows] = useState<PortalLocation[]>([]);
  const [name, setName] = useState("");
  const [workType, setWorkType] = useState<"cable" | "locates">("cable");
  const [stateCode, setStateCode] = useState("");
  const [region, setRegion] = useState("Keystone");
  const [zip, setZip] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const states = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];
  async function load() { try { setRows(await loadPortalLocations()); } catch (e) { setError(errorText(e)); } }
  useEffect(() => { void load(); }, []);
  async function add(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    if (!stateCode) { setError("Select a state."); setBusy(false); return; }
    const result = await supabase.from("portal_locations").insert({
      name: name.trim(),
      work_type: workType,
      state: stateCode,
      region: workType === "cable" ? region : null,
      drug_test_zip: zip.trim() || null,
      active: true,
    });
    if (result.error) setError(result.error.message); else {
      setName(""); setZip(""); setNotice(`${workType === "cable" ? "Cable" : "Locate"} location added.`); await load();
    }
    setBusy(false);
  }
  async function remove(row: PortalLocation) {
    if (!window.confirm(`Permanently delete ${row.name}?`)) return;
    const result = await supabase.from("portal_locations").delete().eq("id", row.id);
    if (result.error) setError(result.error.message); else { setNotice("Location deleted."); await load(); }
  }
  async function toggle(row: PortalLocation) {
    const result = await supabase.from("portal_locations").update({ active: !row.active }).eq("id", row.id);
    if (result.error) setError(result.error.message); else await load();
  }
  return <><Notice message={notice} error={error} /><div className="grid gap-5 lg:grid-cols-[340px_1fr]">
    <form onSubmit={add} className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/55 p-5">
      <h2 className="text-lg font-semibold">Add onboarding location</h2>
      <select value={workType} onChange={e => setWorkType(e.target.value as "cable" | "locates")} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm">
        <option value="cable">Cable work</option><option value="locates">Locates</option>
      </select>
      <input required value={name} onChange={e => setName(e.target.value)} placeholder={workType === "cable" ? "Location / market name" : "Locate area name"} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
      <select required value={stateCode} onChange={e => setStateCode(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"><option value="">Select state</option>{states.map(state => <option key={state} value={state}>{state}</option>)}</select>
      {workType === "cable" && <select value={region} onChange={e => setRegion(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"><option>Keystone</option><option>Beltway</option><option>Freedom</option></select>}
      <input value={zip} onChange={e => setZip(e.target.value)} placeholder="Default drug-test ZIP (optional)" className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
      <p className="text-xs text-slate-400">Cable locations use State + Region. Locate locations use State only.</p>
      <button disabled={busy} className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy ? "Saving…" : "Save location"}</button>
    </form>
    <DataTable headers={["Location","Type","State","Region","Drug ZIP","Status","Actions"]}>
      {rows.map(row => <tr key={row.id} className="border-t border-white/5"><td className="px-4 py-3 font-medium text-white">{row.name}</td><td className="px-4 py-3 capitalize">{row.work_type === "locates" ? "Locates" : "Cable"}</td><td className="px-4 py-3">{row.state || "—"}</td><td className="px-4 py-3">{row.work_type === "locates" ? "Not required" : row.region || "—"}</td><td className="px-4 py-3">{row.drug_test_zip || "—"}</td><td className="px-4 py-3">{row.active ? "Active" : "Inactive"}</td><td className="px-4 py-3 text-right"><button onClick={() => toggle(row)} className="mr-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs">{row.active ? "Deactivate" : "Activate"}</button><button onClick={() => remove(row)} className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-300">Delete</button></td></tr>)}
    </DataTable>
  </div></>;
}

function ManagersManagement() {
  const [rows, setRows] = useState<PortalManager[]>([]);
  const [name, setName] = useState(""); const [company, setCompany] = useState(""); const [region, setRegion] = useState("Keystone"); const [email, setEmail] = useState("");
  const [notice, setNotice] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function load() { try { setRows(await loadPortalManagers()); } catch (e) { setError(errorText(e)); } }
  useEffect(() => { void load(); }, []);
  async function add(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const result = await supabase.from("portal_managers").insert({ name: name.trim(), company_name: company.trim(), region, email: email.trim() || null, active: true }); if (result.error) setError(result.error.message); else { setName(""); setCompany(""); setEmail(""); setNotice("Manager added."); await load(); } setBusy(false); }
  async function remove(row: PortalManager) { if (!window.confirm(`Permanently delete ${row.name}?`)) return; const result = await supabase.from("portal_managers").delete().eq("id", row.id); if (result.error) setError(result.error.message); else { setNotice("Manager deleted."); await load(); } }
  async function toggle(row: PortalManager) { const result = await supabase.from("portal_managers").update({ active: !row.active }).eq("id", row.id); if (result.error) setError(result.error.message); else await load(); }
  return <><Notice message={notice} error={error} /><div className="grid gap-5 lg:grid-cols-[340px_1fr]">
    <form onSubmit={add} className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/55 p-5"><h2 className="text-lg font-semibold">Add manager</h2><input required value={name} onChange={e => setName(e.target.value)} placeholder="Manager name" className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"/><input required value={company} onChange={e => setCompany(e.target.value)} placeholder="Company" className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"/><select value={region} onChange={e => setRegion(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"><option>Keystone</option><option>Beltway</option><option>Freedom</option></select><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email (optional)" className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"/><button disabled={busy} className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy ? "Saving…" : "Save manager"}</button></form>
    <DataTable headers={["Manager","Company","Region","Email","Status","Actions"]}>{rows.map(row => <tr key={row.id} className="border-t border-white/5"><td className="px-4 py-3 font-medium text-white">{row.name}</td><td className="px-4 py-3">{row.company_name}</td><td className="px-4 py-3">{row.region || "—"}</td><td className="px-4 py-3">{row.email || "—"}</td><td className="px-4 py-3">{row.active ? "Active" : "Inactive"}</td><td className="px-4 py-3 text-right"><button onClick={() => toggle(row)} className="mr-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs">{row.active ? "Deactivate" : "Activate"}</button><button onClick={() => remove(row)} className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-300">Delete</button></td></tr>)}</DataTable>
  </div></>;
}

type CompanyOption = { id: string; company_name: string };
type TechnicianOption = {
  id: string;
  tech_number: string;
  full_name: string | null;
};

function UsersManagement() {
  const [profiles, setProfiles] = useState<PortalProfile[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("tech");
  const [techNumber, setTechNumber] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [editing, setEditing] = useState<PortalProfile | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("tech");
  const [editTechNumber, setEditTechNumber] = useState("");
  const [editCompanyId, setEditCompanyId] = useState("");
  const [editActive, setEditActive] = useState(true);

  async function load() {
    setError("");
    try {
      const [profileRows, techResult, companyResult] = await Promise.all([
        listPortalProfiles(),
        supabase
          .from("payroll_technicians")
          .select("id,tech_number,full_name")
          .eq("active", true)
          .order("tech_number"),
        supabase.from("payroll_companies").select("id,company_name").eq("active", true).order("company_name"),
      ]);
      if (techResult.error) throw techResult.error;
      if (companyResult.error) throw companyResult.error;
      setProfiles(profileRows);
      setTechnicians((techResult.data || []) as TechnicianOption[]);
      setCompanies((companyResult.data || []) as CompanyOption[]);
    } catch (loadError) {
      setError(errorText(loadError));
    }
  }

  useEffect(() => { void load(); }, []);

  async function submitInvite(event: FormEvent) {
    event.preventDefault();
    if (inviteRole === "tech" && !techNumber) {
      setError("Select a technician number for a Tech account.");
      return;
    }
    if (inviteRole === "bp_owner" && !companyId) { setError("Select the BP Owner company."); return; }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await invitePortalUser({ email, displayName, role: inviteRole, techNumber, companyId: inviteRole === "bp_owner" ? companyId : null });
      setNotice(`Invitation sent to ${email}. They will create their own password.`);
      setEmail("");
      setDisplayName("");
      setInviteRole("tech");
      setTechNumber("");
      setCompanyId("");
      await load();
    } catch (inviteError) {
      setError(errorText(inviteError));
    } finally { setBusy(false); }
  }

  function beginEdit(profile: PortalProfile) {
    setEditing(profile);
    setEditDisplayName(profile.display_name || "");
    setEditRole(profile.role);
    setEditTechNumber(profile.tech_number || "");
    setEditCompanyId(profile.company_id || "");
    setEditActive(profile.active);
    setError("");
    setNotice("");
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    if (editRole === "tech" && !editTechNumber) { setError("Select a technician number for a Tech account."); return; }
    if (editRole === "bp_owner" && !editCompanyId) { setError("Select the BP Owner company."); return; }
    if (editing.role === "director" && editRole !== "director" && !window.confirm("Remove Director access from this user?")) return;
    if (editing.role !== "director" && editRole === "director" && !window.confirm("Grant full Director access to this user?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await updatePortalUser({
        userId: editing.user_id,
        displayName: editDisplayName,
        role: editRole,
        techNumber: editTechNumber,
        companyId: editCompanyId,
        active: editActive,
      });
      setNotice(`${editDisplayName || editing.email} updated.`);
      setEditing(null);
      await load();
    } catch (saveError) { setError(errorText(saveError)); }
    finally { setBusy(false); }
  }

  async function toggleActive(profile: PortalProfile) {
    setBusy(true); setError(""); setNotice("");
    try {
      await setPortalUserActive(profile.user_id, !profile.active);
      setNotice(`${profile.display_name || profile.email} ${profile.active ? "disabled" : "enabled"}.`);
      await load();
    } catch (toggleError) { setError(errorText(toggleError)); }
    finally { setBusy(false); }
  }

  async function sendReset(profile: PortalProfile) {
    setBusy(true); setError(""); setNotice("");
    try {
      await sendPasswordResetCode(profile.email);
      setNotice(`Password reset verification code sent to ${profile.email}.`);
    } catch (resetError) { setError(errorText(resetError)); }
    finally { setBusy(false); }
  }

  async function remove(profile: PortalProfile) {
    if (!window.confirm(`Permanently delete ${profile.display_name || profile.email}?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await deletePortalUser(profile.user_id);
      setNotice("User permanently deleted.");
      await load();
    } catch (deleteError) { setError(errorText(deleteError)); }
    finally { setBusy(false); }
  }

  const assignedTechs = new Set(profiles.map(profile => profile.tech_number).filter(Boolean));
  const availableTechs = technicians.filter(tech => !assignedTechs.has(tech.tech_number) || tech.tech_number === techNumber);
  const editAvailableTechs = technicians.filter(tech => !assignedTechs.has(tech.tech_number) || tech.tech_number === editing?.tech_number || tech.tech_number === editTechNumber);
  const filtered = useMemo(() => profiles.filter(profile => {
    const roleOk = roleFilter === "all" || profile.role === roleFilter;
    const query = search.trim().toLowerCase();
    const searchOk = !query || `${profile.display_name || ""} ${profile.email} ${profile.tech_number || ""}`.toLowerCase().includes(query);
    return roleOk && searchOk;
  }), [profiles, roleFilter, search]);

  const counts = {
    tech: profiles.filter(profile => profile.role === "tech").length,
    bp_owner: profiles.filter(profile => profile.role === "bp_owner").length,
    dispatcher: profiles.filter(profile => profile.role === "dispatcher").length,
    supervisor: profiles.filter(profile => profile.role === "supervisor").length,
    director: profiles.filter(profile => profile.role === "director").length,
  };

  return <div className="space-y-5">
    <Notice message={notice} error={error} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Stat label="Technicians" value={counts.tech}/><Stat label="BP Owners" value={counts.bp_owner}/><Stat label="Dispatchers" value={counts.dispatcher}/><Stat label="Supervisors" value={counts.supervisor}/><Stat label="Directors" value={counts.director}/></div>

    <form onSubmit={submitInvite} className="rounded-2xl border border-white/10 bg-slate-950/55 p-5">
      <div className="mb-5">
        <div className="font-semibold text-white">Invite User</div>
        <div className="text-xs text-slate-400">The user receives a secure Supabase invitation and creates their own password.</div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1.2fr_180px_220px_220px_auto]">
        <input required value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Display name" className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
        <input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="Email" className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
        <select value={inviteRole} onChange={event => { const role = event.target.value as UserRole; setInviteRole(role); if (role !== "tech") setTechNumber(""); if (role !== "bp_owner") setCompanyId(""); }} className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"><option value="tech">Tech</option><option value="bp_owner">BP Owner</option><option value="dispatcher">Dispatcher</option><option value="supervisor">Supervisor</option><option value="director">Director</option></select>
        <select value={companyId} onChange={event => setCompanyId(event.target.value)} disabled={inviteRole !== "bp_owner"} className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"><option value="">{inviteRole === "bp_owner" ? "Select company" : "Company not required"}</option>{companies.map(company => <option key={company.id} value={company.id}>{company.company_name}</option>)}</select>
        <select value={techNumber} onChange={event => setTechNumber(event.target.value)} disabled={inviteRole !== "tech"} className="min-w-0 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"><option value="">{inviteRole === "tech" ? "Select tech number" : "Tech number not required"}</option>{availableTechs.map(tech => <option key={tech.id} value={tech.tech_number}>{tech.tech_number} — {tech.full_name || "Unnamed"}</option>)}</select>
        <button disabled={busy} className="whitespace-nowrap rounded-xl bg-blue-600 px-6 py-2 text-sm font-semibold disabled:opacity-50">{busy ? "Working…" : "Send Invitation"}</button>
      </div>
    </form>

    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/55 p-4 lg:flex-row">
      <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, email or tech number" className="flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
      <select value={roleFilter} onChange={event => setRoleFilter(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"><option value="all">All roles</option><option value="tech">Tech</option><option value="bp_owner">BP Owner</option><option value="dispatcher">Dispatcher</option><option value="supervisor">Supervisor</option><option value="director">Director</option></select>
    </div>

    <DataTable headers={["User","Email","Role","Company / Tech #","Status","Actions"]}>{filtered.map(profile => <tr key={profile.user_id} className="border-t border-white/5">
      <td className="px-4 py-3 font-medium text-white">{profile.display_name || "—"}</td>
      <td className="px-4 py-3">{profile.email}</td>
      <td className="px-4 py-3 capitalize">{profile.role === "bp_owner" ? "BP Owner" : profile.role}</td>
      <td className="px-4 py-3">{profile.role === "bp_owner" ? companies.find(company => company.id === profile.company_id)?.company_name || "Company not assigned" : profile.tech_number || "—"}</td>
      <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${profile.active ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-500/10 text-slate-400"}`}>{profile.active ? "Active" : "Disabled"}</span></td>
      <td className="px-4 py-3 text-right whitespace-nowrap"><button disabled={busy} onClick={() => beginEdit(profile)} className="mr-2 rounded-lg bg-blue-500/10 px-3 py-1.5 text-xs text-blue-300">Edit</button><button disabled={busy} onClick={() => sendReset(profile)} className="mr-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs">Reset</button><button disabled={busy} onClick={() => toggleActive(profile)} className="mr-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs">{profile.active ? "Disable" : "Enable"}</button><button disabled={busy} onClick={() => remove(profile)} className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-300">Delete</button></td>
    </tr>)}</DataTable>

    {editing && (
      <div className="fixed inset-0 z-[80] grid place-items-center p-4">
        <button type="button" aria-label="Close editor" className="absolute inset-0 bg-black/70" onClick={() => !busy && setEditing(null)} />
        <form onSubmit={saveEdit} className="relative w-full max-w-xl space-y-4 rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div><div className="text-lg font-semibold text-white">Edit portal user</div><div className="mt-1 text-xs text-slate-400">{editing.email}</div></div>
            <button type="button" disabled={busy} onClick={() => setEditing(null)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300">Close</button>
          </div>
          <label className="block text-xs text-slate-300">Display name<input required value={editDisplayName} onChange={event => setEditDisplayName(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm" /></label>
          <label className="block text-xs text-slate-300">Role<select value={editRole} onChange={event => { const role = event.target.value as UserRole; setEditRole(role); if (role !== "tech") setEditTechNumber(""); if (role !== "bp_owner") setEditCompanyId(""); }} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm"><option value="tech">Tech</option><option value="bp_owner">BP Owner</option><option value="dispatcher">Dispatcher</option><option value="supervisor">Supervisor</option><option value="director">Director</option></select></label>
          {editRole === "tech" && <label className="block text-xs text-slate-300">Technician<select required value={editTechNumber} onChange={event => setEditTechNumber(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm"><option value="">Select technician</option>{editAvailableTechs.map(tech => <option key={tech.id} value={tech.tech_number}>{tech.tech_number} — {tech.full_name || "Unnamed"}</option>)}</select></label>}
          {editRole === "bp_owner" && <label className="block text-xs text-slate-300">Company<select required value={editCompanyId} onChange={event => setEditCompanyId(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm"><option value="">Select company</option>{companies.map(company => <option key={company.id} value={company.id}>{company.company_name}</option>)}</select></label>}
          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-200"><input type="checkbox" checked={editActive} onChange={event => setEditActive(event.target.checked)} /> Account active</label>
          <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => setEditing(null)} className="rounded-xl border border-white/10 px-4 py-2 text-sm">Cancel</button><button disabled={busy} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold disabled:opacity-50">{busy ? "Saving…" : "Save changes"}</button></div>
        </form>
      </div>
    )}
  </div>;
}

function SettingsManagement() {
  const [settings, setSettings] = useState<PortalSettings>({ qc_deduction: 30, meter_lease_amount: 15, default_region: "Keystone", support_email: "" });
  const [approvers, setApprovers] = useState<PortalProfile[]>([]);
  const [notice, setNotice] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [loadedSettings, profiles] = await Promise.all([loadPortalSettings(), listPortalProfiles()]);
      setSettings(loadedSettings);
      setApprovers(profiles.filter(profile => profile.active && (profile.role === "supervisor" || profile.role === "director")));
    } catch (e) { setError(errorText(e)); }
  }

  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const rows = Object.entries(settings).map(([key, value]) => ({ key, value }));
    const result = await supabase.from("portal_settings").upsert(rows, { onConflict: "key" });
    if (result.error) setError(result.error.message); else setNotice("Settings saved.");
    setBusy(false);
  }

  async function toggleApprover(profile: PortalProfile) {
    if (profile.role === "director") return;
    setBusy(true); setError(""); setNotice("");
    try {
      await setTimeOffApprover(profile.user_id, !profile.can_approve_time_off);
      setNotice(`${profile.display_name || profile.email} ${profile.can_approve_time_off ? "removed from" : "added to"} time off approvals.`);
      await load();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  return <><Notice message={notice} error={error}/><form onSubmit={save} className="grid max-w-4xl gap-5 md:grid-cols-2"><SettingField label="Missed QC deduction"><input type="number" min="0" value={settings.qc_deduction} onChange={e => setSettings(s => ({ ...s, qc_deduction: Number(e.target.value) }))} className="field"/></SettingField><SettingField label="Meter lease amount"><input type="number" min="0" value={settings.meter_lease_amount} onChange={e => setSettings(s => ({ ...s, meter_lease_amount: Number(e.target.value) }))} className="field"/></SettingField><SettingField label="Default region"><select value={settings.default_region} onChange={e => setSettings(s => ({ ...s, default_region: e.target.value }))} className="field"><option>Keystone</option><option>Beltway</option><option>Freedom</option></select></SettingField><SettingField label="Support email"><input type="email" value={settings.support_email} onChange={e => setSettings(s => ({ ...s, support_email: e.target.value }))} className="field"/></SettingField><div className="md:col-span-2"><button disabled={busy} className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold disabled:opacity-50">{busy ? "Saving…" : "Save settings"}</button></div><style>{`.field{width:100%;border-radius:.75rem;border:1px solid rgba(255,255,255,.1);background:#020617;padding:.65rem .8rem;font-size:.875rem}`}</style></form>

    <section className="mt-8 max-w-4xl rounded-2xl border border-white/10 bg-slate-950/55 p-5">
      <h2 className="text-lg font-semibold text-white">Time Off Approvers</h2>
      <p className="mt-1 text-sm text-slate-400">Directors can always approve. Select which Supervisors can approve or deny technician requests and receive request emails.</p>
      <div className="mt-4 space-y-2">{approvers.map(profile => {
        const enabled = profile.role === "director" || profile.can_approve_time_off;
        return <label key={profile.user_id} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3">
          <div><div className="font-medium text-white">{profile.display_name || profile.email}</div><div className="text-xs capitalize text-slate-500">{profile.role}</div></div>
          <input type="checkbox" checked={enabled} disabled={busy || profile.role === "director"} onChange={() => void toggleApprover(profile)} className="h-5 w-5" />
        </label>;
      })}{!approvers.length && <div className="text-sm text-slate-500">No active Directors or Supervisors found.</div>}</div>
    </section>
  </>;
}

function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) { return <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/55"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-white/5 text-slate-400"><tr>{headers.map(header => <th key={header} className={`px-4 py-3 font-medium ${header === "Actions" ? "text-right" : "text-left"}`}>{header}</th>)}</tr></thead><tbody className="text-slate-300">{children}</tbody></table></div></div>; }
function Stat({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-5"><div className="text-xs uppercase tracking-wider text-slate-500">{label}</div><div className="mt-2 text-2xl font-bold text-white">{value}</div></div>; }
function SettingField({ label, children }: { label: string; children: React.ReactNode }) { return <label className="rounded-2xl border border-white/10 bg-slate-950/55 p-5"><span className="mb-2 block text-sm font-semibold text-white">{label}</span>{children}</label>; }

export type { AdministrationSection };
