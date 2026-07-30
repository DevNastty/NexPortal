import { FormEvent, useState } from "react";
import { supabase } from "../../supabase";
import type { PayrollRegionRecord } from "../../types/payroll";

export default function Regions({ regions, onChanged, onNotice, onError }: {
  regions: PayrollRegionRecord[];
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function createRegion(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    setBusy(true); onError("");
    const nextOrder = Math.max(0, ...regions.map(r => r.sort_order || 0)) + 1;
    const { error } = await supabase.from("payroll_regions").insert({ name: clean, active: true, sort_order: nextOrder });
    if (error) onError(error.message); else { setName(""); onNotice(`${clean} region created.`); await onChanged(); }
    setBusy(false);
  }

  async function toggle(region: PayrollRegionRecord) {
    const { error } = await supabase.from("payroll_regions").update({ active: !region.active }).eq("id", region.id);
    if (error) onError(error.message); else { onNotice(`${region.name} ${region.active ? "deactivated" : "activated"}.`); await onChanged(); }
  }

  async function rename(region: PayrollRegionRecord) {
    const next = window.prompt("Region name", region.name)?.trim();
    if (!next || next === region.name) return;
    const { error } = await supabase.from("payroll_regions").update({ name: next }).eq("id", region.id);
    if (error) onError(error.message); else { onNotice(`Region renamed to ${next}.`); await onChanged(); }
  }

  return <div className="space-y-4">
    <form onSubmit={createRegion} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
      <h2 className="text-base font-semibold text-white">Payroll regions</h2>
      <p className="mt-1 text-xs text-slate-400">Create a region once and it will appear in payroll setup, invoice processing, and history.</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New region name" className="flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm" />
        <button disabled={busy || !name.trim()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Creating…" : "Create region"}</button>
      </div>
    </form>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {regions.map(region => <div key={region.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <div className="flex items-center justify-between gap-3"><div className="font-semibold text-white">{region.name}</div><span className={"rounded-full px-2 py-1 text-[10px] font-semibold " + (region.active ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-slate-500")}>{region.active ? "Active" : "Inactive"}</span></div>
        <div className="mt-4 flex gap-2"><button type="button" onClick={() => void rename(region)} className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">Rename</button><button type="button" onClick={() => void toggle(region)} className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">{region.active ? "Deactivate" : "Activate"}</button></div>
      </div>)}
    </div>
  </div>;
}
