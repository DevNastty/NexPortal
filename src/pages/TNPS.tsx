import React from "react";
import { supabase } from "../supabase";
import type { AuthUser } from "../types/navigation";

type TNPSRow = {
  region: string;
  date?: string;
  tech_num?: string;
  score?: number;
  comment?: string;
};

const TNPS_REGIONS = ["Keystone", "Beltway", "Freedom"];

async function tnps_fetchRegion(region: string): Promise<TNPSRow[]> {
  const result = await supabase
    .from("portal_tnps_rows")
    .select("region,response_date,tech_num,score,comment")
    .eq("region", region)
    .order("response_date", { ascending: false });
  if (result.error) throw result.error;
  return (result.data || []).map((row: any) => ({
    region: String(row.region || region),
    date: row.response_date || undefined,
    tech_num: row.tech_num || undefined,
    score: row.score == null ? undefined : Number(row.score),
    comment: row.comment || undefined,
  }));
}

function tnps_class(score?: number): "Promoter" | "Passive" | "Detractor" | "Unknown" {
  if (score == null || Number.isNaN(score)) return "Unknown";
  if (score >= 9) return "Promoter";
  if (score >= 7) return "Passive";
  return "Detractor";
}

function tnps_nps(rows: TNPSRow[]): number {
  let p = 0, d = 0, t = 0;
  for (const r of rows) {
    const c = tnps_class(r.score);
    if (c === "Promoter") p++; else if (c === "Detractor") d++;
    if (c !== "Unknown") t++;
  }
  return t ? Math.round(((p - d) / t) * 100) : 0;
}


