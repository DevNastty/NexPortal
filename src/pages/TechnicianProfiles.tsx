import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import type { PayrollPreviewRow } from "../types/invoice";
import type { AuthUser } from "../types/navigation";

type Technician = {
  id: string;
  tech_number: string;
  full_name: string | null;
  region: string | null;
  active: boolean;
  email: string | null;
  phone: string | null;
  address: string | null;
  birth_date: string | null;
  start_date: string | null;
  manager_name: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  headshot_path: string | null;
  notes: string | null;
  company_id: string | null;
  payroll_companies?: { company_name: string } | null;
};

type TechDocument = {
  id: string;
  technician_id: string;
  title: string;
  document_type: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  status: string;
  signed_date: string | null;
  expiration_date: string | null;
  notes: string | null;
  created_at: string;
};



type FormTemplate = {
  id: string;
  name: string;
  description: string | null;
  file_name: string | null;
  storage_path: string | null;
  active: boolean;
  fields: unknown[] | null;
};

type SignatureRequest = {
  id: string;
  technician_id: string;
  template_id: string | null;
  template_name: string;
  recipient_email: string;
  status: string;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  completed_document_id: string | null;
  error_message: string | null;
  created_at: string;
};

type PayrollEntry = {
  id: string;
  weekEnding: string;
  region: string;
  grossPay: number;
  truck: number;
  meter: number;
  qc: number;
  adjustment: number;
  netPay: number;
  jobs: number;
};

type ProfileTab = "overview" | "payroll" | "assets" | "forms";
const BUCKET = "tech-documents";
const money = (value: number) => Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-");

export default function TechnicianProfiles({ authUser }: { authUser: AuthUser }) {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadTechnicians() {
    setLoading(true);
    setError("");
    let query = supabase
      .from("payroll_technicians")
      .select("id,tech_number,full_name,region,company_id,active,email,phone,address,birth_date,start_date,manager_name,emergency_contact_name,emergency_contact_phone,headshot_path,notes,payroll_companies(company_name)")
      .order("full_name", { ascending: true });
    if (authUser.role === "bp_owner") {
      if (!authUser.companyId) { setError("This BP Owner account is not assigned to a company."); setLoading(false); return; }
      query = query.eq("company_id", authUser.companyId);
    }
    const { data, error: loadError } = await query;
    if (loadError) setError(loadError.message);
    else setTechnicians((data || []) as unknown as Technician[]);
    setLoading(false);
  }

  useEffect(() => { void loadTechnicians(); }, [authUser.companyId, authUser.role]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return technicians.filter(tech => !q || [tech.full_name, tech.tech_number, tech.region, tech.email, tech.phone, tech.payroll_companies?.company_name]
      .some(value => String(value || "").toLowerCase().includes(q)));
  }, [technicians, search]);

  const selected = technicians.find(tech => tech.id === selectedId) || null;

  if (selected) {
    return <TechnicianProfile technician={selected} onBack={() => setSelectedId(null)} onChanged={loadTechnicians} />;
  }

  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">Management</p>
          <h1 className="mt-1 text-2xl font-bold text-white">Technician Profiles</h1>
          <p className="mt-1 text-sm text-slate-400">Contact details, payroll history, assigned assets, headshots, and assigned forms.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-300">{technicians.length} technicians</div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
      {notice && <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</div>}

      <div className="mb-4 rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, tech number, region, company, phone, or email…" className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-blue-500" />
      </div>

      {loading ? <div className="py-16 text-center text-sm text-slate-400">Loading technician profiles…</div> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(tech => <TechnicianCard key={tech.id} technician={tech} onOpen={() => setSelectedId(tech.id)} />)}
          {!filtered.length && <div className="col-span-full rounded-2xl border border-dashed border-white/10 p-12 text-center text-slate-500">No technicians match your search.</div>}
        </div>
      )}
    </main>
  );
}

