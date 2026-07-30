import { useEffect, useMemo, useState } from "react";
import type { AuthUser } from "../types/navigation";
import { supabase } from "../supabase";

const ROLE_RANK: Record<string, number> = { tech: 0, bp_owner: 1, supervisor: 2, director: 3 };
function hasRole(user: { role?: string } | null | undefined, min: "tech" | "bp_owner" | "supervisor" | "director") {
  return (ROLE_RANK[user?.role ?? ""] ?? -1) >= ROLE_RANK[min];
}
const FTR_FILES: Record<string, string> = {
  Keystone: "/ftrhit/keystone.csv",
  Beltway: "/ftrhit/beltway.csv",
  Freedom: "/ftrhit/freedom.csv",
};
function detectDelimiter(line: string): string {
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  if (line.includes("|")) return "|";
  return ",";
}
function splitCsvLineWith(line: string, delim = ",") {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delim && !quoted) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
async function fetchText(url: string) {
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
type FtrHitRow = {
  techId: string; order1Date: string; order2Date: string; daysBetween: number;
  order1Job: string; order2Job: string; order1Code: string; order2Code: string;
  order1TIH?: number; order2TIH?: number;
};
function parseFtrCsv(csv: string): FtrHitRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  const delim = detectDelimiter(lines[0]);
  const headers = splitCsvLineWith(lines[0], delim).map(h => h.trim().toLowerCase().replace(/\s+/g, " "));
  const ci = (fn: (h: string) => boolean) => headers.findIndex(fn);
  const idxTech = ci(h => h.includes("tech"));
  const idxO1Date = ci(h => h.includes("order 1") && h.includes("date"));
  const idxO2Date = ci(h => h.includes("order 2") && h.includes("date"));
  const idxDays = ci(h => h.includes("days") && h.includes("between"));
  const idxO1Job = ci(h => h.includes("order 1") && (h.includes("job") || h.includes("type")));
  const idxO2Job = ci(h => h.includes("order 2") && (h.includes("job") || h.includes("type")));
  const idxO1Code = ci(h => h.includes("order 1") && h.includes("code"));
  const idxO2Code = ci(h => h.includes("order 2") && h.includes("code"));
  const idxO1TIH = ci(h => h.includes("order 1") && h.includes("tih"));
  const idxO2TIH = ci(h => h.includes("order 2") && h.includes("tih"));
  const out: FtrHitRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = splitCsvLineWith(lines[i], delim);
    const get = (idx: number) => (idx >= 0 && idx < cols.length ? cols[idx].trim() : "");
    const row: FtrHitRow = {
      techId: get(idxTech), order1Date: get(idxO1Date), order2Date: get(idxO2Date),
      daysBetween: Number(get(idxDays)) || 0, order1Job: get(idxO1Job), order2Job: get(idxO2Job),
      order1Code: get(idxO1Code), order2Code: get(idxO2Code),
    };
    const o1 = get(idxO1TIH), o2 = get(idxO2TIH);
    if (o1) row.order1TIH = Number(o1) || 0;
    if (o2) row.order2TIH = Number(o2) || 0;
    if (row.techId && row.daysBetween >= 0 && row.daysBetween <= 30) out.push(row);
  }
  return out;
}

