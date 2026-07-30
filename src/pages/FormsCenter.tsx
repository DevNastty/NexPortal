import { ChangeEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { supabase } from "../supabase";

type FieldType = "text" | "date" | "checkbox" | "signature" | "initials";
type FormField = {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  source?: "embedded" | "known-template" | "manual";
};
type Template = {
  id: string;
  name: string;
  description: string | null;
  storage_path: string;
  file_name: string;
  active: boolean;
  created_at: string;
  fields: FormField[] | null;
};
type Technician = { id: string; tech_number: string; full_name: string | null; email: string | null; active: boolean };
type Request = { id: string; template_name: string; technician_id: string; recipient_email: string | null; status: string; created_at: string; signed_at: string | null; sent_at: string | null; error_message: string | null };

const safe = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-");
const errText = (e: unknown) => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e) || "An unknown error occurred."; } catch { return "An unknown error occurred."; }
};
const uid = () => crypto.randomUUID();
const newField = (): FormField => ({ id: uid(), label: "New field", type: "text", required: true, page: 1, x: 10, y: 10, width: 30, height: 5, source: "manual" });
const field = (label: string, type: FieldType, page: number, x: number, y: number, width: number, height: number, required = true): FormField => ({ id: uid(), label, type, required, page, x, y, width, height, source: "known-template" });

function knownTemplateFields(fileName: string, pageCount: number): FormField[] {
  const n = fileName.toLowerCase().replace(/\s+/g, " ");

  if (n.includes("addendum")) {
    const lastPage = Math.min(2, pageCount);
    return [
      // Reviewed against the actual BPS addendum signature page.
      field("Contractor Name", "text", lastPage, 14, 23.0, 34, 3.2),
      field("Contractor Signature", "signature", lastPage, 13, 18.6, 36, 5.2),
      field("Contractor Email", "text", lastPage, 28, 15.0, 28, 3.0),
      field("Date Signed", "date", lastPage, 14, 10.8, 22, 3.0),
    ];
  }

  if (n.includes("arbitration")) {
    const fields: FormField[] = [
      field("Contractor Name", "text", 1, 31, 92.0, 31, 3.0),
      field("Company Name", "text", 1, 66, 92.0, 24, 3.0, false),
      // Reviewed against page 7 of the BPS arbitration agreement.
      field("Contractor Agrees Initials", "initials", pageCount, 26, 88.0, 10, 3.0),
      field("Contractor Signature", "signature", pageCount, 65, 83.0, 27, 5.0),
      field("Contractor Name", "text", pageCount, 65, 77.4, 20, 3.0),
      field("Date Signed", "date", pageCount, 86, 77.4, 8, 3.0),
    ];
    for (let page = 1; page <= pageCount; page += 1) {
      fields.push(field(`Page ${page} Initials`, "initials", page, 81, 2.5, 13, 3.5));
    }
    return fields;
  }

  if (n.includes("independent contractor agreement")) {
    return [
      field("Effective Date", "date", 1, 41, 91.5, 18, 3.0),
      field("Contractor Name", "text", 1, 60, 91.5, 28, 3.0),
      field("Contractor Address", "text", Math.min(8, pageCount), 18, 13, 48, 4, false),
      field("Contractor Attention", "text", Math.min(8, pageCount), 18, 9, 40, 4, false),
      // Reviewed against the actual page 11 contractor signature block.
      field("Contractor Signature", "signature", pageCount, 14, 84.0, 30, 5.0),
      field("Contractor Email", "text", pageCount, 17, 80.3, 28, 3.0),
      field("Date Signed", "date", pageCount, 17, 76.7, 25, 3.0),
    ];
  }

  return [];
}