function TechnicianCard({ technician, onOpen }: { technician: Technician; onOpen: () => void }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!technician.headshot_path) { setPhotoUrl(null); return; }
    void supabase.storage.from(BUCKET).createSignedUrl(technician.headshot_path, 3600).then(({ data }) => {
      if (active) setPhotoUrl(data?.signedUrl || null);
    });
    return () => { active = false; };
  }, [technician.headshot_path]);

  return <button type="button" onClick={onOpen} className="group rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-left transition hover:border-blue-400/40 hover:bg-slate-900">
    <div className="flex items-center gap-4">
      {photoUrl ? <img src={photoUrl} alt="" className="h-16 w-16 rounded-2xl object-cover" /> : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-blue-600/20 text-xl font-bold text-blue-300">{initials(technician.full_name || technician.tech_number)}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold text-white">{technician.full_name || "Unnamed technician"}</div>
        <div className="mt-0.5 text-xs font-medium text-blue-300">Tech #{technician.tech_number}</div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-400">
          <span className="rounded-full bg-white/5 px-2 py-1">{technician.region || "No region"}</span>
          <span className="rounded-full bg-white/5 px-2 py-1">{technician.payroll_companies?.company_name || "No company"}</span>
          <span className={`rounded-full px-2 py-1 ${technician.active ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-500/10 text-slate-400"}`}>{technician.active ? "Active" : "Inactive"}</span>
        </div>
      </div>
      <span className="text-lg text-slate-600 transition group-hover:translate-x-1 group-hover:text-blue-300">›</span>
    </div>
  </button>;
}

function TechnicianProfile({ technician, onBack, onChanged }: { technician: Technician; onBack: () => void; onChanged: () => Promise<void> }) {
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refreshPhoto(path = technician.headshot_path) {
    if (!path) { setPhotoUrl(null); return; }
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    setPhotoUrl(data?.signedUrl || null);
  }
  useEffect(() => { void refreshPhoto(); }, [technician.headshot_path]);

  async function uploadHeadshot(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Headshot must be an image file."); return; }
    setBusyPhoto(true); setError(""); setNotice("");
    const path = `${technician.id}/headshot/${Date.now()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type });
    if (uploadError) { setError(uploadError.message); setBusyPhoto(false); return; }
    const { error: updateError } = await supabase.from("payroll_technicians").update({ headshot_path: path }).eq("id", technician.id);
    if (updateError) { setError(updateError.message); setBusyPhoto(false); return; }
    await onChanged(); await refreshPhoto(path); setNotice("Headshot updated."); setBusyPhoto(false);
  }

  return <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
    <button onClick={onBack} className="mb-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/10">← Back to technicians</button>
    {error && <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
    {notice && <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</div>}

    <section className="rounded-3xl border border-white/10 bg-slate-900/75 p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="relative h-28 w-28 shrink-0">
          {photoUrl ? <img src={photoUrl} alt="Technician headshot" className="h-28 w-28 rounded-3xl object-cover" /> : <div className="flex h-28 w-28 items-center justify-center rounded-3xl bg-blue-600/20 text-3xl font-bold text-blue-300">{initials(technician.full_name || technician.tech_number)}</div>}
          <label className="absolute -bottom-2 -right-2 cursor-pointer rounded-xl bg-blue-600 px-3 py-2 text-[10px] font-semibold text-white shadow-lg hover:bg-blue-500">
            {busyPhoto ? "Uploading…" : "Change photo"}
            <input type="file" accept="image/*" disabled={busyPhoto} onChange={uploadHeadshot} className="hidden" />
          </label>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-white">{technician.full_name || "Unnamed technician"}</h1>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${technician.active ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-400"}`}>{technician.active ? "Active" : "Inactive"}</span>
          </div>
          <p className="mt-1 text-sm text-blue-300">Tech #{technician.tech_number}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400"><span>{technician.region || "No region"}</span><span>•</span><span>{technician.payroll_companies?.company_name || "No company"}</span></div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setTab("forms")} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500">Send Form</button>
            <button type="button" onClick={() => setTab("payroll")} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10">Payroll</button>
            <button type="button" onClick={() => setTab("overview")} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10">Edit Profile</button>
          </div>
        </div>
      </div>
    </section>

    <div className="mt-5 flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/70 p-2">
      {(["overview", "payroll", "assets", "forms"] as ProfileTab[]).map(item => <button key={item} onClick={() => setTab(item)} className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium capitalize ${tab === item ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>{item === "payroll" ? "Payroll History" : item}</button>)}
    </div>

    <div className="mt-5">
      {tab === "overview" && <Overview technician={technician} onChanged={onChanged} onNotice={setNotice} onError={setError} />}
      {tab === "payroll" && <PayrollHistoryForTech technician={technician} />}
      {tab === "assets" && <TechAssets technician={technician} />}
      {tab === "forms" && <Forms technician={technician} onNotice={setNotice} onError={setError} />}
    </div>
  </main>;
}

function Overview({ technician, onChanged, onNotice, onError }: { technician: Technician; onChanged: () => Promise<void>; onNotice: (s: string) => void; onError: (s: string) => void }) {
  const [form, setForm] = useState({
    full_name: technician.full_name || "", email: technician.email || "", phone: technician.phone || "", address: technician.address || "",
    birth_date: technician.birth_date || "", start_date: technician.start_date || "", manager_name: technician.manager_name || "",
    emergency_contact_name: technician.emergency_contact_name || "", emergency_contact_phone: technician.emergency_contact_phone || "", notes: technician.notes || "",
  });
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); onError("");
    const values = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim() || null]));
    const { error } = await supabase.from("payroll_technicians").update(values).eq("id", technician.id);
    if (error) onError(error.message); else { onNotice("Technician profile saved."); await onChanged(); }
    setSaving(false);
  }
  const field = (key: keyof typeof form, label: string, type = "text") => <label className="text-xs text-slate-400">{label}<input type={type} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500" /></label>;
  return <form onSubmit={save} className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {field("full_name", "Full name")}{field("email", "Email", "email")}{field("phone", "Phone")}{field("address", "Address")}{field("birth_date", "Birth date", "date")}{field("start_date", "Start date", "date")}{field("manager_name", "Manager")}{field("emergency_contact_name", "Emergency contact")}{field("emergency_contact_phone", "Emergency phone")}
    </div>
    <label className="mt-4 block text-xs text-slate-400">Notes<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={4} className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500" /></label>
    <button disabled={saving} className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save profile"}</button>
  </form>;
}

