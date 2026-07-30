import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import {
  ONB_SHEET_CSV_URL,
  loadLocalCandidates,
  loadOnbDeleted,
  onbKey,
  parseOnbCsvToRows,
} from "../lib/onboarding";
import type { AuthUser, ViewKey } from "../types/navigation";

type MetricsSummary = {
  jobs: number;
  installs: number;
  ftrNumerator: number;
  ftrDenominator: number;
  tnpsSum: number;
  tnpsCount: number;
  toolUseN: number;
  toolUseD: number;
};

type DashboardProps = {
  authUser: AuthUser;
  onNavigate: (view: ViewKey) => void;
  metricsByRegion?: Record<string, MetricsSummary>;
  metricMonth?: string;
  metricsLoading?: boolean;
};

type PayrollSetup = {
  companies: number | null;
  technicians: number | null;
  rateSheets: number | null;
  unlocked: boolean;
};

type Accent = "blue" | "emerald" | "amber" | "violet" | "cyan";

function pct(numerator: number, denominator: number): string {
  if (!denominator) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function numericPct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.max(0, Math.min(100, (numerator / denominator) * 100));
}

function tnps(summary?: MetricsSummary): string {
  if (!summary?.tnpsCount) return "—";
  return (summary.tnpsSum / summary.tnpsCount).toFixed(1);
}

