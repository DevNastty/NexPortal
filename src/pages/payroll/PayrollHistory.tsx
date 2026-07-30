import { useEffect, useMemo, useState } from "react";
import { deletePayrollDraft, listPayrollRuns, lockPayrollRun, type PayrollRun, type PayrollRunRegion } from "../../lib/payroll/payrollRuns";
const money = (value: number) => Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function PayrollHistory({ onOpen, onNotice, onError, regions }: {
  onOpen: (weekEnding: string, region: PayrollRunRegion) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  regions: string[];
}) {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");

  async function load() {
    setLoading(true);
    try { setRuns(await listPayrollRuns()); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const totals = useMemo(() => runs.reduce((a, run) => {
    for (const r of run.payroll_run_regions || []) { a.invoice += Number(r.invoice_total); a.pay += Number(r.net_pay); }
    return a;
  }, { invoice: 0, pay: 0 }), [runs]);

  async function lock(run: PayrollRun) {
    const complete = new Set((run.payroll_run_regions || []).filter(r => r.status === "complete").map(r => r.region));
    const missing = regions.filter(r => !complete.has(r));
    if (missing.length && !window.confirm(`These regions are not marked complete: ${missing.join(", ")}. Lock anyway?`)) return;
    if (!window.confirm(`Lock payroll for week ending ${run.week_ending}? This prevents region changes.`)) return;
    setBusyId(run.id);
    try { await lockPayrollRun(run.id); onNotice("Payroll week locked."); await load(); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyId(""); }
  }

  async function removeDraft(run: PayrollRun, region: PayrollRunRegion) {
    if (run.status === "locked" || region.status !== "draft") return;
    const confirmed = window.confirm(
      `Delete the ${region.region} payroll draft for week ending ${run.week_ending}?\n\nThis cannot be undone.`
    );
    if (!confirmed) return;

    const key = `delete:${region.id}`;
    setBusyId(key);
    onError("");
    try {
      await deletePayrollDraft({ runId: run.id, regionId: region.id });
      onNotice(`${region.region} payroll draft deleted.`);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  }

  if (loading) return <div className="text-sm text-slate-400">Loading payroll history…</div>;
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <Card label="Saved invoice revenue" value={money(totals.invoice)} />
      <Card label="Saved net payroll" value={money(totals.pay)} />
    </div>
    {runs.map(run => <div key={run.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div><div className="text-lg font-bold text-white">Week ending {run.week_ending}</div><div className="text-xs text-slate-500">{run.status === "locked" ? `Locked ${run.locked_at ? new Date(run.locked_at).toLocaleString() : ""}` : "Open payroll week"}</div></div>
        {run.status !== "locked" && <button onClick={() => void lock(run)} disabled={busyId === run.id} className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-200">{busyId === run.id ? "Locking…" : "Lock entire week"}</button>}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">{regions.map(region => {
        const savedRows = (run.payroll_run_regions || []).filter(r => r.region === region);
        return <div key={region} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
          <div className="flex items-center justify-between"><span className="font-semibold text-white">{region}</span><span className={"rounded-full px-2 py-1 text-[10px] font-semibold " + (savedRows.some(item => item.status === "complete") ? "bg-emerald-500/15 text-emerald-300" : savedRows.length ? "bg-amber-500/15 text-amber-300" : "bg-white/5 text-slate-500")}>{savedRows.length ? `${savedRows.length} saved` : "not started"}</span></div>
          {savedRows.length ? <div className="mt-3 space-y-3">{savedRows.map(saved => <div key={saved.id} className="rounded-lg border border-white/5 bg-white/[0.025] p-2.5">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-blue-300">{saved.payroll_type === "locates" ? "Locates" : "Cable"}</div>
            <div className="text-xs text-slate-400">Net pay <span className="float-right font-semibold text-white">{money(saved.net_pay)}</span></div>
            <div className="mt-1 text-xs text-slate-400">Issues <span className="float-right">{saved.issue_count}</span></div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button onClick={() => onOpen(run.week_ending, saved)} disabled={run.status === "locked" || busyId === `delete:${saved.id}`} className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{run.status === "locked" ? "Locked" : "Open"}</button>
              {saved.status === "draft" && run.status !== "locked" && <button onClick={() => void removeDraft(run, saved)} disabled={busyId === `delete:${saved.id}`} className="w-full rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/15 disabled:opacity-40">{busyId === `delete:${saved.id}` ? "Deleting…" : "Delete draft"}</button>}
            </div>
          </div>)}</div> : <div className="mt-3 text-xs text-slate-600">No invoice saved.</div>}
        </div>;
      })}</div>
    </div>)}
    {!runs.length && <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-slate-500">No saved payroll runs yet.</div>}
  </div>;
}
function Card({label,value}:{label:string;value:string}) { return <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div><div className="mt-2 text-2xl font-bold text-white">{value}</div></div>; }