function PayrollHistoryForTech({ technician }: { technician: Technician }) {
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data, error: loadError } = await supabase.from("payroll_run_regions").select("id,region,preview_json,truck_deductions,meter_deductions,qc_deductions,payroll_runs(week_ending)").order("saved_at", { ascending: false });
      if (loadError) { setError(loadError.message); setLoading(false); return; }
      const results: PayrollEntry[] = [];
      for (const region of (data || []) as any[]) {
        const rows = (Array.isArray(region.preview_json) ? region.preview_json : []) as PayrollPreviewRow[];
        const techRows = rows.filter(row => row.technician_id === technician.id || row.tech_number?.toUpperCase() === technician.tech_number.toUpperCase());
        if (!techRows.length) continue;
        const grossPay = techRows.reduce((sum, row) => sum + Number(row.contractor_pay || 0), 0);
        const truck = Math.max(...techRows.map(row => Number(row.truck_lease_amount || 0)), 0);
        const meter = Math.max(...techRows.map(row => Number(row.meter_lease_amount || 0)), 0);
        const qc = Math.max(...techRows.map(row => Number(row.missed_qc_deduction || 0)), 0);
        const adjustment = Number(techRows.find(row => Number(row.manual_adjustment_amount || 0) !== 0)?.manual_adjustment_amount || 0);
        results.push({ id: region.id, weekEnding: region.payroll_runs?.week_ending || "Unknown", region: region.region, grossPay, truck, meter, qc, adjustment, netPay: grossPay - truck - meter - qc + adjustment, jobs: techRows.length });
      }
      setEntries(results); setLoading(false);
    }
    void load();
  }, [technician.id, technician.tech_number]);
  const totals = entries.reduce((a, e) => ({ gross: a.gross + e.grossPay, deductions: a.deductions + e.truck + e.meter + e.qc - e.adjustment, net: a.net + e.netPay }), { gross: 0, deductions: 0, net: 0 });
  if (loading) return <Panel>Loading payroll history…</Panel>;
  if (error) return <Panel><span className="text-red-300">{error}</span></Panel>;
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3"><Stat label="Gross pay" value={money(totals.gross)} /><Stat label="Deductions" value={money(totals.deductions)} /><Stat label="Net pay" value={money(totals.net)} /></div>
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-950/70 text-xs text-slate-500"><tr><th className="p-3">Week ending</th><th className="p-3">Region</th><th className="p-3">Lines</th><th className="p-3">Gross</th><th className="p-3">Truck</th><th className="p-3">Meter</th><th className="p-3">QC</th><th className="p-3">Adjustment</th><th className="p-3">Net</th></tr></thead><tbody>{entries.map(e => <tr key={e.id} className="border-t border-white/5"><td className="p-3 font-medium text-white">{e.weekEnding}</td><td className="p-3 text-slate-400">{e.region}</td><td className="p-3 text-slate-400">{e.jobs}</td><td className="p-3 text-slate-300">{money(e.grossPay)}</td><td className="p-3 text-slate-400">{money(e.truck)}</td><td className="p-3 text-slate-400">{money(e.meter)}</td><td className="p-3 text-slate-400">{money(e.qc)}</td><td className={`p-3 ${e.adjustment >= 0 ? "text-emerald-300" : "text-amber-300"}`}>{money(e.adjustment)}</td><td className="p-3 font-semibold text-emerald-300">{money(e.netPay)}</td></tr>)}</tbody></table></div>{!entries.length && <div className="p-10 text-center text-slate-500">No saved payroll history for this technician yet.</div>}</div>
  </div>;
}