function StatCard({ title, subtitle, value }: { title: string; subtitle: string; value: string | number }) {
  return <div className="rounded-2xl border border-[#1f2937] bg-[#111827] p-4 text-white"><div className="text-sm text-gray-300">{title}</div><div className="mt-1 text-3xl font-extrabold">{value}</div><div className="mt-1 text-xs text-gray-400">{subtitle}</div></div>;
}
export default function TNPSDashboard({ authUser }: { authUser: AuthUser }) {
  const regions = TNPS_REGIONS;
  const [activeRegion, setActiveRegion] = React.useState(regions[0] || "Keystone");
  const [rows, setRows] = React.useState<TNPSRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [techs, setTechs] = React.useState<string[]>([]);
  const [tech, setTech] = React.useState("All Techs");
  const [search, setSearch] = React.useState("");
  const [allowedTechs, setAllowedTechs] = React.useState<string[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function loadScope() {
      if (authUser.role !== "bp_owner") { setAllowedTechs(null); return; }
      if (!authUser.companyId) { setAllowedTechs([]); return; }
      const result = await supabase.from("payroll_technicians").select("tech_number").eq("company_id", authUser.companyId).eq("active", true);
      if (!cancelled) setAllowedTechs((result.data || []).map((r:any)=>String(r.tech_number||"")).filter(Boolean));
    }
    void loadScope();
    return () => { cancelled = true; };
  }, [authUser.role, authUser.companyId]);

  async function reload(region = activeRegion) {
    setLoading(true);
    try {
      const data = await tnps_fetchRegion(region);
      setRows(data);
      setTechs(Array.from(new Set(data.map(r => (r.tech_num || "").trim()).filter(Boolean))).sort());
    } catch (error) {
      console.error("Unable to load tNPS rows from Supabase", error);
      setRows([]);
      setTechs([]);
    } finally {
      setLoading(false);
    }
  }
  React.useEffect(() => { reload(); }, [activeRegion]);

  const filtered = React.useMemo(() => {
    let out = rows.slice();
    if (authUser.role === "bp_owner") { const allowed = new Set(allowedTechs || []); out = out.filter(r => allowed.has(String(r.tech_num || ""))); }
    if (tech !== "All Techs") out = out.filter(r => (r.tech_num || "") === tech);
    if (search.trim()) {
      const needle = search.toLowerCase();
      out = out.filter(r => (r.comment || "").toLowerCase().includes(needle) || (r.tech_num || "").toLowerCase().includes(needle));
    }
    return out;
  }, [rows, tech, search, authUser.role, allowedTechs]);

  const nps = tnps_nps(filtered);
  const promoters = filtered.filter(r => tnps_class(r.score) === "Promoter").length;
  const passives = filtered.filter(r => tnps_class(r.score) === "Passive").length;
  const detractors = filtered.filter(r => tnps_class(r.score) === "Detractor").length;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-5 sm:py-6 space-y-4 text-white">
      <div>
        <h2 className="text-2xl font-semibold text-slate-50">tNPS Feedback</h2>
        <p className="mt-1 text-xs text-slate-400">Review customer scores and comments by region and technician.</p>
      </div>

      <div className="overflow-x-auto pb-1 -mx-1 px-1">
        <div className="inline-flex min-w-max rounded-2xl border border-white/10 bg-slate-900/70 p-1">
          {regions.map(r => (
            <button key={r} onClick={() => { setActiveRegion(r); setTech("All Techs"); }} className={`rounded-xl px-4 py-2 text-sm transition ${activeRegion === r ? "bg-blue-600 text-white shadow" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}>{r}</button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3">
          <label className="space-y-1">
            <span className="text-[11px] text-slate-400">Tech #</span>
            <select value={tech} onChange={e => setTech(e.target.value)} className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2.5 text-sm">
              <option>All Techs</option>
              {techs.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-slate-400">Search</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search comments or tech number…" className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2.5 text-sm" />
          </label>
        </div>
        {loading && <div className="mt-3 text-xs text-slate-400">Loading feedback…</div>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard title="Responses" subtitle={activeRegion} value={filtered.length} />
        <StatCard title="Promoters" subtitle="scores 9–10" value={promoters} />
        <StatCard title="Passives" subtitle="scores 7–8" value={passives} />
        <StatCard title="Detractors" subtitle="scores 0–6" value={detractors} />
        <div className="col-span-2 lg:col-span-1"><StatCard title="tNPS" subtitle="net promoter score" value={nps} /></div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/70 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-slate-300">
          <div className="font-medium text-slate-100">Customer Feedback</div>
          <div className="text-xs text-right">{activeRegion} • {tech}</div>
        </div>

        <div className="sm:hidden divide-y divide-white/5">
          {filtered.map((r, i) => {
            const cls = tnps_class(r.score);
            const badge = cls === "Promoter" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/20" : cls === "Detractor" ? "bg-red-500/15 text-red-300 border-red-500/20" : "bg-amber-500/15 text-amber-300 border-amber-500/20";
            return (
              <article key={i} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">Tech #{r.tech_num || "—"}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{r.date ? new Date(r.date).toLocaleDateString() : "No date"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold">{r.score ?? "—"}</span>
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${badge}`}>{cls}</span>
                  </div>
                </div>
                <div className="rounded-xl bg-slate-950/70 border border-white/5 p-3 text-sm leading-relaxed text-slate-200 whitespace-pre-wrap break-words">{r.comment || "No comment provided."}</div>
              </article>
            );
          })}
          {!loading && filtered.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-500">No feedback found for this selection.</div>}
        </div>

        <div className="hidden sm:block overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-950/50 text-slate-300"><tr>{["Date", "Tech #", "Score", "Class", "Comment"].map(h => <th key={h} className="px-4 py-3 font-normal whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map((r, i) => {
                const cls = tnps_class(r.score);
                const color = cls === "Promoter" ? "text-emerald-400" : cls === "Detractor" ? "text-red-400" : "text-amber-300";
                return <tr key={i} className="hover:bg-white/[0.03]"><td className="px-4 py-3 whitespace-nowrap">{r.date ? new Date(r.date).toLocaleDateString() : ""}</td><td className="px-4 py-3 font-semibold">{r.tech_num || "—"}</td><td className="px-4 py-3">{r.score ?? ""}</td><td className={`px-4 py-3 font-bold ${color}`}>{cls}</td><td className="px-4 py-3 max-w-[640px] whitespace-pre-wrap break-words">{r.comment}</td></tr>;
              })}
              {!loading && filtered.length === 0 && <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={5}>No feedback found for this selection.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