function monthLabel(value?: string): string {
  if (!value) return "Current period";
  const normalized = /^\d{4}-\d$/.test(value) ? value.replace("-", "-0") : value;
  const date = new Date(`${normalized}-01T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function Dashboard({
  authUser,
  onNavigate,
  metricsByRegion,
  metricMonth,
  metricsLoading = false,
}: DashboardProps) {
  const isSupervisor =
  authUser.role === "supervisor" ||
  authUser.role === "director";
  const isDirector = authUser.role === "director";
  const [dashboardRegion, setDashboardRegion] = useState("All Regions");
  const [applications, setApplications] = useState<number | null>(null);
  const [payrollSetup, setPayrollSetup] = useState<PayrollSetup>({
    companies: null,
    technicians: null,
    rateSheets: null,
    unlocked: false,
  });

  useEffect(() => {
    if (!isSupervisor) return;
    let cancelled = false;

    async function loadApplications() {
      try {
        const localRows = loadLocalCandidates();
        const deleted = new Set(loadOnbDeleted());
        let sheetRows: ReturnType<typeof parseOnbCsvToRows> = [];

        if (ONB_SHEET_CSV_URL) {
          const response = await fetch(`${ONB_SHEET_CSV_URL}&t=${Date.now()}`);
          if (response.ok) sheetRows = parseOnbCsvToRows(await response.text());
        }

        const merged = new Map<string, (typeof localRows)[number]>();
        for (const row of [...sheetRows, ...localRows]) {
          const key = onbKey(row);
          if (key && !deleted.has(key)) merged.set(key, row);
        }

        if (!cancelled) setApplications(merged.size);
      } catch {
        if (!cancelled) setApplications(loadLocalCandidates().length);
      }
    }

    void loadApplications();
    return () => {
      cancelled = true;
    };
  }, [isSupervisor]);

  useEffect(() => {
    if (!isDirector) return;
    let cancelled = false;

    async function loadPayrollSetup() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (!cancelled) {
          setPayrollSetup({ companies: null, technicians: null, rateSheets: null, unlocked: false });
        }
        return;
      }

      const [companiesResult, techResult, sheetResult] = await Promise.all([
        supabase.from("payroll_companies").select("id", { count: "exact", head: true }),
        supabase.from("payroll_technicians").select("id", { count: "exact", head: true }),
        supabase.from("payroll_rate_sheets").select("id", { count: "exact", head: true }),
      ]);

      if (!cancelled) {
        setPayrollSetup({
          companies: companiesResult.count ?? 0,
          technicians: techResult.count ?? 0,
          rateSheets: sheetResult.count ?? 0,
          unlocked: true,
        });
      }
    }

    void loadPayrollSetup();
    return () => {
      cancelled = true;
    };
  }, [isDirector]);

  const metrics = metricsByRegion?.[dashboardRegion] || metricsByRegion?.["All Regions"];
  const ftr = pct(metrics?.ftrNumerator || 0, metrics?.ftrDenominator || 0);
  const ftrProgress = numericPct(metrics?.ftrNumerator || 0, metrics?.ftrDenominator || 0);
  const toolUsage = pct(metrics?.toolUseN || 0, metrics?.toolUseD || 0);
  const toolProgress = numericPct(metrics?.toolUseN || 0, metrics?.toolUseD || 0);
  const tnpsValue = metrics?.tnpsCount ? metrics.tnpsSum / metrics.tnpsCount : null;
  const period = monthLabel(metricMonth);
  const scopeLabel = dashboardRegion === "All Regions" ? "Company wide" : dashboardRegion;

  const quickActions = useMemo(
    () => [
      { label: "Performance", detail: "Monthly technician results", icon: "▦", view: "metrics" as ViewKey, show: true, accent: "blue" as Accent },
      { label: "FTR Hits", detail: "Repeat-order exceptions", icon: "↻", view: "ftrHits" as ViewKey, show: true, accent: "emerald" as Accent },
      { label: "tNPS", detail: "Customer scores and comments", icon: "★", view: "tnps" as ViewKey, show: true, accent: "amber" as Accent },
      { label: "New Application", detail: "Submit an onboarding candidate", icon: "+", view: "onbForm" as ViewKey, show: isSupervisor, accent: "cyan" as Accent },
      { label: "Onboarding", detail: "Review submitted candidates", icon: "◎", view: "onbMgmt" as ViewKey, show: isSupervisor, accent: "violet" as Accent },
      { label: "Payroll", detail: "Upload, review and export", icon: "$", view: "payroll" as ViewKey, show: isDirector, accent: "emerald" as Accent },
      { label: "Technicians", detail: "Profiles, payroll, assets and forms", icon: "◉", view: "techProfiles" as ViewKey, show: isDirector, accent: "blue" as Accent },
      { label: "Forms Center", detail: "Templates and e-sign requests", icon: "✎", view: "formsCenter" as ViewKey, show: isDirector, accent: "violet" as Accent },
      { label: "Assets", detail: "Trucks, meters and assignments", icon: "▣", view: "assets" as ViewKey, show: isDirector, accent: "amber" as Accent },
    ],
    [isDirector, isSupervisor]
  );

  const visibleActions = quickActions.filter(action => action.show);

  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 pb-10 pt-5 sm:px-6 lg:pt-7">
      <section className="relative overflow-hidden rounded-[28px] border border-blue-400/15 bg-gradient-to-br from-blue-600/20 via-slate-900/95 to-slate-950 p-5 shadow-2xl shadow-black/20 sm:p-7">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-blue-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 left-1/4 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-300">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,.9)]" />
              Operations command center
            </div>
            <h1 className="mt-2.5 text-3xl font-bold tracking-tight text-white sm:text-[38px]">
              {greeting()}, {authUser.displayName || authUser.username}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300 sm:text-[15px]">
              {isDirector
                ? "Monitor performance, onboarding, payroll, forms and company assets from one place."
                : isSupervisor
                  ? "Review team performance and keep onboarding moving from one workspace."
                  : "Track your current performance, FTR results and customer feedback."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap xl:justify-end">
            <ContextPill label="Access" value={authUser.role} capitalize />
            <ContextPill label="Period" value={period} />
            <label className="col-span-2 min-w-44 rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-2.5 backdrop-blur sm:col-span-1">
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Scope</div>
              <select
                value={dashboardRegion}
                onChange={event => setDashboardRegion(event.target.value)}
                className="mt-0.5 w-full bg-transparent text-sm font-semibold text-white outline-none"
              >
                <option className="bg-slate-950" value="All Regions">Company wide</option>
                <option className="bg-slate-950" value="Keystone">Keystone</option>
                <option className="bg-slate-950" value="Beltway">Beltway</option>
                <option className="bg-slate-950" value="Freedom">Freedom</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Jobs"
          value={metricsLoading ? "…" : String(metrics?.jobs ?? 0)}
          detail={`${metrics?.installs ?? 0} installs`}
          meta={scopeLabel}
          icon="▤"
          accent="blue"
        />
        <StatCard
          label="FTR"
          value={metricsLoading ? "…" : ftr}
          detail="First-time resolution rate"
          meta={period}
          icon="↻"
          accent="emerald"
          progress={ftrProgress}
        />
        <StatCard
          label="tNPS"
          value={metricsLoading ? "…" : tnps(metrics)}
          detail="Average customer score"
          meta={scopeLabel}
          icon="★"
          accent="amber"
          progress={tnpsValue == null ? null : Math.max(0, Math.min(100, tnpsValue))}
        />
        <StatCard
          label="Tool Usage"
          value={metricsLoading ? "…" : toolUsage}
          detail="Tool compliance rate"
          meta={period}
          icon="◆"
          accent="violet"
          progress={toolProgress}
        />
      </section>

      {isDirector && (
        <section className="mt-4 grid items-start gap-4 xl:grid-cols-[1.45fr_0.85fr]">
          <div className="rounded-[26px] border border-white/10 bg-slate-900/65 p-5 shadow-xl shadow-black/10 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-300">Director overview</div>
                <h2 className="mt-1 text-xl font-semibold text-white">Operations status</h2>
                <p className="mt-1 text-xs text-slate-500">Live counts across your primary management workspaces.</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate("payroll")}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-950/30 transition hover:-translate-y-0.5 hover:bg-blue-500"
              >
                Open Payroll <span aria-hidden="true">→</span>
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatusTile label="Applications" value={applications == null ? "…" : String(applications)} sub="Submitted candidates" icon="◎" accent="cyan" onClick={() => onNavigate("onbMgmt")} />
              <StatusTile label="Payroll" value={payrollSetup.unlocked ? "Ready" : "Locked"} sub={payrollSetup.unlocked ? "Workspace available" : "Open to initialize"} icon="$" accent="emerald" onClick={() => onNavigate("payroll")} />
              <StatusTile label="Technicians" value={payrollSetup.technicians == null ? "—" : String(payrollSetup.technicians)} sub="Active payroll directory" icon="◉" accent="blue" onClick={() => onNavigate("techProfiles")} />
              <StatusTile label="Rate Sheets" value={payrollSetup.rateSheets == null ? "—" : String(payrollSetup.rateSheets)} sub={payrollSetup.companies == null ? "Payroll setup" : `${payrollSetup.companies} companies`} icon="▦" accent="violet" onClick={() => onNavigate("payroll")} />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-white/5 bg-slate-950/35 px-4 py-3 text-[11px] text-slate-400">
              <span><strong className="font-semibold text-slate-200">{scopeLabel}</strong> performance scope</span>
              <span className="hidden h-3 w-px bg-white/10 sm:block" />
              <span><strong className="font-semibold text-slate-200">{period}</strong> reporting period</span>
              <span className="hidden h-3 w-px bg-white/10 sm:block" />
              <span>Data refreshes when source workspaces load</span>
            </div>
          </div>

          <div className="rounded-[26px] border border-white/10 bg-slate-900/65 p-5 shadow-xl shadow-black/10 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Workspace health</div>
                <h2 className="mt-1 text-xl font-semibold text-white">System snapshot</h2>
              </div>
              <span className="rounded-full border border-emerald-400/15 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
                Online
              </span>
            </div>

            <div className="mt-4 space-y-2.5">
              <SnapshotRow label="Performance data" value={`${scopeLabel} • ${period}`} status="Loaded" tone="violet" />
              <SnapshotRow label="Onboarding" value={applications == null ? "Checking candidates" : `${applications} candidates available`} status="Synced" tone="cyan" />
              <SnapshotRow
                label="Payroll directory"
                value={payrollSetup.technicians == null ? "Checking technician records" : `${payrollSetup.technicians} technicians`}
                status={payrollSetup.unlocked ? "Ready" : "Locked"}
                tone={payrollSetup.unlocked ? "emerald" : "amber"}
              />
              <SnapshotRow label="Signed-in access" value={authUser.displayName || authUser.username} status="Verified" tone="blue" />
            </div>
          </div>
        </section>
      )}

      {isSupervisor && !isDirector && (
        <section className="mt-4 grid gap-3 sm:grid-cols-2">
          <StatusTile label="Onboarding applications" value={applications == null ? "…" : String(applications)} sub="Candidates available for review" icon="◎" accent="cyan" onClick={() => onNavigate("onbMgmt")} />
          <StatusTile label="Team performance" value={ftr} sub={`FTR for ${period}`} icon="↻" accent="emerald" onClick={() => onNavigate("metrics")} />
        </section>
      )}

      <section className="mt-6">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Workspaces</div>
            <h2 className="mt-1 text-lg font-semibold text-white">Quick access</h2>
            <p className="mt-0.5 text-xs text-slate-500">Jump directly into the tools available to your role.</p>
          </div>
          <div className="hidden rounded-full border border-white/10 bg-slate-900/60 px-3 py-1.5 text-[11px] text-slate-400 sm:block">
            {visibleActions.length} available
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {visibleActions.map(action => (
            <QuickAction
              key={action.label}
              label={action.label}
              detail={action.detail}
              icon={action.icon}
              accent={action.accent}
              onClick={() => onNavigate(action.view)}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

function ContextPill({ label, value, capitalize = false }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-2.5 backdrop-blur">
      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold text-white ${capitalize ? "capitalize" : ""}`}>{value}</div>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  meta,
  icon,
  accent,
  progress,
}: {
  label: string;
  value: string;
  detail: string;
  meta: string;
  icon: string;
  accent: Accent;
  progress?: number | null;
}) {
  const accents: Record<Accent, { icon: string; bar: string; glow: string }> = {
    blue: { icon: "bg-blue-500/10 text-blue-300", bar: "bg-blue-400", glow: "group-hover:border-blue-400/25" },
    emerald: { icon: "bg-emerald-500/10 text-emerald-300", bar: "bg-emerald-400", glow: "group-hover:border-emerald-400/25" },
    amber: { icon: "bg-amber-500/10 text-amber-300", bar: "bg-amber-400", glow: "group-hover:border-amber-400/25" },
    violet: { icon: "bg-violet-500/10 text-violet-300", bar: "bg-violet-400", glow: "group-hover:border-violet-400/25" },
    cyan: { icon: "bg-cyan-500/10 text-cyan-300", bar: "bg-cyan-400", glow: "group-hover:border-cyan-400/25" },
  };
  const style = accents[accent];

  return (
    <div className={`group rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/10 transition ${style.glow}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-slate-400">{label}</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-white">{value}</div>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm ${style.icon}`}>{icon}</span>
      </div>
      {progress != null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-950/80">
          <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 text-[11px]">
        <span className="truncate text-slate-400">{detail}</span>
        <span className="shrink-0 text-slate-600">{meta}</span>
      </div>
    </div>
  );
}

function StatusTile({
  label,
  value,
  sub,
  icon,
  accent,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  icon: string;
  accent: Accent;
  onClick?: () => void;
}) {
  const accentClasses: Record<Accent, string> = {
    blue: "bg-blue-500/10 text-blue-300",
    emerald: "bg-emerald-500/10 text-emerald-300",
    amber: "bg-amber-500/10 text-amber-300",
    violet: "bg-violet-500/10 text-violet-300",
    cyan: "bg-cyan-500/10 text-cyan-300",
  };

  const classes = "group rounded-2xl border border-white/10 bg-slate-950/45 p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-400/25 hover:bg-slate-950/70";
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-[11px] ${accentClasses[accent]}`}>{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>{sub}</span>
        {onClick && <span className="opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100">→</span>}
      </div>
    </>
  );

  if (onClick) {
    return <button type="button" onClick={onClick} className={classes}>{content}</button>;
  }
  return <div className={classes}>{content}</div>;
}

function SnapshotRow({
  label,
  value,
  status,
  tone,
}: {
  label: string;
  value: string;
  status: string;
  tone: "blue" | "emerald" | "amber" | "violet" | "cyan";
}) {
  const tones = {
    blue: "bg-blue-500/10 text-blue-300 border-blue-400/10",
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-400/10",
    amber: "bg-amber-500/10 text-amber-300 border-amber-400/10",
    violet: "bg-violet-500/10 text-violet-300 border-violet-400/10",
    cyan: "bg-cyan-500/10 text-cyan-300 border-cyan-400/10",
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-950/35 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-white">{label}</div>
        <div className="mt-0.5 truncate text-[11px] text-slate-500">{value}</div>
      </div>
      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider ${tones[tone]}`}>{status}</span>
    </div>
  );
}

function QuickAction({
  label,
  detail,
  icon,
  accent,
  onClick,
}: {
  label: string;
  detail: string;
  icon: string;
  accent: Accent;
  onClick: () => void;
}) {
  const accents: Record<Accent, string> = {
    blue: "bg-blue-500/10 text-blue-300 group-hover:bg-blue-500/20",
    emerald: "bg-emerald-500/10 text-emerald-300 group-hover:bg-emerald-500/20",
    amber: "bg-amber-500/10 text-amber-300 group-hover:bg-amber-500/20",
    violet: "bg-violet-500/10 text-violet-300 group-hover:bg-violet-500/20",
    cyan: "bg-cyan-500/10 text-cyan-300 group-hover:bg-cyan-500/20",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-24 items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/65 p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-400/25 hover:bg-slate-900"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base transition ${accents[accent]}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="mt-1 block truncate text-[11px] text-slate-500">{detail}</span>
      </span>
      <span className="shrink-0 text-slate-700 transition group-hover:translate-x-0.5 group-hover:text-blue-300">→</span>
    </button>
  );
}