function TechAssets({ technician }: { technician: Technician }) {
  const [trucks, setTrucks] = useState<any[]>([]); const [meters, setMeters] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { void Promise.all([
    supabase.from("asset_trucks").select("*").eq("assigned_technician_id", technician.id),
    supabase.from("asset_meters").select("*").eq("assigned_technician_id", technician.id),
  ]).then(([truckResult, meterResult]) => { setTrucks(truckResult.data || []); setMeters(meterResult.data || []); setLoading(false); }); }, [technician.id]);
  if (loading) return <Panel>Loading assigned assets…</Panel>;
  return <div className="grid gap-4 lg:grid-cols-2"><Panel><h3 className="mb-3 font-semibold text-white">Assigned trucks</h3>{trucks.map(t => <div key={t.id} className="mb-2 rounded-xl bg-slate-950/70 p-3 text-sm"><div className="font-medium text-white">VIN {t.vin || "—"}</div><div className="mt-1 text-xs text-slate-500">Status: {t.status || "Unknown"}</div></div>)}{!trucks.length && <p className="text-sm text-slate-500">No truck assigned.</p>}</Panel><Panel><h3 className="mb-3 font-semibold text-white">Assigned meters</h3>{meters.map(m => <div key={m.id} className="mb-2 rounded-xl bg-slate-950/70 p-3 text-sm"><div className="font-medium text-white">Serial {m.serial_number || "—"}</div><div className="mt-1 text-xs text-slate-500">MAC: {m.mac_address || "—"} · Status: {m.status || "Unknown"}</div></div>)}{!meters.length && <p className="text-sm text-slate-500">No meter assigned.</p>}</Panel></div>;
}