export default function FtrHitsPage({ authUser }: { authUser: AuthUser | null }) {
  const [region, setRegion] = useState<"Keystone" | "Beltway" | "Freedom">("Keystone");
  const [hits, setHits] = useState<FtrHitRow[]>([]);
  const [selectedTech, setSelectedTech] = useState(hasRole(authUser, "bp_owner") ? "All Techs" : authUser?.username || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowedTechs, setAllowedTechs] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadScope() {
      if (authUser?.role !== "bp_owner") { setAllowedTechs(null); return; }
      if (!authUser.companyId) { setAllowedTechs([]); return; }
      const result = await supabase.from("payroll_technicians").select("tech_number").eq("company_id", authUser.companyId).eq("active", true);
      if (!cancelled) setAllowedTechs((result.data || []).map((r:any)=>String(r.tech_number||"")).filter(Boolean));
    }
    void loadScope();
    return () => { cancelled = true; };
  }, [authUser?.role, authUser?.companyId]);

  useEffect(() => {
    if (!authUser) return;
    setSelectedTech(hasRole(authUser, "bp_owner") ? "All Techs" : authUser.username);
  }, [authUser]);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const url = FTR_FILES[region];
        if (!url) { setHits([]); setError("No FTR file configured for this region."); setLoading(false); return; }
        setHits(parseFtrCsv(await fetchText(url)));
      } catch (e: any) {
        setError("Could not load FTR hits CSV for " + region); setHits([]);
      } finally { setLoading(false); }
    })();
  }, [region]);

  const techOptions = useMemo(() => Array.from(new Set(hits.map(h => h.techId).filter(Boolean))).sort(), [hits]);

  const filteredHits = useMemo(() => {
    if (!authUser) return [];
    if (authUser.role === "bp_owner") {
      const allowed = new Set(allowedTechs || []);
      return hits.filter(h => allowed.has(h.techId) && (selectedTech === "All Techs" || h.techId === selectedTech));
    }
    if (hasRole(authUser, "supervisor")) return hits.filter(h => selectedTech === "All Techs" || h.techId === selectedTech);
    return hits.filter(h => h.techId === authUser.username);
  }, [hits, selectedTech, authUser, allowedTechs]);

  const totalHits = filteredHits.length;
  const avgDays = totalHits === 0 ? 0 : filteredHits.reduce((s, r) => s + r.daysBetween, 0) / totalHits;
  const avgTih = (() => { const v = filteredHits.map(h => h.order1TIH).filter((x): x is number => x != null && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; })();

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-baseline md:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-50">FTR Hits</h2>
          <p className="text-xs text-slate-400 mt-1">Any follow-up job within 30 days of the original close is counted as an FTR hit. Goal: 0.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-2"><span className="text-slate-300">Region</span>
            <select value={region} onChange={e => setRegion(e.target.value as any)} className="rounded-xl bg-slate-900 border border-white/10 px-3 py-1.5 text-xs">
              <option value="Keystone">Keystone</option><option value="Beltway">Beltway</option><option value="Freedom">Freedom</option>
            </select>
          </label>
          {hasRole(authUser, "bp_owner") && (
            <label className="flex items-center gap-2"><span className="text-slate-300">Tech</span>
              <select value={selectedTech} onChange={e => setSelectedTech(e.target.value)} className="rounded-xl bg-slate-900 border border-white/10 px-3 py-1.5 text-xs">
                <option value="All Techs">All Techs</option>
                {techOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4"><div className="text-slate-300">Total FTR Hits</div><div className="mt-1 text-2xl font-semibold">{totalHits}</div></div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4"><div className="text-slate-300">Avg Days Between Orders</div><div className="mt-1 text-2xl font-semibold">{avgDays.toFixed(1)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4"><div className="text-slate-300">Avg Time In Home (Order 1)</div><div className="mt-1 text-2xl font-semibold">{avgTih.toFixed(1)} <span className="text-sm font-normal text-slate-300">min</span></div></div>
      </div>
      <div className="rounded-2xl border border-white/10 overflow-hidden bg-slate-950/80">
        <div className="bg-white/5 px-4 py-3 text-sm text-slate-200 flex items-center justify-between">
          <div className="font-medium">FTR Hit Detail</div>
          {loading && <div className="text-xs text-slate-400">Loading…</div>}
          {error && <div className="text-xs text-red-300">{error}</div>}
        </div>
        <div className="md:hidden divide-y divide-slate-800">
          {filteredHits.map((h, i) => (
            <article key={i} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-slate-50">Tech #{h.techId || "—"}</div><div className="text-[11px] text-slate-400">{h.order1Date} → {h.order2Date}</div></div><span className="rounded-full bg-red-500/15 border border-red-500/20 px-2.5 py-1 text-xs font-semibold text-red-300">{h.daysBetween} days</span></div>
              <div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-slate-900 p-3"><div className="text-slate-500">Closed As</div><div className="mt-1 text-slate-200">{h.order1Job || "—"}</div></div><div className="rounded-xl bg-slate-900 p-3"><div className="text-slate-500">Fixed As</div><div className="mt-1 text-slate-200">{h.order2Job || "—"}</div></div><div className="rounded-xl bg-slate-900 p-3"><div className="text-slate-500">Order 1 Code</div><div className="mt-1 text-slate-200">{h.order1Code || "—"}</div></div><div className="rounded-xl bg-slate-900 p-3"><div className="text-slate-500">Order 2 Code</div><div className="mt-1 text-slate-200">{h.order2Code || "—"}</div></div></div>
              <div className="flex justify-between rounded-xl bg-slate-900 px-3 py-2 text-xs"><span className="text-slate-400">Time in home</span><span>{h.order1TIH ?? "—"} / {h.order2TIH ?? "—"} min</span></div>
            </article>
          ))}
          {!loading && !error && filteredHits.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-400">No FTR hits found for this selection.</div>}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-900 text-slate-300">
              <tr><th className="px-3 py-2 text-left">Tech</th><th className="px-3 py-2 text-left">Order 1 Date</th><th className="px-3 py-2 text-left">Order 2 Date</th><th className="px-3 py-2 text-left">Days Between</th><th className="px-3 py-2 text-left">Closed As (Order 1)</th><th className="px-3 py-2 text-left">Fixed As (Order 2)</th><th className="px-3 py-2 text-left">Order 1 Code</th><th className="px-3 py-2 text-left">Order 2 Code</th><th className="px-3 py-2 text-right">Order 1 TIH</th><th className="px-3 py-2 text-right">Order 2 TIH</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredHits.map((h, i) => (
                <tr key={i} className="hover:bg-slate-900/70">
                  <td className="px-3 py-2 whitespace-nowrap font-medium text-slate-100">{h.techId || "—"}</td>
                  <td className="px-3 py-2">{h.order1Date}</td><td className="px-3 py-2">{h.order2Date}</td>
                  <td className="px-3 py-2">{h.daysBetween}</td><td className="px-3 py-2">{h.order1Job}</td>
                  <td className="px-3 py-2">{h.order2Job}</td><td className="px-3 py-2">{h.order1Code}</td>
                  <td className="px-3 py-2">{h.order2Code}</td>
                  <td className="px-3 py-2 text-right">{h.order1TIH ?? ""}</td>
                  <td className="px-3 py-2 text-right">{h.order2TIH ?? ""}</td>
                </tr>
              ))}
              {!loading && !error && filteredHits.length === 0 && <tr><td colSpan={10} className="px-4 py-4 text-center text-slate-400">No FTR hits found for this selection.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 text-[11px] text-slate-500 border-t border-slate-800">Treat Every Job Like A New Install!!</div>
      </div>
    </div>
  );
}

