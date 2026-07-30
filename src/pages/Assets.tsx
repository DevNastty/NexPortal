import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import type { AuthUser } from "../types/navigation";

type Technician = {
  id: string;
  tech_number: string;
  full_name: string | null;
  region: string | null;
  active: boolean;
  truck_lease_amount: number | null;
  meter_lease_active: boolean | null;
  meter_lease_amount: number | null;
};

type TruckAsset = {
  id: string;
  vin: string;
  unit_number: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  license_plate: string | null;
  status: string;
  assigned_technician_id: string | null;
  notes: string | null;
};

type MeterAsset = {
  id: string;
  serial_number: string;
  mac_address: string | null;
  manufacturer: string | null;
  model: string | null;
  status: string;
  assigned_technician_id: string | null;
  notes: string | null;
};

type AssetTab = "trucks" | "meters";

const blankTruck = {
  vin: "", unit_number: "", year: "", make: "", model: "", license_plate: "", status: "available", assigned_technician_id: "", notes: "",
};
const blankMeter = {
  serial_number: "", mac_address: "", manufacturer: "", model: "", status: "available", assigned_technician_id: "", notes: "",
};

export default function AssetsPage({ authUser: _authUser }: { authUser: AuthUser }) {
  const [tab, setTab] = useState<AssetTab>("trucks");
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [trucks, setTrucks] = useState<TruckAsset[]>([]);
  const [meters, setMeters] = useState<MeterAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [truckForm, setTruckForm] = useState(blankTruck);
  const [meterForm, setMeterForm] = useState(blankMeter);

  const technicianById = useMemo(
    () => new Map(technicians.map(tech => [tech.id, tech])),
    [technicians],
  );

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError("");

    const [techResult, truckResult, meterResult] = await Promise.all([
      supabase.from("payroll_technicians").select("id, tech_number, full_name, region, active, truck_lease_amount, meter_lease_active, meter_lease_amount").order("full_name"),
      supabase.from("asset_trucks").select("*").order("unit_number", { ascending: true }),
      supabase.from("asset_meters").select("*").order("serial_number", { ascending: true }),
    ]);

    const firstError = techResult.error || truckResult.error || meterResult.error;
    if (firstError) setError(firstError.message);
    setTechnicians((techResult.data || []) as Technician[]);
    setTrucks((truckResult.data || []) as TruckAsset[]);
    setMeters((meterResult.data || []) as MeterAsset[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  function techLabel(id: string | null) {
    if (!id) return "Unassigned";
    const tech = technicianById.get(id);
    return tech ? `${tech.full_name || "Unnamed tech"} (${tech.tech_number})` : "Unknown technician";
  }

  function resetForm() {
    setEditingId(null);
    setTruckForm(blankTruck);
    setMeterForm(blankMeter);
    setShowForm(false);
  }

  function openNew() {
    setEditingId(null);
    setTruckForm(blankTruck);
    setMeterForm(blankMeter);
    setShowForm(true);
    setError("");
    setNotice("");
  }

  function editTruck(truck: TruckAsset) {
    setTab("trucks");
    setEditingId(truck.id);
    setTruckForm({
      vin: truck.vin,
      unit_number: truck.unit_number || "",
      year: truck.year ? String(truck.year) : "",
      make: truck.make || "",
      model: truck.model || "",
      license_plate: truck.license_plate || "",
      status: truck.status,
      assigned_technician_id: truck.assigned_technician_id || "",
      notes: truck.notes || "",
    });
    setShowForm(true);
  }

  function editMeter(meter: MeterAsset) {
    setTab("meters");
    setEditingId(meter.id);
    setMeterForm({
      serial_number: meter.serial_number,
      mac_address: meter.mac_address || "",
      manufacturer: meter.manufacturer || "",
      model: meter.model || "",
      status: meter.status,
      assigned_technician_id: meter.assigned_technician_id || "",
      notes: meter.notes || "",
    });
    setShowForm(true);
  }


  async function saveTruck(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    const payload = {
      vin: truckForm.vin.trim().toUpperCase(),
      unit_number: truckForm.unit_number.trim() || null,
      year: truckForm.year ? Number(truckForm.year) : null,
      make: truckForm.make.trim() || null,
      model: truckForm.model.trim() || null,
      license_plate: truckForm.license_plate.trim().toUpperCase() || null,
      status: truckForm.assigned_technician_id ? "assigned" : truckForm.status,
      assigned_technician_id: truckForm.assigned_technician_id || null,
      notes: truckForm.notes.trim() || null,
    };
    const result = editingId
      ? await supabase.from("asset_trucks").update(payload).eq("id", editingId)
      : await supabase.from("asset_trucks").insert(payload);
    if (result.error) setError(result.error.message);
    else {
      setNotice(editingId ? "Truck updated." : "Truck added.");
      resetForm(); await loadAssets();
    }
    setSaving(false);
  }

  async function saveMeter(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    const payload = {
      serial_number: meterForm.serial_number.trim(),
      mac_address: meterForm.mac_address.trim().toUpperCase() || null,
      manufacturer: meterForm.manufacturer.trim() || null,
      model: meterForm.model.trim() || null,
      status: meterForm.assigned_technician_id ? "assigned" : meterForm.status,
      assigned_technician_id: meterForm.assigned_technician_id || null,
      notes: meterForm.notes.trim() || null,
    };
    const result = editingId
      ? await supabase.from("asset_meters").update(payload).eq("id", editingId)
      : await supabase.from("asset_meters").insert(payload);
    if (result.error) setError(result.error.message);
    else {
      setNotice(editingId ? "Meter updated." : "Meter added.");
      resetForm(); await loadAssets();
    }
    setSaving(false);
  }

  async function removeAsset(type: AssetTab, asset: TruckAsset | MeterAsset) {
    const label = type === "trucks" ? (asset as TruckAsset).vin : (asset as MeterAsset).serial_number;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    setError(""); setNotice("");
    const result = await supabase.from(type === "trucks" ? "asset_trucks" : "asset_meters").delete().eq("id", asset.id);
    if (result.error) setError(result.error.message);
    else {
      setNotice(type === "trucks" ? "Truck deleted." : "Meter deleted.");
      await loadAssets();
    }
  }

  const filteredTrucks = useMemo(() => trucks.filter(truck => {
    const haystack = [truck.vin, truck.unit_number, truck.make, truck.model, truck.license_plate, techLabel(truck.assigned_technician_id)].join(" ").toLowerCase();
    return (!search || haystack.includes(search.toLowerCase())) && (statusFilter === "all" || truck.status === statusFilter);
  }), [trucks, search, statusFilter, technicianById]);

  const filteredMeters = useMemo(() => meters.filter(meter => {
    const haystack = [meter.serial_number, meter.mac_address, meter.manufacturer, meter.model, techLabel(meter.assigned_technician_id)].join(" ").toLowerCase();
    return (!search || haystack.includes(search.toLowerCase())) && (statusFilter === "all" || meter.status === statusFilter);
  }), [meters, search, statusFilter, technicianById]);

  const assignedTrucks = trucks.filter(item => item.assigned_technician_id).length;
  const assignedMeters = meters.filter(item => item.assigned_technician_id).length;

  return (
    <section className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-slate-900/70 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-300">Director workspace</div>
          <h1 className="mt-1 text-2xl font-bold text-white">Asset Management</h1>
          <p className="mt-1 text-sm text-slate-400">Track every truck VIN and meter serial or MAC address, then assign each asset to a technician.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadAssets} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-200 hover:bg-white/10">Refresh</button>
          <button onClick={openNew} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500">Add {tab === "trucks" ? "truck" : "meter"}</button>
        </div>
      </div>

      {notice && <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>}
      {error && <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AssetCard label="Trucks" value={String(trucks.length)} detail={`${assignedTrucks} assigned`} />
        <AssetCard label="Available trucks" value={String(trucks.length - assignedTrucks)} detail="Ready to assign" />
        <AssetCard label="Meters" value={String(meters.length)} detail={`${assignedMeters} assigned`} />
        <AssetCard label="Available meters" value={String(meters.length - assignedMeters)} detail="Ready to assign" />
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
        <div className="flex flex-col gap-3 border-b border-white/10 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-fit rounded-xl border border-white/10 bg-slate-950 p-1">
            {(["trucks", "meters"] as AssetTab[]).map(item => <button key={item} onClick={() => { setTab(item); resetForm(); }} className={`rounded-lg px-4 py-2 text-xs font-semibold capitalize ${tab === item ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}>{item}</button>)}
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(240px,1fr)_170px]">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${tab} or technician...`} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm">
              <option value="all">All statuses</option><option value="available">Available</option><option value="assigned">Assigned</option><option value="maintenance">Maintenance</option><option value="retired">Retired</option>
            </select>
          </div>
        </div>

        {showForm && <div className="border-b border-white/10 bg-slate-950/40 p-4">
          {tab === "trucks" ? <TruckForm form={truckForm} setForm={setTruckForm} technicians={technicians} saving={saving} editing={Boolean(editingId)} onSubmit={saveTruck} onCancel={resetForm} />
            : <MeterForm form={meterForm} setForm={setMeterForm} technicians={technicians} saving={saving} editing={Boolean(editingId)} onSubmit={saveMeter} onCancel={resetForm} />}
        </div>}

        <div className="overflow-x-auto">
          {tab === "trucks" ? <TruckTable rows={filteredTrucks} loading={loading} techLabel={techLabel} onEdit={editTruck} onDelete={(asset: TruckAsset) => removeAsset("trucks", asset)} />
            : <MeterTable rows={filteredMeters} loading={loading} techLabel={techLabel} onEdit={editMeter} onDelete={(asset: MeterAsset) => removeAsset("meters", asset)} />}
        </div>
      </div>
    </section>
  );
}

function TechnicianSelect({ value, onChange, technicians }: { value: string; onChange: (value: string) => void; technicians: Technician[] }) {
  return <select value={value} onChange={e => onChange(e.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"><option value="">Unassigned</option>{technicians.filter(t => t.active !== false).map(t => <option key={t.id} value={t.id}>{t.full_name || "Unnamed tech"} ({t.tech_number})</option>)}</select>;
}

function TruckForm({ form, setForm, technicians, saving, editing, onSubmit, onCancel }: any) {
  return <form onSubmit={onSubmit} className="grid gap-3 lg:grid-cols-4">
    <input required maxLength={17} value={form.vin} onChange={e => setForm({ ...form, vin: e.target.value })} placeholder="VIN *" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
    <input value={form.unit_number} onChange={e => setForm({ ...form, unit_number: e.target.value })} placeholder="Unit number" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
    <input type="number" min="1980" max="2100" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} placeholder="Year" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
    <input value={form.make} onChange={e => setForm({ ...form, make: e.target.value })} placeholder="Make" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
    <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Model" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
    <input value={form.license_plate} onChange={e => setForm({ ...form, license_plate: e.target.value })} placeholder="License plate" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
    <TechnicianSelect value={form.assigned_technician_id} onChange={value => setForm({ ...form, assigned_technician_id: value })} technicians={technicians} />
    <select value={form.status} disabled={Boolean(form.assigned_technician_id)} onChange={e => setForm({ ...form, status: e.target.value })} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"><option value="available">Available</option><option value="maintenance">Maintenance</option><option value="retired">Retired</option></select>
    <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Notes" className="min-h-20 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm lg:col-span-3" />
    <div className="flex items-end gap-2"><button disabled={saving} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : editing ? "Update truck" : "Add truck"}</button><button type="button" onClick={onCancel} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300">Cancel</button></div>
  </form>;
}

function MeterForm({ form, setForm, technicians, saving, editing, onSubmit, onCancel }: any) {
  return <form onSubmit={onSubmit} className="grid gap-3 lg:grid-cols-4">
    <input required value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} placeholder="Serial number *" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
    <input value={form.mac_address} onChange={e => setForm({ ...form, mac_address: e.target.value })} placeholder="MAC address" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
    <input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} placeholder="Manufacturer" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
    <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Model" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm" />
    <TechnicianSelect value={form.assigned_technician_id} onChange={value => setForm({ ...form, assigned_technician_id: value })} technicians={technicians} />
    <select value={form.status} disabled={Boolean(form.assigned_technician_id)} onChange={e => setForm({ ...form, status: e.target.value })} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"><option value="available">Available</option><option value="maintenance">Maintenance</option><option value="retired">Retired</option></select>
    <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Notes" className="min-h-20 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm lg:col-span-2" />
    <div className="flex items-end gap-2"><button disabled={saving} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : editing ? "Update meter" : "Add meter"}</button><button type="button" onClick={onCancel} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300">Cancel</button></div>
  </form>;
}

function TruckTable({ rows, loading, techLabel, onEdit, onDelete }: any) { return <table className="min-w-full text-sm"><thead className="bg-slate-800 text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="px-4 py-3 text-left">Unit / VIN</th><th className="px-4 py-3 text-left">Vehicle</th><th className="px-4 py-3 text-left">Plate</th><th className="px-4 py-3 text-left">Assigned tech</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody>{rows.map((truck: TruckAsset) => <tr key={truck.id} className="border-t border-white/5 hover:bg-white/[.03]"><td className="px-4 py-3"><div className="font-semibold text-white">{truck.unit_number || "No unit #"}</div><div className="font-mono text-xs text-slate-400">{truck.vin}</div></td><td className="px-4 py-3 text-slate-200">{[truck.year, truck.make, truck.model].filter(Boolean).join(" ") || "—"}</td><td className="px-4 py-3 text-slate-300">{truck.license_plate || "—"}</td><td className="px-4 py-3 text-slate-200">{techLabel(truck.assigned_technician_id)}</td><td className="px-4 py-3"><StatusBadge status={truck.status} /></td><td className="px-4 py-3 text-right"><button onClick={() => onEdit(truck)} className="mr-3 text-blue-300 hover:text-blue-200">Edit</button><button onClick={() => onDelete(truck)} className="text-red-300 hover:text-red-200">Delete</button></td></tr>)}{!rows.length && !loading && <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500">No trucks found.</td></tr>}</tbody></table>; }
function MeterTable({ rows, loading, techLabel, onEdit, onDelete }: any) { return <table className="min-w-full text-sm"><thead className="bg-slate-800 text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="px-4 py-3 text-left">Serial number</th><th className="px-4 py-3 text-left">MAC address</th><th className="px-4 py-3 text-left">Meter</th><th className="px-4 py-3 text-left">Assigned tech</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody>{rows.map((meter: MeterAsset) => <tr key={meter.id} className="border-t border-white/5 hover:bg-white/[.03]"><td className="px-4 py-3 font-mono font-semibold text-white">{meter.serial_number}</td><td className="px-4 py-3 font-mono text-xs text-slate-300">{meter.mac_address || "—"}</td><td className="px-4 py-3 text-slate-200">{[meter.manufacturer, meter.model].filter(Boolean).join(" ") || "—"}</td><td className="px-4 py-3 text-slate-200">{techLabel(meter.assigned_technician_id)}</td><td className="px-4 py-3"><StatusBadge status={meter.status} /></td><td className="px-4 py-3 text-right"><button onClick={() => onEdit(meter)} className="mr-3 text-blue-300 hover:text-blue-200">Edit</button><button onClick={() => onDelete(meter)} className="text-red-300 hover:text-red-200">Delete</button></td></tr>)}{!rows.length && !loading && <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500">No meters found.</td></tr>}</tbody></table>; }
function StatusBadge({ status }: { status: string }) { const style = status === "assigned" ? "bg-blue-500/10 text-blue-200" : status === "available" ? "bg-emerald-500/10 text-emerald-200" : status === "maintenance" ? "bg-amber-500/10 text-amber-200" : "bg-slate-500/10 text-slate-300"; return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${style}`}>{status}</span>; }
function AssetCard({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><div className="text-[10px] font-semibold uppercase tracking-[.16em] text-slate-500">{label}</div><div className="mt-2 text-2xl font-bold text-white">{value}</div><div className="mt-1 text-xs text-slate-500">{detail}</div></div>; }