function Forms({ technician, onNotice, onError }: { technician: Technician; onNotice: (s: string) => void; onError: (s: string) => void }) {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [requests, setRequests] = useState<SignatureRequest[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  async function load() {
    setLoading(true);
    const [templateResult, requestResult] = await Promise.all([
      supabase.from("tech_form_templates").select("id,name,description,file_name,storage_path,active,fields").eq("active", true).order("name"),
      supabase.from("tech_signature_requests").select("*").eq("technician_id", technician.id).neq("status", "cancelled").order("created_at", { ascending: false }),
    ]);
    if (templateResult.error) onError(templateResult.error.message);
    else {
      const nextTemplates = (templateResult.data || []) as FormTemplate[];
      setTemplates(nextTemplates);
      setSelectedTemplateId(current => current || nextTemplates[0]?.id || "");
    }
    if (requestResult.error) onError(requestResult.error.message);
    else setRequests((requestResult.data || []) as SignatureRequest[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [technician.id]);

  const selectedTemplate = templates.find(item => item.id === selectedTemplateId) || null;

  async function previewTemplate(template: FormTemplate) {
    if (!template.storage_path) { onError("This template does not have an uploaded PDF."); return; }
    const { data, error } = await supabase.storage.from("form-templates").createSignedUrl(template.storage_path, 600);
    if (error) onError(error.message);
    else if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function assignForm() {
    if (!selectedTemplate) { onError("Choose a form template."); return; }
    if (!technician.email) { onError("Add an email address to this technician before assigning a form."); return; }
    if (!(selectedTemplate.fields || []).length) { onError("Configure the template fields in Forms Center before assigning it."); return; }
    setAssigning(true); onError("");
    const duplicate = requests.some(request => request.template_id === selectedTemplate.id && !["signed", "cancelled", "expired"].includes(request.status));
    if (duplicate) {
      onError("This technician already has an active assignment for that form.");
      setAssigning(false);
      return;
    }
    const now = new Date().toISOString();
    const { error } = await supabase.from("tech_signature_requests").insert({
      technician_id: technician.id,
      template_id: selectedTemplate.id,
      template_name: selectedTemplate.name,
      recipient_email: technician.email,
      delivery_method: "portal_esign",
      status: "pending",
      sent_at: now,
      assigned_at: now,
    });
    if (error) onError(error.message);
    else { onNotice(`${selectedTemplate.name} assigned to ${technician.full_name || technician.tech_number}.`); await load(); }
    setAssigning(false);
  }

  async function openCompleted(request: SignatureRequest) {
    if (!request.completed_document_id) { onError("The signed PDF is not available for this form."); return; }
    const { data: document, error: documentError } = await supabase.from("tech_documents").select("storage_path,file_name").eq("id", request.completed_document_id).maybeSingle();
    if (documentError) { onError(documentError.message); return; }
    if (!document?.storage_path) { onError("The signed PDF file could not be found."); return; }
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(document.storage_path, 180);
    if (error) onError(error.message);
    else if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function cancelRequest(request: SignatureRequest) {
    if (!window.confirm(`Cancel ${request.template_name} for this technician?`)) return;
    const { error } = await supabase.from("tech_signature_requests").update({ status: "cancelled" }).eq("id", request.id);
    if (error) onError(error.message);
    else { onNotice("Form assignment cancelled."); await load(); }
  }

  const statusClass = (status: string) => {
    const normalized = status.toLowerCase();
    if (["signed", "approved", "accepted", "completed"].includes(normalized)) return "bg-emerald-500/10 text-emerald-300";
    if (["failed", "aborted", "cancelled", "expired"].includes(normalized)) return "bg-red-500/10 text-red-300";
    if (normalized === "viewed") return "bg-blue-500/10 text-blue-300";
    return "bg-amber-500/10 text-amber-300";
  };

  const signedCount = requests.filter(request => request.status === "signed").length;
  const pendingCount = requests.filter(request => ["pending", "viewed", "waiting_signature"].includes(request.status)).length;

  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat label="Assigned forms" value={String(requests.length)} />
      <Stat label="Pending signatures" value={String(pendingCount)} />
      <Stat label="Signed forms" value={String(signedCount)} />
    </div>
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Panel>
        <h3 className="font-semibold text-white">Assign portal form</h3>
        <p className="mt-1 text-xs text-slate-500">The technician will complete and sign it from My Forms. Completed forms can be opened directly from the form history.</p>
        <label className="mt-4 block text-xs text-slate-400">Form template
          <select value={selectedTemplateId} onChange={event => setSelectedTemplateId(event.target.value)} className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white">
            {!templates.length && <option value="">No templates configured</option>}
            {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        </label>
        <div className="mt-3 rounded-xl bg-slate-950/70 p-3 text-xs text-slate-400">
          <div><span className="text-slate-500">Recipient:</span> {technician.email || "No email on profile"}</div>
          {selectedTemplate && <><div className="mt-2 text-slate-500">{selectedTemplate.description || selectedTemplate.file_name || "No description"}</div><div className="mt-2 text-blue-300">{(selectedTemplate.fields || []).length} configured field{(selectedTemplate.fields || []).length === 1 ? "" : "s"}</div></>}
        </div>
        <button type="button" disabled={!selectedTemplate?.storage_path} onClick={() => selectedTemplate && void previewTemplate(selectedTemplate)} className="mt-4 w-full rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50">Preview PDF</button>
        <button type="button" disabled={assigning || !selectedTemplate || !technician.email} onClick={() => void assignForm()} className="mt-2 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">{assigning ? "Assigning…" : "Assign to technician"}</button>
      </Panel>

      <div className="space-y-3">
        {loading ? <Panel>Loading form history…</Panel> : requests.map(request => <div key={request.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium text-white">{request.template_name}</div>
              <div className="mt-1 text-xs text-slate-500">Assigned {new Date(request.created_at).toLocaleString()} · {request.recipient_email || technician.email || "No email"}</div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className={`rounded-full px-2 py-1 ${statusClass(request.status)}`}>{request.status.replace(/_/g, " ")}</span>
                {request.viewed_at && <span className="rounded-full bg-blue-500/10 px-2 py-1 text-blue-300">Viewed {new Date(request.viewed_at).toLocaleDateString()}</span>}
                {request.signed_at && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">Signed {new Date(request.signed_at).toLocaleDateString()}</span>}
              </div>
              {request.error_message && <div className="mt-2 text-xs text-red-300">{request.error_message}</div>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {request.completed_document_id && <button type="button" onClick={() => void openCompleted(request)} className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">View signed PDF</button>}
              {!request.completed_document_id && !["cancelled", "expired"].includes(request.status) && <button type="button" onClick={() => void cancelRequest(request)} className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">Cancel</button>}
            </div>
          </div>
        </div>)}
        {!loading && !requests.length && <Panel><div className="py-8 text-center text-slate-500">No forms have been assigned to this technician.</div></Panel>}
      </div>
    </div>
  </div>;
}

function Documents({ technician, onNotice, onError }: { technician: Technician; onNotice: (s: string) => void; onError: (s: string) => void }) {
  const [documents, setDocuments] = useState<TechDocument[]>([]); const [loading, setLoading] = useState(true); const [uploading, setUploading] = useState(false);
  const [documentType, setDocumentType] = useState("Other"); const [signedDate, setSignedDate] = useState(""); const [expirationDate, setExpirationDate] = useState("");
  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("tech_documents")
      .select("*")
      .eq("technician_id", technician.id)
      .order("created_at", { ascending: false });

    if (error) {
      onError(error.message);
    } else {
      // E-sign completions remain stored in tech_documents for retention and
      // auditing, but they are displayed only in the technician's Forms tab.
      const visibleDocuments = ((data || []) as TechDocument[]).filter(
        document => document.document_type?.trim().toLowerCase() !== "signed form",
      );
      setDocuments(visibleDocuments);
    }
    setLoading(false);
  }
  useEffect(() => { void load(); }, [technician.id]);
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []); event.target.value = ""; if (!files.length) return;
    setUploading(true); onError("");
    for (const file of files) {
      const path = `${technician.id}/documents/${Date.now()}-${safeFileName(file.name)}`;
      const { error: storageError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
      if (storageError) { onError(`${file.name}: ${storageError.message}`); continue; }
      const { error: rowError } = await supabase.from("tech_documents").insert({ technician_id: technician.id, title: file.name.replace(/\.[^.]+$/, ""), document_type: documentType, file_name: file.name, storage_path: path, mime_type: file.type || null, file_size: file.size, status: signedDate ? "signed" : "uploaded", signed_date: signedDate || null, expiration_date: expirationDate || null });
      if (rowError) onError(`${file.name}: ${rowError.message}`);
    }
    onNotice("Document upload completed."); await load(); setUploading(false);
  }
  async function openDocument(doc: TechDocument, download = false) { const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 120, { download: download ? doc.file_name : undefined }); if (error) { onError(error.message); return; } if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer"); }
  async function remove(doc: TechDocument) { if (!window.confirm(`Delete ${doc.file_name}?`)) return; const { error: storageError } = await supabase.storage.from(BUCKET).remove([doc.storage_path]); if (storageError) { onError(storageError.message); return; } const { error } = await supabase.from("tech_documents").delete().eq("id", doc.id); if (error) onError(error.message); else { onNotice("Document deleted."); await load(); } }
  return <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]"><Panel><h3 className="font-semibold text-white">Upload documents</h3><p className="mt-1 text-xs text-slate-500">Files are stored privately in this technician’s folder.</p><label className="mt-4 block text-xs text-slate-400">Document type<select value={documentType} onChange={e => setDocumentType(e.target.value)} className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white"><option>W-9</option><option>Contractor Agreement</option><option>Driver License</option><option>Insurance</option><option>Background Check</option><option>Drug Test</option><option>Certification</option><option>Disciplinary Form</option><option>Other</option></select></label><label className="mt-3 block text-xs text-slate-400">Signed date<input type="date" value={signedDate} onChange={e => setSignedDate(e.target.value)} className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label><label className="mt-3 block text-xs text-slate-400">Expiration date<input type="date" value={expirationDate} onChange={e => setExpirationDate(e.target.value)} className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label><label className="mt-4 block cursor-pointer rounded-xl bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-blue-500">{uploading ? "Uploading…" : "Choose files"}<input type="file" multiple disabled={uploading} onChange={upload} className="hidden" /></label></Panel><div className="space-y-3">{loading ? <Panel>Loading documents…</Panel> : documents.map(doc => <div key={doc.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="truncate font-medium text-white">{doc.title}</div><div className="mt-1 text-xs text-slate-500">{doc.document_type} · {formatSize(doc.file_size)} · Uploaded {new Date(doc.created_at).toLocaleDateString()}</div><div className="mt-2 flex flex-wrap gap-2 text-[11px]"><span className="rounded-full bg-blue-500/10 px-2 py-1 text-blue-300">{doc.status}</span>{doc.signed_date && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">Signed {doc.signed_date}</span>}{doc.expiration_date && <span className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-300">Expires {doc.expiration_date}</span>}</div></div><div className="flex shrink-0 gap-2"><button onClick={() => void openDocument(doc)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5">View</button><button onClick={() => void openDocument(doc, true)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5">Download</button><button onClick={() => void remove(doc)} className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">Delete</button></div></div></div>)}{!loading && !documents.length && <Panel><div className="py-8 text-center text-slate-500">No documents uploaded for this technician.</div></Panel>}</div></div>;
}

function Panel({ children }: { children: React.ReactNode }) { return <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 text-sm text-slate-400">{children}</div>; }
function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div><div className="mt-2 text-2xl font-bold text-white">{value}</div></div>; }
function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "T"; }
function formatSize(size: number | null) { if (!size) return "Unknown size"; if (size < 1024) return `${size} B`; if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`; return `${(size / 1024 ** 2).toFixed(1)} MB`; }
