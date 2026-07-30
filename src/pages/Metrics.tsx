import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import type { AuthUser } from "../types/navigation";

type PortalMetricRow = {
  month_key: string;
  date: string | null;
  region: string | null;
  tech: string | null;
  tech_num: string | null;
  jobs: number | null;
  installs: number | null;
  ftr_n: number | null;
  ftr_d: number | null;
  tnps_sum: number | null;
  tnps_cnt: number | null;
  tool_use_n: number | null;
  tool_use_d: number | null;
  cb48_n: number | null;
  cb48_d: number | null;
  is_totals: boolean | null;
  uploaded_at?: string | null;
};

type MetricRow = {
  monthKey: string;
  date: string;
  region: string;
  tech: string;
  techNum: string;
  jobs: number;
  installs: number;
  ftrNumerator: number;
  ftrDenominator: number;
  tnpsSum: number;
  tnpsCount: number;
  toolUseN: number;
  toolUseD: number;
  cb48N: number;
  cb48D: number;
  isTotals: boolean;
};

type MetricSummary = Omit<MetricRow, "monthKey" | "date" | "region" | "tech" | "techNum" | "isTotals">;

const REGIONS = ["All Regions", "Keystone", "Beltway", "Freedom"];

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapDatabaseRow(row: PortalMetricRow): MetricRow {
  return {
    monthKey: String(row.month_key || ""),
    date: String(row.date || `${row.month_key}-01`),
    region: String(row.region || ""),
    tech: String(row.tech || ""),
    techNum: String(row.tech_num || ""),
    jobs: numberValue(row.jobs),
    installs: numberValue(row.installs),
    ftrNumerator: numberValue(row.ftr_n),
    ftrDenominator: numberValue(row.ftr_d),
    tnpsSum: numberValue(row.tnps_sum),
    tnpsCount: numberValue(row.tnps_cnt),
    toolUseN: numberValue(row.tool_use_n),
    toolUseD: numberValue(row.tool_use_d),
    cb48N: numberValue(row.cb48_n),
    cb48D: numberValue(row.cb48_d),
    isTotals: Boolean(row.is_totals),
  };
}

function summarize(rows: MetricRow[]): MetricSummary {
  return rows.reduce<MetricSummary>((total, row) => ({
    jobs: total.jobs + row.jobs,
    installs: total.installs + row.installs,
    ftrNumerator: total.ftrNumerator + row.ftrNumerator,
    ftrDenominator: total.ftrDenominator + row.ftrDenominator,
    tnpsSum: total.tnpsSum + row.tnpsSum,
    tnpsCount: total.tnpsCount + row.tnpsCount,
    toolUseN: total.toolUseN + row.toolUseN,
    toolUseD: total.toolUseD + row.toolUseD,
    cb48N: total.cb48N + row.cb48N,
    cb48D: total.cb48D + row.cb48D,
  }), { jobs: 0, installs: 0, ftrNumerator: 0, ftrDenominator: 0, tnpsSum: 0, tnpsCount: 0, toolUseN: 0, toolUseD: 0, cb48N: 0, cb48D: 0 });
}

function rollupByDate(rows: MetricRow[]) {
  return Array.from(new Set(rows.map(row => row.date))).sort().map(date => ({
    date,
    ...summarize(rows.filter(row => row.date === date)),
  }));
}

function rollupByTech(rows: MetricRow[]) {
  return Array.from(new Set(rows.map(row => row.techNum || row.tech))).filter(Boolean).map(key => {
    const part = rows.filter(row => (row.techNum || row.tech) === key);
    return { tech: part[0]?.tech || "", techNum: part[0]?.techNum || "", region: part[0]?.region || "", ...summarize(part) };
  }).sort((a, b) => a.techNum.localeCompare(b.techNum));
}

function denseRank(values: number[]) {
  const unique = Array.from(new Set(values.filter(Number.isFinite))).sort((a, b) => b - a);
  const ranks = new Map(unique.map((value, index) => [value, index + 1]));
  return values.map(value => ranks.get(value) ?? unique.length + 1);
}