async function detectEmbeddedFields(bytes: ArrayBuffer): Promise<{ fields: FormField[]; pageCount: number }> {
  // Always give pdf-lib a plain Uint8Array. Some browsers expose uploaded data
  // through ArrayBufferLike/SharedArrayBuffer-backed views that trigger pdf-lib's
  // runtime type assertions.
  const pdfBytes = new Uint8Array(bytes.byteLength);
  pdfBytes.set(new Uint8Array(bytes));
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdf.getPages();
  const detected: FormField[] = [];

  // A number of flattened PDFs contain malformed or partial AcroForm dictionaries.
  // pdf-lib can throw while constructing those field wrappers. Embedded-field
  // detection is optional, so safely fall back to the known-template detector.
  let pdfFields: ReturnType<ReturnType<PDFDocument["getForm"]>["getFields"]> = [];
  try {
    pdfFields = pdf.getForm().getFields();
  } catch {
    return { fields: [], pageCount: pages.length };
  }

  for (const pdfField of pdfFields) {
    try {
      const anyField = pdfField as unknown as {
        getName?: () => string;
        constructor?: { name?: string };
        acroField?: { getWidgets?: () => Array<{ getRectangle?: () => { x: number; y: number; width: number; height: number }; P?: () => unknown }> };
      };
      const widgets = anyField.acroField?.getWidgets?.() || [];
      const typeName = anyField.constructor?.name || "";
      const label = anyField.getName?.() || "PDF field";
      let type: FieldType = "text";
      if (/check/i.test(typeName)) type = "checkbox";
      else if (/signature/i.test(typeName) || /signature/i.test(label)) type = "signature";
      else if (/date/i.test(label)) type = "date";
      else if (/initial/i.test(label)) type = "initials";

      for (const widget of widgets) {
        const rect = widget.getRectangle?.();
        if (!rect) continue;
        const pageRef = widget.P?.();
        let pageIndex = pageRef ? pages.findIndex(p => String(p.ref) === String(pageRef)) : 0;
        if (pageIndex < 0 || !pages[pageIndex]) pageIndex = 0;
        const size = pages[pageIndex].getSize();
        detected.push({
          id: uid(),
          label,
          type,
          required: true,
          page: pageIndex + 1,
          x: Math.max(0, Math.min(100, rect.x / size.width * 100)),
          y: Math.max(0, Math.min(100, rect.y / size.height * 100)),
          width: Math.max(1, Math.min(100, rect.width / size.width * 100)),
          height: Math.max(1, Math.min(100, rect.height / size.height * 100)),
          source: "embedded",
        });
      }
    } catch {
      // Ignore one malformed/unsupported field and continue importing the rest.
    }
  }
  return { fields: detected, pageCount: pages.length };
}

function knownTemplatePageCount(fileName: string): number | null {
  const n = fileName.toLowerCase().replace(/\s+/g, " ");
  if (n.includes("addendum")) return 2;
  if (n.includes("arbitration")) return 7;
  if (n.includes("independent contractor agreement")) return 11;
  return null;
}

async function detectFields(file: File): Promise<{ fields: FormField[]; method: string }> {
  // Recognized BPS forms use reviewed, deterministic layouts. Detect these
  // before asking pdf-lib to inspect AcroForm dictionaries because some of the
  // source PDFs contain malformed/partial form objects that can throw inside
  // pdf-lib even when getFields() is wrapped in a try/catch.
  const knownPageCount = knownTemplatePageCount(file.name);
  if (knownPageCount) {
    const known = knownTemplateFields(file.name, knownPageCount);
    return { fields: known, method: `Detected ${known.length} suggested fields from the BPS form layout` };
  }

  try {
    const bytes = await file.arrayBuffer();
    const embedded = await detectEmbeddedFields(bytes);
    if (embedded.fields.length) {
      return { fields: embedded.fields, method: `Imported ${embedded.fields.length} embedded PDF field${embedded.fields.length === 1 ? "" : "s"}` };
    }
  } catch (error) {
    console.warn("Embedded PDF field detection was skipped:", error);
  }

  return { fields: [], method: "No supported embedded fields were found. Add fields manually in Review fields." };
}

