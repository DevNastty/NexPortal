import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../supabase";
import Companies from "./Companies";
import InvoiceUpload from "./InvoiceUpload";
import PayrollHistory from "./PayrollHistory";
import type { PayrollRunRegion } from "../../lib/payroll/payrollRuns";
import Dashboard from "./Dashboard";
import RateSheets from "./RateSheets";
import Technicians from "./Technicians";
import Regions from "./Regions";
import type {
  PayrollCompany,
  PayrollPayee,
  PayrollRateSheet,
  PayrollRegionRecord,
  PayrollSection,
  PayrollTechnician,
  PortalUser,
} from "../../types/payroll";

type PayrollProps = {
  portalUser: PortalUser;
};

const NAVIGATION: { key: PayrollSection; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "▦" },
  { key: "companies", label: "Companies", icon: "▤" },
  { key: "technicians", label: "Technicians", icon: "◎" },
  { key: "regions", label: "Regions", icon: "⌖" },
  { key: "rateSheets", label: "Pay Sheets", icon: "$" },
  { key: "invoiceUpload", label: "Invoice Upload", icon: "↑" },
  { key: "history", label: "History", icon: "◷" },
];

export default function Payroll({ portalUser }: PayrollProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [section, setSection] = useState<PayrollSection>("dashboard");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [companies, setCompanies] = useState<PayrollCompany[]>([]);
  const [payees, setPayees] = useState<PayrollPayee[]>([]);
  const [technicians, setTechnicians] = useState<PayrollTechnician[]>([]);
  const [rateSheets, setRateSheets] = useState<PayrollRateSheet[]>([]);
  const [regions, setRegions] = useState<PayrollRegionRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadedRegion, setLoadedRegion] = useState<{ weekEnding: string; region: PayrollRunRegion } | null>(null);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setSessionLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSessionLoading(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const loadData = useCallback(async () => {
    if (!session) return;

    setDataLoading(true);
    setDataError("");

    const [companiesResult, payeesResult, techResult, rateResult, regionsResult] = await Promise.all([
      supabase
        .from("payroll_companies")
        .select("id, company_name, legal_name, active, payee_id")
        .order("company_name"),
      supabase
        .from("payroll_payees")
        .select("id, display_name, payee_type, active")
        .order("display_name"),
      supabase
        .from("payroll_technicians")
        .select(`
          id,
          tech_number,
          full_name,
          worker_type,
          region,
          company_id,
          payee_id,
          rate_sheet_id,
          truck_lease_active,
          truck_lease_amount,
          meter_lease_active,
          meter_lease_amount,
          active,
          payroll_companies(company_name),
          payroll_payees(display_name),
          payroll_rate_sheets(name)
        `)
        .order("tech_number"),
      supabase
        .from("payroll_rate_sheets")
        .select("id, name, region, effective_from, active, payroll_type")
        .order("region")
        .order("name"),
      supabase
        .from("payroll_regions")
        .select("id,name,active,sort_order")
        .order("sort_order")
        .order("name"),
    ]);

    const error =
      companiesResult.error || payeesResult.error || techResult.error || rateResult.error || regionsResult.error;

    if (error) {
      setDataError(error.message);
    } else {
      setCompanies((companiesResult.data || []) as PayrollCompany[]);
      setPayees((payeesResult.data || []) as PayrollPayee[]);
      setTechnicians((techResult.data || []) as unknown as PayrollTechnician[]);
      setRateSheets((rateResult.data || []) as PayrollRateSheet[]);
      setRegions((regionsResult.data || []) as PayrollRegionRecord[]);
    }

    setDataLoading(false);
  }, [session]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  const counts = useMemo(
    () => ({
      companies: companies.filter(item => item.active).length,
      technicians: technicians.filter(item => item.active).length,
      rateSheets: rateSheets.filter(item => item.active).length,
    }),
    [companies, technicians, rateSheets]
  );

  async function login(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError("");

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) setAuthError(error.message);
    else setPassword("");

    setAuthBusy(false);
  }

  if (portalUser.role !== "director") {
    return (
      <section className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-5 text-sm text-red-200">
          Payroll is restricted to directors.
        </div>
      </section>
    );
  }

  if (sessionLoading) {
    return (
      <section className="mx-auto w-full max-w-[1900px] px-4 py-10 text-sm text-slate-400">
        Checking payroll access…
      </section>
    );
  }

  if (!session) {
    return (
      <section className="mx-auto max-w-md px-4 py-10">
        <form
          onSubmit={login}
          className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/90 p-6 shadow-2xl shadow-black/30"
        >
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-300">
              Director security
            </div>
            <h1 className="mt-2 text-2xl font-bold text-white">Unlock Payroll</h1>
            <p className="mt-1 text-xs text-slate-400">
              Payroll data is protected separately from the portal login.
            </p>
          </div>

          {authError && (
            <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {authError}
            </div>
          )}

          <input
            type="email"
            required
            placeholder="Director email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-blue-400"
          />

          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-blue-400"
          />

          <button
            disabled={authBusy}
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold hover:bg-blue-500 disabled:opacity-50"
          >
            {authBusy ? "Unlocking…" : "Unlock Payroll"}
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-[1900px] px-3 py-3 sm:px-5 sm:py-5">
      <div className="sticky top-0 z-30 mb-4 rounded-2xl border border-white/10 bg-slate-950/90 shadow-xl shadow-black/20 backdrop-blur-xl">
        <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-lg font-black text-white">
              $
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white">Payroll</h1>
                <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
                  Director
                </span>
              </div>
              <p className="truncate text-xs text-slate-500">{session.user.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
            {NAVIGATION.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setSection(item.key);
                  setNotice("");
                  setDataError("");
                }}
                className={
                  "inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition " +
                  (section === item.key
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-950/30"
                    : "text-slate-400 hover:bg-white/5 hover:text-white")
                }
              >
                <span className="text-sm">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white"
          >
            Lock Payroll
          </button>
        </div>
      </div>

      {notice && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="text-emerald-300/70 hover:text-emerald-200">
            ×
          </button>
        </div>
      )}

      {dataError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <span>{dataError}</span>
          <button type="button" onClick={() => setDataError("")} className="text-red-300/70 hover:text-red-200">
            ×
          </button>
        </div>
      )}

      {dataLoading && (
        <div className="mb-4 flex items-center gap-2 text-xs text-slate-400">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          Loading payroll data…
        </div>
      )}

      {section === "dashboard" && <Dashboard {...counts} />}

      {section === "companies" && (
        <Companies
          companies={companies}
          onChanged={loadData}
          onNotice={setNotice}
          onError={setDataError}
        />
      )}

      {section === "technicians" && (
        <Technicians
          companies={companies}
          payees={payees}
          rateSheets={rateSheets}
          technicians={technicians}
          regions={regions.filter(item => item.active)}
          onChanged={loadData}
          onNotice={setNotice}
          onError={setDataError}
        />
      )}

      {section === "regions" && (
        <Regions regions={regions} onChanged={loadData} onNotice={setNotice} onError={setDataError} />
      )}

      {section === "rateSheets" && (
        <RateSheets
          rateSheets={rateSheets}
          regions={regions.filter(item => item.active)}
          onChanged={loadData}
          onNotice={setNotice}
          onError={setDataError}
        />
      )}

      {section === "invoiceUpload" && (
        <InvoiceUpload
          onNotice={setNotice}
          onError={setDataError}
          regions={regions.filter(item => item.active).map(item => item.name)}
          loadedRegion={loadedRegion}
          onLoadedRegionConsumed={() => setLoadedRegion(null)}
        />
      )}

      {section === "history" && (
        <PayrollHistory
          onNotice={setNotice}
          onError={setDataError}
          regions={regions.filter(item => item.active).map(item => item.name)}
          onOpen={(weekEnding, region) => {
            setLoadedRegion({ weekEnding, region });
            setSection("invoiceUpload");
          }}
        />
      )}
    </section>
  );
}