function buildStackRankings(rows: MetricRow[]) {
  const techRows = rollupByTech(rows);
  const toolValues = techRows.map(row => ratioPct(row.toolUseN, row.toolUseD));
  const tnpsValues = techRows.map(row => avg(row.tnpsSum, row.tnpsCount));
  const ftrValues = techRows.map(row => ratioPct(row.ftrNumerator, row.ftrDenominator));
  const toolRanks = denseRank(toolValues);
  const tnpsRanks = denseRank(tnpsValues);
  const ftrRanks = denseRank(ftrValues);
  const scored = techRows.map((row, index) => ({
    rank: 0,
    weightedScore: Number((toolRanks[index] * 0.30 + tnpsRanks[index] * 0.35 + ftrRanks[index] * 0.35).toFixed(2)),
    techNum: row.techNum,
    tech: row.tech,
    region: row.region,
    jobs: row.jobs,
    installs: row.installs,
    toolUsage: toolValues[index],
    toolRank: toolRanks[index],
    tnps: tnpsValues[index],
    tnpsRank: tnpsRanks[index],
    ftr: ftrValues[index],
    ftrRank: ftrRanks[index],
  }));
  scored.sort((a, b) => a.weightedScore - b.weightedScore || b.ftr - a.ftr || b.tnps - a.tnps || b.toolUsage - a.toolUsage || a.techNum.localeCompare(b.techNum));
  let lastScore: number | null = null;
  let rank = 0;
  scored.forEach((row, index) => {
    if (lastScore === null || row.weightedScore !== lastScore) rank = index + 1;
    row.rank = rank;
    lastScore = row.weightedScore;
  });
  return scored;
}


function prettyMonth(key: string) {
  const match = String(key || "").trim().match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) return "Reporting month unavailable";
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

function ratioPct(n: number, d: number) {
  const value = pct(n, d);
  return Number.isNaN(value) ? 0 : value;
}

function avg(sum: number, count: number) {
  if (!count) return 0;
  return Math.round((sum / count) * 10) / 10;
}

function formatValue(value: unknown): string | number {
  return typeof value === "number"
    ? Number.isInteger(value)
      ? value
      : value.toFixed(1)
    : String(value ?? "");
}

function spark(values: number[]) {
  const clean = values.filter(value => Number.isFinite(value));
  if (!clean.length) return "";
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const chars = "▁▂▃▄▅▆▇█";
  return clean
    .map(value => {
      if (max === min) return chars[3];
      const index = Math.round(((value - min) / (max - min)) * (chars.length - 1));
      return chars[Math.max(0, Math.min(chars.length - 1, index))];
    })
    .join("");
}

function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs text-slate-300 sm:flex-none">
      <span className="pl-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="min-w-44 rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-blue-400"
      >
        {children}
      </select>
    </label>
  );
}

function MetricCard({
  title,
  value,
  sub,
  trend,
  icon,
  suffix,
}: {
  title: string;
  value: unknown;
  sub?: string;
  trend?: string;
  icon?: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-slate-400">{title}</div>
          <div className="mt-1 text-2xl font-bold text-white">
            {String(value)}{suffix || ""}
          </div>
        </div>
        <div className="text-xl">{icon}</div>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">{sub}</div>
      {trend && <div className="mt-3 overflow-hidden text-sm tracking-[0.18em] text-blue-300">{trend}</div>}
    </div>
  );
}

function MiniStat({ label, value, rank }: { label: string; value: unknown; rank: number }) {
  return (
    <div className="rounded-xl border border-white/5 bg-slate-900/70 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{String(value)}</div>
      <div className="text-[10px] text-slate-500">Rank #{rank}</div>
    </div>
  );
}