export default function FormsCenter() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [techs, setTechs] = useState<Technician[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedTechs, setSelectedTechs] = useState<string[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [designerUrl, setDesignerUrl] = useState("");
  const [designerPage, setDesignerPage] = useState(1);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const designerRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    setLoading(true);
    setMessage("");
    const [a, b, c] = await Promise.all([
      supabase.from("tech_form_templates").select("id,name,description,storage_path,file_name,active,created_at,fields").order("created_at", { ascending: false }),
      supabase.from("payroll_technicians").select("id,tech_number,full_name,email,active").eq("active", true).order("full_name"),
      supabase.from("tech_signature_requests").select("id,template_name,technician_id,recipient_email,status,created_at,signed_at,sent_at,error_message").neq("status", "cancelled").order("created_at", { ascending: false }).limit(100),
    ]);
    if (a.error) setMessage(a.error.message); else setTemplates((a.data || []) as Template[]);
    if (b.error) setMessage(b.error.message); else setTechs((b.data || []) as Technician[]);
    if (c.error) setMessage(c.error.message); else setRequests((c.data || []) as Request[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name.trim()) return;
    setBusy(true);
    setMessage("Detecting PDF fields…");
    try {
      const detection = await detectFields(file);
      const path = `templates/${Date.now()}-${safe(file.name)}`;
      const up = await supabase.storage.from("form-templates").upload(path, file, { contentType: "application/pdf" });
      if (up.error) throw up.error;
      const row = await supabase.from("tech_form_templates").insert({
        name: name.trim(),
        title: name.trim(),
        description: description.trim() || null,
        storage_path: path,
        file_name: file.name,
        active: true,
        fields: detection.fields,
      }).select("id").single();
      if (row.error) {
        await supabase.storage.from("form-templates").remove([path]);
        throw row.error;
      }
      setName("");
      setDescription("");
      setFile(null);
      setMessage(`${detection.method}. Review the detected layout before assigning.`);
      await load();
    } catch (e) {
      setMessage(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    if (!selectedTemplate || !selectedTechs.length) return;
    const t = templates.find(x => x.id === selectedTemplate);
    if (!t) return;
    if (!(t.fields || []).length) { setMessage("Configure at least one form field before assigning this form."); return; }
    setBusy(true);
    try {
      const rows = selectedTechs.map(id => {
        const tech = techs.find(x => x.id === id)!;
        return { technician_id: id, template_id: t.id, template_name: t.name, recipient_email: tech.email, status: "pending" };
      });
      const r = await supabase.from("tech_signature_requests").insert(rows).select("id,recipient_email");
      if (r.error) throw r.error;

      const assigned = r.data || [];
      const emailReady = assigned.filter(item => Boolean(item.recipient_email));
      const missingEmails = assigned.length - emailReady.length;
      let emailFailures = 0;

      if (emailReady.length) {
        const notification = await supabase.functions.invoke("send-form-assignment-email", {
          body: {
            requestIds: emailReady.map(item => item.id),
            portalUrl: `${window.location.origin}/?view=myForms`,
          },
        });
        if (notification.error) {
          emailFailures = emailReady.length;
          console.error("Form assignment email failed:", notification.error);
        } else {
          emailFailures = Number(notification.data?.failed || 0);
        }
      }

      const details = [
        missingEmails ? `${missingEmails} missing a profile email` : "",
        emailFailures ? `${emailFailures} email${emailFailures === 1 ? "" : "s"} failed` : "",
      ].filter(Boolean);
      setMessage(`Assigned ${t.name} to ${rows.length} technician${rows.length === 1 ? "" : "s"}${details.length ? `. ${details.join("; ")}. The assignments are still available in My Forms.` : " and sent the email notification."}`);
      setSelectedTechs([]);
      await load();
    } catch (e) { setMessage(errText(e)); } finally { setBusy(false); }
  }

  async function resendAssignmentEmail(request: Request) {
    if (!request.recipient_email) {
      setMessage("This technician does not have an email address saved on their profile.");
      return;
    }

    setResendingId(request.id);
    setMessage("");
    try {
      const notification = await supabase.functions.invoke("send-form-assignment-email", {
        body: {
          requestIds: [request.id],
          portalUrl: `${window.location.origin}/?view=myForms`,
        },
      });

      if (notification.error) throw notification.error;
      const failed = Number(notification.data?.failed || 0);
      if (failed) throw new Error("The assignment exists, but the email could not be sent. Check the Edge Function logs for details.");

      setMessage(`Email resent to ${request.recipient_email}.`);
      await load();
    } catch (e) {
      setMessage(`Email resend failed: ${errText(e)}`);
      await load();
    } finally {
      setResendingId(null);
    }
  }

  async function preview(t: Template) {
    const r = await supabase.storage.from("form-templates").createSignedUrl(t.storage_path, 600);
    if (r.error) setMessage(r.error.message); else window.open(r.data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function beginEdit(t: Template) {
    setMessage("");
    setEditing(t);
    setFields(Array.isArray(t.fields) ? t.fields : []);
    setDesignerPage(1);
    setSelectedFieldId(null);
    setDesignerUrl("");
    const r = await supabase.storage.from("form-templates").createSignedUrl(t.storage_path, 3600);
    if (r.error) {
      setMessage(`Designer preview failed: ${r.error.message}`);
      return;
    }
    setDesignerUrl(r.data.signedUrl);
  }

  function closeDesigner() {
    setEditing(null);
    setDesignerUrl("");
    setSelectedFieldId(null);
  }

  function updateField(id: string, patch: Partial<FormField>) {
    setFields(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  function startMove(e: ReactPointerEvent<HTMLDivElement>, fieldId: string) {
    if (!designerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedFieldId(fieldId);
    const box = designerRef.current.getBoundingClientRect();
    const fieldValue = fields.find(item => item.id === fieldId);
    if (!fieldValue) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const originalX = fieldValue.x;
    const originalY = fieldValue.y;
    const move = (event: PointerEvent) => {
      const dx = ((event.clientX - startX) / box.width) * 100;
      const dy = ((event.clientY - startY) / box.height) * 100;
      updateField(fieldId, {
        x: Math.max(0, Math.min(100 - fieldValue.width, originalX + dx)),
        y: Math.max(0, Math.min(100 - fieldValue.height, originalY - dy)),
      });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }

  function startResize(e: ReactPointerEvent<HTMLButtonElement>, fieldId: string) {
    if (!designerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const box = designerRef.current.getBoundingClientRect();
    const fieldValue = fields.find(item => item.id === fieldId);
    if (!fieldValue) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const originalWidth = fieldValue.width;
    const originalHeight = fieldValue.height;
    const move = (event: PointerEvent) => {
      const dw = ((event.clientX - startX) / box.width) * 100;
      const dh = ((event.clientY - startY) / box.height) * 100;
      updateField(fieldId, {
        width: Math.max(3, Math.min(100 - fieldValue.x, originalWidth + dw)),
        height: Math.max(2, Math.min(100 - fieldValue.y, originalHeight + dh)),
      });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }

  function addFieldOnCurrentPage() {
    const created = { ...newField(), page: designerPage, x: 35, y: 45, width: 30, height: 5 };
    setFields(current => [...current, created]);
    setSelectedFieldId(created.id);
  }

  async function redetect(t: Template) {
    setBusy(true);
    setMessage("Detecting PDF fields…");
    try {
      const dl = await supabase.storage.from("form-templates").download(t.storage_path);
      if (dl.error) throw dl.error;
      const source = new File([dl.data], t.file_name || `${t.name}.pdf`, { type: "application/pdf" });
      const detection = await detectFields(source);
      setFields(detection.fields);
      setMessage(`${detection.method}. Review and save the field layout.`);
    } catch (e) { setMessage(errText(e)); } finally { setBusy(false); }
  }

  async function saveFields() {
    if (!editing) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await supabase.from("tech_form_templates").update({ fields }).eq("id", editing.id);
      if (r.error) throw r.error;
      setMessage("Form fields saved.");
      closeDesigner();
      await load();
    } catch (e) { setMessage(errText(e)); } finally { setBusy(false); }
  }

  async function removeTemplate(t: Template) {
    if (!confirm(`Delete ${t.name}? Existing assignments will remain in history.`)) return;
    setBusy(true);
    try {
      await supabase.storage.from("form-templates").remove([t.storage_path]);
      const r = await supabase.from("tech_form_templates").delete().eq("id", t.id);
      if (r.error) throw r.error;
      setMessage("Form deleted.");
      await load();
    } catch (e) { setMessage(errText(e)); } finally { setBusy(false); }
  }

  const techName = useMemo(() => new Map(techs.map(t => [t.id, t.full_name || t.tech_number])), [techs]);

  return <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
    <div className="mb-5"><p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-400">Management</p><h1 className="mt-1 text-2xl font-bold text-white">Forms Center</h1><p className="mt-1 text-sm text-slate-400">Upload PDFs, auto-detect fields, review the layout, assign forms, and track signatures.</p></div>
    {message && <div className="mb-4 rounded-xl border border-white/10 bg-slate-900 p-3 text-sm text-slate-200">{message}</div>}
    <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
      <div className="space-y-5">
        <form onSubmit={upload} className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"><h2 className="font-semibold text-white">Upload form</h2><p className="mt-1 text-xs text-slate-500">The portal imports embedded PDF fields and recognizes the BPS agreement layouts automatically.</p><input value={name} onChange={e => setName(e.target.value)} required placeholder="Form name" className="mt-4 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm"/><textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" className="mt-3 min-h-20 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm"/><label className="mt-3 block rounded-xl border border-dashed border-white/15 bg-slate-950 p-4 text-sm text-slate-400">{file?.name || "Choose PDF"}<input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] || null)}/></label><button disabled={busy} className="mt-3 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Detecting & uploading…" : "Upload & detect fields"}</button></form>
        <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"><h2 className="font-semibold text-white">Assign form</h2><select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} className="mt-4 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm"><option value="">Choose form</option>{templates.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><div className="mt-3 max-h-64 space-y-2 overflow-y-auto rounded-xl bg-slate-950 p-3">{techs.map(t => <label key={t.id} className="flex items-center gap-3 text-sm text-slate-300"><input type="checkbox" checked={selectedTechs.includes(t.id)} onChange={e => setSelectedTechs(v => e.target.checked ? [...v, t.id] : v.filter(x => x !== t.id))}/><span>{t.full_name || t.tech_number}<span className="ml-2 text-xs text-slate-500">#{t.tech_number}</span></span></label>)}</div><button type="button" onClick={() => void assign()} disabled={busy || !selectedTemplate || !selectedTechs.length} className="mt-3 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Assign selected</button></div>
      </div>
      <div className="space-y-5">
        <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"><h2 className="font-semibold text-white">Form library</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{templates.map(t => <div key={t.id} className="rounded-xl border border-white/10 bg-slate-950/70 p-4"><div className="font-medium text-white">{t.name}</div><div className="mt-1 text-xs text-slate-500">{t.description || t.file_name}</div><div className="mt-2 text-xs text-blue-300">{(t.fields || []).length} detected/configured field{(t.fields || []).length === 1 ? "" : "s"}</div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void preview(t)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">Preview PDF</button><button onClick={() => beginEdit(t)} className="rounded-lg bg-blue-600/20 px-3 py-2 text-xs text-blue-300">Review fields</button><button onClick={() => void removeTemplate(t)} className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">Delete</button></div></div>)}{!loading && !templates.length && <p className="text-sm text-slate-500">No forms uploaded.</p>}</div></section>
        <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"><h2 className="font-semibold text-white">Recent assignments</h2><div className="mt-4 space-y-2">{requests.map(r => <div key={r.id} className="flex flex-col gap-3 rounded-xl bg-slate-950/70 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="text-sm text-white">{r.template_name}</div><div className="text-xs text-slate-500">{techName.get(r.technician_id) || r.recipient_email || "Technician"}</div><div className={`mt-1 text-xs ${r.error_message ? "text-red-300" : "text-slate-600"}`}>{r.error_message ? `Email error: ${r.error_message}` : r.sent_at ? `Email last sent ${new Date(r.sent_at).toLocaleString()}` : r.recipient_email ? "Email not sent yet" : "No email on technician profile"}</div></div><div className="flex flex-wrap items-center gap-2"><span className={`w-fit rounded-full px-2 py-1 text-xs ${r.status === "signed" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>{r.status}</span><button type="button" onClick={() => void resendAssignmentEmail(r)} disabled={resendingId === r.id || !r.recipient_email} className="rounded-lg border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-300 disabled:cursor-not-allowed disabled:opacity-40">{resendingId === r.id ? "Sending…" : "Resend Email"}</button></div></div>)}</div></section>
      </div>
    </div>
    {editing && <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/85 p-2 sm:p-4">
      <div className="mx-auto max-w-[1500px] rounded-2xl border border-white/10 bg-slate-900 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Visual field designer</h2>
            <p className="text-sm text-slate-400">Drag fields onto the exact lines in the PDF. Use the square handle to resize them. Saved positions are reused for every signer.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => void redetect(editing)} className="rounded-lg bg-violet-600/20 px-3 py-2 text-sm text-violet-300 disabled:opacity-50">Suggest fields</button>
            <button onClick={addFieldOnCurrentPage} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white">+ Add field</button>
            <button onClick={closeDesigner} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300">Close</button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="rounded-xl border border-white/10 bg-slate-950 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <button onClick={() => setDesignerPage(page => Math.max(1, page - 1))} disabled={designerPage <= 1} className="rounded-lg border border-white/10 px-3 py-2 text-sm disabled:opacity-30">Previous</button>
              <div className="text-sm text-slate-300">Page <input type="number" min="1" value={designerPage} onChange={e => setDesignerPage(Math.max(1, Number(e.target.value) || 1))} className="mx-2 w-16 rounded border border-white/10 bg-slate-900 px-2 py-1 text-center text-white"/></div>
              <button onClick={() => setDesignerPage(page => page + 1)} className="rounded-lg border border-white/10 px-3 py-2 text-sm">Next</button>
            </div>
            <div ref={designerRef} className="relative mx-auto aspect-[8.5/11] w-full max-w-[850px] overflow-hidden bg-white shadow-2xl select-none">
              {designerUrl ? <object key={`${designerUrl}-${designerPage}`} data={`${designerUrl}#page=${designerPage}&toolbar=0&navpanes=0&scrollbar=0&view=Fit`} type="application/pdf" className="absolute inset-0 h-full w-full"><iframe title="PDF preview" src={`${designerUrl}#page=${designerPage}&toolbar=0&navpanes=0&scrollbar=0&view=Fit`} className="h-full w-full border-0"/></object> : <div className="grid h-full place-items-center text-slate-500">Loading PDF preview…</div>}
              <div className="absolute inset-0 z-10">
                {fields.filter(item => item.page === designerPage).map(item => {
                  const selected = selectedFieldId === item.id;
                  return <div key={item.id} onPointerDown={e => startMove(e, item.id)} onClick={e => { e.stopPropagation(); setSelectedFieldId(item.id); }} style={{ left: `${item.x}%`, bottom: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%` }} className={`absolute cursor-move touch-none border-2 ${selected ? "border-blue-500 bg-blue-500/25" : "border-amber-500 bg-amber-400/20"}`}>
                    <div className="pointer-events-none truncate bg-slate-950/90 px-1 py-0.5 text-[10px] font-semibold text-white">{item.label}</div>
                    {selected && <button type="button" aria-label="Resize field" onPointerDown={e => startResize(e, item.id)} className="absolute -bottom-2 -right-2 h-4 w-4 cursor-se-resize touch-none rounded-sm border border-white bg-blue-600"/>}
                  </div>;
                })}
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-slate-500">The overlay is the saved signing position. Zooming the browser does not change the stored percentages.</p>
          </div>

          <aside className="space-y-3 rounded-xl border border-white/10 bg-slate-950 p-4">
            <div className="flex items-center justify-between"><h3 className="font-semibold text-white">Fields</h3><span className="text-xs text-slate-500">{fields.length} total</span></div>
            <div className="max-h-[68vh] space-y-2 overflow-y-auto pr-1">
              {fields.map(item => <button type="button" key={item.id} onClick={() => { setDesignerPage(item.page); setSelectedFieldId(item.id); }} className={`w-full rounded-lg border p-3 text-left ${selectedFieldId === item.id ? "border-blue-500 bg-blue-500/10" : "border-white/10 bg-slate-900"}`}>
                <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-white">{item.label}</span><span className="text-[10px] uppercase text-slate-500">p{item.page}</span></div>
                <div className="mt-1 text-xs text-slate-500">{item.type}{item.required ? " • required" : ""}</div>
              </button>)}
              {!fields.length && <div className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-slate-500">No fields yet. Click Add field or Suggest fields.</div>}
            </div>

            {selectedFieldId && (() => {
              const item = fields.find(value => value.id === selectedFieldId);
              if (!item) return null;
              return <div className="space-y-3 border-t border-white/10 pt-4">
                <label className="block text-xs text-slate-400">Label<input value={item.label} onChange={e => updateField(item.id, { label: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white"/></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-slate-400">Type<select value={item.type} onChange={e => updateField(item.id, { type: e.target.value as FieldType })} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-2 text-sm text-white"><option value="text">Text</option><option value="date">Date</option><option value="checkbox">Checkbox</option><option value="signature">Signature</option><option value="initials">Initials</option></select></label>
                  <label className="text-xs text-slate-400">Page<input type="number" min="1" value={item.page} onChange={e => updateField(item.id, { page: Math.max(1, Number(e.target.value) || 1) })} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-2 text-sm text-white"/></label>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={item.required} onChange={e => updateField(item.id, { required: e.target.checked })}/>Required</label>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-500"><span>X {item.x.toFixed(1)}%</span><span>Y {item.y.toFixed(1)}%</span><span>W {item.width.toFixed(1)}%</span><span>H {item.height.toFixed(1)}%</span></div>
                <button onClick={() => { setFields(current => current.filter(value => value.id !== item.id)); setSelectedFieldId(null); }} className="w-full rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">Remove field</button>
              </div>;
            })()}
            <button disabled={busy} onClick={() => void saveFields()} className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-50">Save visual layout</button>
          </aside>
        </div>
      </div>
    </div>}
  </main>;
}