export default function MetricsPage({ authUser }: { authUser: AuthUser }) {
  const [region, setRegion] = useState("Keystone");
  const [selectedTechNum, setSelectedTechNum] = useState("All Techs");
  const [monthFilter, setMonthFilter] = useState("");
  const [months, setMonths] = useState<string[]>([]);
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metricsUpdatedAt, setMetricsUpdatedAt] = useState<string | null>(null);
  const [allowedTechNumbers, setAllowedTechNumbers] = useState<string[] | null>(null);


  useEffect(() => {
    let cancelled = false;
    async function loadScope() {
      if (authUser.role !== "bp_owner") { setAllowedTechNumbers(null); return; }
      if (!authUser.companyId) { setAllowedTechNumbers([]); setError("This BP Owner account is not assigned to a company."); return; }
      const result = await supabase.from("payroll_technicians").select("tech_number").eq("company_id", authUser.companyId).eq("active", true);
      if (cancelled) return;
      if (result.error) { setAllowedTechNumbers([]); setError(result.error.message); return; }
      setAllowedTechNumbers((result.data || []).map((row: any) => String(row.tech_number || "")).filter(Boolean));
    }
    void loadScope();
    return () => { cancelled = true; };
  }, [authUser.role, authUser.companyId]);

  useEffect(() => {
    let cancelled = false;

    async function loadMonths() {
      setError("");

      // Read reporting months from the import log instead of downloading one
      // duplicate month_key for every metric row. This keeps the request small
      // and prevents Supabase gateway 502 responses on larger datasets.
      const importsResult = await supabase
        .from("portal_data_imports")
        .select("month_key,completed_at")
        .eq("data_type", "metrics")
        .eq("status", "completed")
        .not("month_key", "is", null)
        .order("month_key", { ascending: false })
        .limit(250);

      if (cancelled) return;

      let monthValues: string[] = [];

      if (!importsResult.error) {
        monthValues = (importsResult.data || [])
          .map(row => String(row.month_key || "").trim())
          .filter(Boolean);
      }

      // Also fall back when RLS returns an empty import-log result without an
      // error. This is what caused technician accounts to show an empty month
      // dropdown and "Invalid Date" even though metric rows existed.
      if (importsResult.error || monthValues.length === 0) {
        const fallbackResult = await supabase
          .from("portal_metric_rows")
          .select("month_key")
          .not("month_key", "is", null)
          .order("month_key", { ascending: false })
          .limit(1000);

        if (cancelled) return;

        if (fallbackResult.error) {
          setError(importsResult.error?.message || fallbackResult.error.message);
          setMonths([]);
          setLoading(false);
          return;
        }

        monthValues = (fallbackResult.data || [])
          .map(row => String(row.month_key || "").trim())
          .filter(Boolean);
      }

      const uniqueMonths = Array.from(new Set(monthValues)).sort().reverse();
      setMonths(uniqueMonths);
      setMonthFilter(current =>
        current && uniqueMonths.includes(current)
          ? current
          : uniqueMonths[0] || "",
      );

      if (!uniqueMonths.length) setLoading(false);
    }

    void loadMonths();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadRows() {
      if (!monthFilter) return;
      setLoading(true);
      setError("");
      let query = supabase.from("portal_metric_rows").select("month_key,date,region,tech,tech_num,jobs,installs,ftr_n,ftr_d,tnps_sum,tnps_cnt,tool_use_n,tool_use_d,cb48_n,cb48_d,is_totals,uploaded_at").eq("month_key", monthFilter);
      if (region !== "All Regions") query = query.eq("region", region);
      if (authUser.role === "tech" && authUser.techNumber) query = query.eq("tech_num", authUser.techNumber);
      const result = await query.order("date", { ascending: true }).order("tech_num", { ascending: true });
      if (cancelled) return;
      if (result.error) {
        setRows([]);
        setMetricsUpdatedAt(null);
        setError(result.error.message);
      } else {
        let data = (result.data || []) as PortalMetricRow[];
        if (authUser.role === "bp_owner") {
          const allowed = new Set(allowedTechNumbers || []);
          data = data.filter(row => !row.is_totals && allowed.has(String(row.tech_num || "")));
        }
        if (authUser.role === "tech" && authUser.techNumber) {
          data = data.filter(row => !row.is_totals && String(row.tech_num || "") === String(authUser.techNumber));
          const techRegion = String(data[0]?.region || "").trim();
          if (techRegion && techRegion !== region) setRegion(techRegion);
        }
        setRows(data.map(mapDatabaseRow));
        setMetricsUpdatedAt(data.reduce<string | null>((latest, row) => {
          const value = row.uploaded_at || null;
          return value && (!latest || value > latest) ? value : latest;
        }, null));
      }
      setLoading(false);
    }
    void loadRows();
    return () => { cancelled = true; };
  }, [monthFilter, region, authUser.role, authUser.techNumber, allowedTechNumbers]);

  useEffect(() => {
    setSelectedTechNum("All Techs");
  }, [region, monthFilter]);

  const detailRows = useMemo(() => rows.filter(row => !row.isTotals), [rows]);
  const totalRows = useMemo(() => rows.filter(row => row.isTotals), [rows]);
  const numsForRegion = useMemo(() => Array.from(new Set(detailRows.map(row => row.techNum).filter(Boolean))), [detailRows]);
  const selectedRows = useMemo(() => selectedTechNum === "All Techs" ? detailRows : detailRows.filter(row => row.techNum === selectedTechNum), [detailRows, selectedTechNum]);
  const selectedTotalRows = useMemo(() => selectedTechNum === "All Techs" ? totalRows : [], [selectedTechNum, totalRows]);
  const totals = useMemo(() => summarize(selectedTotalRows.length ? selectedTotalRows : selectedRows), [selectedRows, selectedTotalRows]);
  const daily = useMemo(() => rollupByDate(selectedRows), [selectedRows]);
  const byTech = useMemo(() => rollupByTech(detailRows), [detailRows]);
  const stackRankings = useMemo(() => buildStackRankings(detailRows), [detailRows]);

  return (
    <>
      {loading && (
        <div className="fixed right-4 top-20 z-50 flex items-center gap-2 rounded-xl border border-blue-400/20 bg-slate-900/95 px-3 py-2 text-xs text-slate-200 shadow-xl backdrop-blur">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          Loading metrics…
        </div>
      )}

      {error && <div className="mx-auto mt-4 max-w-7xl rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">Unable to load metrics: {error}</div>}

      <section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
              {region === "All Regions" ? "Stack Ranking" : `${region} Performance`}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {region === "All Regions"
                ? "Company-wide technician rankings."
                : `Month-to-date results for ${prettyMonth(monthFilter)}.`}
            </p>
          </div>
          <div className="text-xs text-slate-500">
            {metricsUpdatedAt
              ? `Last updated ${new Date(metricsUpdatedAt).toLocaleString()}`
              : "Last updated time unavailable"}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
        <div className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="inline-flex min-w-max gap-1 rounded-2xl border border-white/10 bg-slate-900/70 p-1 shadow-lg shadow-black/10">
            {["All Regions", "Keystone", "Beltway", "Freedom"].map(item => (
              <button
                key={item}
                onClick={() => setRegion(item)}
                className={`${
                  region === item
                    ? "bg-blue-600 text-white shadow-md shadow-blue-950/40"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                } rounded-xl px-4 py-2 text-sm font-medium transition`}
              >
                {item === "All Regions" ? "Stack Ranking" : item}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
        <div className="rounded-2xl border border-white/10 bg-slate-900/65 p-3 shadow-xl shadow-black/10 backdrop-blur sm:p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              {region !== "All Regions" && (
                <Select value={selectedTechNum} onChange={setSelectedTechNum} label="Technician">
                  <option value="All Techs">All Techs</option>
                  {numsForRegion
                    .map(String)
                    .sort((a, b) => a.localeCompare(b))
                    .map(number => (
                      <option key={number} value={number}>#{number}</option>
                    ))}
                </Select>
              )}
              <Select value={monthFilter} onChange={setMonthFilter} label="Reporting Month">
                {months.map(month => (
                  <option key={month} value={month}>{prettyMonth(month)}</option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      </section>

      {region === "All Regions" ? (
        <section className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 shadow-2xl shadow-black/15">
            <div className="flex flex-col gap-1 bg-white/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium text-slate-100">Company Stack Rankings</div>
                <div className="text-xs text-slate-400">Tool Usage 30% • tNPS 35% • FTR 35% • Lower score is better</div>
              </div>
              <div className="text-xs text-slate-400">All Regions • {prettyMonth(monthFilter)}</div>
            </div>
            <div className="hidden max-h-[70vh] overflow-x-auto md:block">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-900 text-slate-300 backdrop-blur">
                  <tr>
                    {["Rank", "Tech #", "Region", "Weighted Score", "Jobs", "Installs", "Tool Rank", "Tool Usage %", "tNPS Rank", "tNPS", "FTR Rank", "FTR %"].map(header => (
                      <th key={header} className="whitespace-nowrap px-3 py-2 text-left font-normal">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stackRankings.map(row => (
                    <tr key={`${row.region}-${row.techNum}`} className="border-t border-white/5 hover:bg-white/[0.03]">
                      <td className="whitespace-nowrap px-3 py-2 font-semibold">{row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : `#${row.rank}`}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{row.techNum || "-"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">{row.region || "-"}</td>
                      <td className="px-3 py-2 font-semibold">{row.weightedScore.toFixed(2)}</td>
                      <td className="px-3 py-2">{row.jobs}</td><td className="px-3 py-2">{row.installs}</td>
                      <td className="px-3 py-2">{row.toolRank}</td><td className="px-3 py-2">{formatValue(row.toolUsage)}</td>
                      <td className="px-3 py-2">{row.tnpsRank}</td><td className="px-3 py-2">{formatValue(row.tnps)}</td>
                      <td className="px-3 py-2">{row.ftrRank}</td><td className="px-3 py-2">{formatValue(row.ftr)}</td>
                    </tr>
                  ))}
                  {!stackRankings.length && <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-400">No ranking data found for this month.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 p-3 md:hidden">
              {stackRankings.map(row => (
                <div key={`mobile-${row.region}-${row.techNum}`} className={`${row.rank <= 3 ? "border-blue-400/25 bg-gradient-to-br from-blue-500/10 to-slate-950/70" : "border-white/10 bg-slate-950/55"} rounded-2xl border p-4`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`${row.rank === 1 ? "bg-amber-400/15 text-amber-300" : row.rank === 2 ? "bg-slate-300/10 text-slate-200" : row.rank === 3 ? "bg-orange-400/10 text-orange-300" : "bg-white/5 text-slate-300"} flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold`}>
                        {row.rank <= 3 ? (row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : "🥉") : `#${row.rank}`}
                      </div>
                      <div><div className="text-base font-semibold text-white">Tech #{row.techNum || "-"}</div><div className="text-xs text-slate-400">{row.region || "-"}</div></div>
                    </div>
                    <div className="text-right"><div className="text-[10px] uppercase tracking-wider text-slate-500">Score</div><div className="text-lg font-bold text-blue-300">{row.weightedScore.toFixed(2)}</div></div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <MiniStat label="FTR" value={`${formatValue(row.ftr)}%`} rank={row.ftrRank} />
                    <MiniStat label="tNPS" value={formatValue(row.tnps)} rank={row.tnpsRank} />
                    <MiniStat label="Tools" value={`${formatValue(row.toolUsage)}%`} rank={row.toolRank} />
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3 text-xs text-slate-400"><span>{row.jobs} jobs</span><span>{row.installs} installs</span></div>
                </div>
              ))}
              {!stackRankings.length && <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">No ranking data found for this month.</div>}
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="mx-auto grid max-w-7xl grid-cols-2 gap-3 px-4 py-5 sm:gap-4 sm:px-6 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard icon="🧰" title="Jobs" value={totals.jobs} sub={`MTD • ${prettyMonth(monthFilter)}`} trend={spark(daily.map(item => item.jobs))} />
            <MetricCard icon="🏠" title="Installs" value={totals.installs} sub="Completed installs" trend={spark(daily.map(item => item.installs))} />
            <MetricCard icon="✅" title="FTR" suffix="%" value={ratioPct(totals.ftrNumerator, totals.ftrDenominator)} sub="First-time right" trend={spark(daily.map(item => ratioPct(item.ftrNumerator, item.ftrDenominator)))} />
            <MetricCard icon="⭐" title="tNPS" value={avg(totals.tnpsSum, totals.tnpsCount)} sub="Customer score" trend={spark(daily.map(item => avg(item.tnpsSum, item.tnpsCount)))} />
            <MetricCard icon="🔧" title="Tool Usage" suffix="%" value={ratioPct(totals.toolUseN, totals.toolUseD)} sub="Usage rate" trend={spark(daily.map(item => ratioPct(item.toolUseN, item.toolUseD)))} />
            <MetricCard icon="↩️" title="48 Hr Callback" suffix="%" value={ratioPct(totals.cb48N, totals.cb48D)} sub="Callback rate" trend={spark(daily.map(item => ratioPct(item.cb48N, item.cb48D)))} />
          </section>
          <section className="mx-auto max-w-7xl px-4 pb-10 sm:px-6">
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <div className="flex items-center justify-between bg-white/5 px-4 py-3 text-sm text-slate-300">
                <div className="font-medium">{selectedTechNum === "All Techs" ? "Tech Metrics (MTD)" : "Daily Breakdown (MTD)"}</div>
                <div className="text-xs">{region} • {selectedTechNum} • {prettyMonth(monthFilter)}</div>
              </div>
              <div className="overflow-x-auto">
                {selectedTechNum === "All Techs" ? (
                  <table className="min-w-full text-sm">
                    <thead className="bg-white/5 text-slate-300"><tr>{["Tech #", "Jobs", "Installs", "FTR %", "tNPS", "Tool Usage %", "48 Hour Call back %"].map(header => <th key={header} className="whitespace-nowrap px-3 py-2 text-left font-normal">{header}</th>)}</tr></thead>
                    <tbody>{byTech.map(item => <tr key={item.techNum || item.tech} className="border-t border-white/5"><td className="whitespace-nowrap px-3 py-2">{item.techNum || "-"}</td><td className="px-3 py-2">{item.jobs}</td><td className="px-3 py-2">{item.installs}</td><td className="px-3 py-2">{ratioPct(item.ftrNumerator, item.ftrDenominator)}</td><td className="px-3 py-2">{avg(item.tnpsSum, item.tnpsCount)}</td><td className="px-3 py-2">{ratioPct(item.toolUseN, item.toolUseD)}</td><td className="px-3 py-2">{ratioPct(item.cb48N, item.cb48D)}</td></tr>)}</tbody>
                  </table>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead className="bg-white/5 text-slate-300"><tr>{["Date", "Jobs", "Installs", "FTR %", "tNPS", "Tool Usage %", "48 Hour Call back %"].map(header => <th key={header} className="whitespace-nowrap px-3 py-2 text-left font-normal">{header}</th>)}</tr></thead>
                    <tbody>{daily.map(item => <tr key={item.date} className="border-t border-white/5"><td className="whitespace-nowrap px-3 py-2 text-slate-300">{item.date}</td><td className="px-3 py-2">{item.jobs}</td><td className="px-3 py-2">{item.installs}</td><td className="px-3 py-2">{ratioPct(item.ftrNumerator, item.ftrDenominator)}</td><td className="px-3 py-2">{avg(item.tnpsSum, item.tnpsCount)}</td><td className="px-3 py-2">{ratioPct(item.toolUseN, item.toolUseD)}</td><td className="px-3 py-2">{ratioPct(item.cb48N, item.cb48D)}</td></tr>)}</tbody>
                  </table>
                )}
              </div>
            </div>
          </section>
        </>
      )}
      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-8 text-xs text-slate-400">
          <div>© {new Date().getFullYear()} BPS — Tech Portal</div>
        </div>
      </footer>
    </>
  );
}
