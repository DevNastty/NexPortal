import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { supabase } from "../supabase";

type PortalUser = {
  username: string;
  role: "tech" | "manager" | "director";
  displayName?: string;
};

type PayrollPageProps = {
  portalUser: PortalUser;
};

type PayrollSection = "dashboard" | "companies" | "technicians" | "rateSheets";

type Company = {
  id: string;
  company_name: string;
  legal_name: string | null;
  active: boolean;
  payee_id: string | null;
};

type Payee = {
  id: string;
  display_name: string;
  payee_type: "individual" | "company";
  active: boolean;
};

type Technician = {
  id: string;
  tech_number: string;
  full_name: string | null;
  region: string | null;
  company_id: string | null;
  payee_id: string;
  active: boolean;
  payroll_companies?: { company_name: string } | null;
  payroll_payees?: { display_name: string } | null;
};

type RateSheet = {
  id: string;
  name: string;
  region: string | null;
  effective_from: string;
  active: boolean;
};

type ParsedRateRow = {
  job_code: string;
  description: string | null;
  unit_rate: number;
};

const REGIONS = ["Keystone", "Beltway", "Freedom"] as const;

function messageFromError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message || "Unknown error");
  }
  return String(error || "Unknown error");
}

export default function PayrollPage({ portalUser }: PayrollPageProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [section, setSection] = useState<PayrollSection>("dashboard");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  const [companies, setCompanies] = useState<Company[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [rateSheets, setRateSheets] = useState<RateSheet[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [notice, setNotice] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [companyLegalName, setCompanyLegalName] = useState("");
  const [companyPaymentType, setCompanyPaymentType] = useState<"individual" | "company">("individual");

  const [techNumber, setTechNumber] = useState("");
  const [techName, setTechName] = useState("");
  const [techRegion, setTechRegion] = useState<(typeof REGIONS)[number]>("Keystone");
  const [techCompanyId, setTechCompanyId] = useState("");
  const [techPayeeId, setTechPayeeId] = useState("");

  const [rateSheetName, setRateSheetName] = useState("");
  const [rateSheetRegion, setRateSheetRegion] = useState<(typeof REGIONS)[number]>("Keystone");

  const [selectedRateSheetId, setSelectedRateSheetId] = useState("");
  const [rateFileName, setRateFileName] = useState("");
  const [parsedRates, setParsedRates] = useState<ParsedRateRow[]>([]);
  const [rateImportBusy, setRateImportBusy] = useState(false);

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

  const loadPayrollData = useCallback(async () => {
    if (!session) return;

    setDataLoading(true);
    setDataError("");

    const [companiesResult, payeesResult, techResult, rateResult] = await Promise.all([
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
          region,
          company_id,
          payee_id,
          active,
          payroll_companies(company_name),
          payroll_payees(display_name)
        `)
        .order("tech_number"),
      supabase
        .from("payroll_rate_sheets")
        .select("id, name, region, effective_from, active")
        .order("region")
        .order("name"),
    ]);

    const firstError =
      companiesResult.error ||
      payeesResult.error ||
      techResult.error ||
      rateResult.error;

    if (firstError) {
      setDataError(firstError.message);
    } else {
      setCompanies((companiesResult.data || []) as Company[]);
      setPayees((payeesResult.data || []) as Payee[]);
      setTechnicians((techResult.data || []) as unknown as Technician[]);
      setRateSheets((rateResult.data || []) as RateSheet[]);
    }

    setDataLoading(false);
  }, [session]);

  useEffect(() => {
    if (session) loadPayrollData();
    else {
      setCompanies([]);
      setPayees([]);
      setTechnicians([]);
      setRateSheets([]);
    }
  }, [session, loadPayrollData]);

  const counts = useMemo(
    () => ({
      companies: companies.filter(row => row.active).length,
      technicians: technicians.filter(row => row.active).length,
      rateSheets: rateSheets.filter(row => row.active).length,
    }),
    [companies, technicians, rateSheets]
  );

  async function handleSupabaseLogin(event: FormEvent) {
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

  async function handleSupabaseLogout() {
    await supabase.auth.signOut();
  }

  async function createCompany(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    setDataError("");

    const displayName = companyLegalName.trim() || companyName.trim();

    const { data: payee, error: payeeError } = await supabase
      .from("payroll_payees")
      .insert({
        display_name: displayName,
        legal_name: companyLegalName.trim() || null,
        payee_type: companyPaymentType,
      })
      .select("id")
      .single();

    if (payeeError) {
      setDataError(payeeError.message);
      return;
    }

    const { error: companyError } = await supabase
      .from("payroll_companies")
      .insert({
        company_name: companyName.trim(),
        legal_name: companyLegalName.trim() || null,
        payee_id: payee.id,
      });

    if (companyError) {
      setDataError(companyError.message);
      return;
    }

    setCompanyName("");
    setCompanyLegalName("");
    setCompanyPaymentType("individual");
    setNotice("Company created.");
    await loadPayrollData();
  }

  async function createTechnician(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    setDataError("");

    if (!techCompanyId || !techPayeeId) {
      setDataError("Select both a company and a payee.");
      return;
    }

    const { error } = await supabase
      .from("payroll_technicians")
      .insert({
        tech_number: techNumber.trim().toUpperCase(),
        full_name: techName.trim() || null,
        region: techRegion,
        company_id: techCompanyId,
        payee_id: techPayeeId,
        operating_company: companies.find(c => c.id === techCompanyId)?.company_name || null,
      });

    if (error) {
      setDataError(error.message);
      return;
    }

    setTechNumber("");
    setTechName("");
    setNotice("Technician created.");
    await loadPayrollData();
  }

  async function createRateSheet(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    setDataError("");

    const { error } = await supabase
      .from("payroll_rate_sheets")
      .insert({
        name: rateSheetName.trim(),
        region: rateSheetRegion,
      });

    if (error) {
      setDataError(error.message);
      return;
    }

    setRateSheetName("");
    setNotice("Rate sheet created.");
    await loadPayrollData();
  }


  function normalizeRateHeader(value: unknown) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
  }

  function parseMoney(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const cleaned = String(value ?? "")
      .replace(/\$/g, "")
      .replace(/,/g, "")
      .trim();
    const match = cleaned.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : Number.NaN;
  }

  async function handleRateFile(file: File | null) {
    setNotice("");
    setDataError("");
    setParsedRates([]);
    setRateFileName("");

    if (!file) return;

    if (!/\.(xls|xlsx)$/i.test(file.name)) {
      setDataError("Use an .xls or .xlsx rate-sheet file.");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        setDataError("The workbook does not contain a worksheet.");
        return;
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        raw: true,
        defval: "",
      });

      if (!rows.length) {
        setDataError("The first worksheet is empty.");
        return;
      }

      let headerRowIndex = -1;
      let codeColumn = -1;
      let descriptionColumn = -1;
      let rateColumn = -1;

      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex++) {
        const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
        const headers = row.map(normalizeRateHeader);

        const possibleCode = headers.findIndex(header =>
          header === "code" ||
          header === "job code" ||
          header === "billing code" ||
          header.includes("job code")
        );

        const possibleRate = headers.findIndex(header =>
          header === "unit price" ||
          header === "unit rate" ||
          header === "rate" ||
          header === "contractor rate" ||
          header === "pay rate" ||
          header.includes("unit price") ||
          header.includes("pay rate")
        );

        if (possibleCode >= 0 && possibleRate >= 0) {
          headerRowIndex = rowIndex;
          codeColumn = possibleCode;
          rateColumn = possibleRate;
          descriptionColumn = headers.findIndex(header =>
            header === "description" ||
            header === "job description" ||
            header.includes("description")
          );
          break;
        }
      }

      if (headerRowIndex < 0) {
        setDataError(
          'Could not find the rate-sheet headers. Expected columns such as "Code" and "Unit Price".'
        );
        return;
      }

      const deduped = new Map<string, ParsedRateRow>();

      for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
        const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
        const code = String(row[codeColumn] ?? "").trim();
        const rate = parseMoney(row[rateColumn]);
        const description =
          descriptionColumn >= 0
            ? String(row[descriptionColumn] ?? "").trim()
            : "";

        if (!code || !Number.isFinite(rate) || rate < 0) continue;
        if (/^(code|job code|total|totals)$/i.test(code)) continue;

        deduped.set(code.toUpperCase(), {
          job_code: code.toUpperCase(),
          description: description || null,
          unit_rate: rate,
        });
      }

      const parsed = Array.from(deduped.values()).sort((a, b) =>
        a.job_code.localeCompare(b.job_code)
      );

      if (!parsed.length) {
        setDataError("No valid code and rate rows were found.");
        return;
      }

      setParsedRates(parsed);
      setRateFileName(file.name);
      setNotice(`Found ${parsed.length} rate codes in ${file.name}. Review and import them below.`);
    } catch (error) {
      setDataError(`Could not read the rate sheet: ${messageFromError(error)}`);
    }
  }

  async function importParsedRates() {
    setNotice("");
    setDataError("");

    if (!selectedRateSheetId) {
      setDataError("Select the rate sheet these codes belong to.");
      return;
    }

    if (!parsedRates.length) {
      setDataError("Choose and read a rate-sheet file first.");
      return;
    }

    setRateImportBusy(true);

    const payload = parsedRates.map(row => ({
      rate_sheet_id: selectedRateSheetId,
      job_code: row.job_code,
      description: row.description,
      unit_rate: row.unit_rate,
    }));

    const { error } = await supabase
      .from("payroll_rates")
      .upsert(payload, {
        onConflict: "rate_sheet_id,job_code",
      });

    if (error) {
      setDataError(error.message);
      setRateImportBusy(false);
      return;
    }

    const selectedSheet = rateSheets.find(sheet => sheet.id === selectedRateSheetId);
    setNotice(
      `Imported ${payload.length} rates into ${selectedSheet?.name || "the selected rate sheet"}.`
    );
    setParsedRates([]);
    setRateFileName("");
    setRateImportBusy(false);
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
      <section className="mx-auto max-w-7xl px-4 py-10 text-sm text-slate-400">
        Checking payroll access…
      </section>
    );
  }

  if (!session) {
    return (
      <section className="mx-auto max-w-md px-4 py-10">
        <form
          onSubmit={handleSupabaseLogin}
          className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl"
        >
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-300">
              Director security
            </div>
            <h1 className="mt-2 text-2xl font-bold text-white">Unlock Payroll</h1>
            <p className="mt-2 text-sm text-slate-400">
              Your regular portal login stays on Google Sheets. Enter the Supabase director account you created to access payroll records.
            </p>
          </div>

          {authError && (
            <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {authError}
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-xs text-slate-300">Director email</span>
            <input
              type="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-slate-300">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
          </label>

          <button
            disabled={authBusy}
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {authBusy ? "Unlocking…" : "Unlock Payroll"}
          </button>
        </form>
      </section>
    );
  }

  const nav: { key: PayrollSection; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "companies", label: "Companies" },
    { key: "technicians", label: "Technicians" },
    { key: "rateSheets", label: "Rate Sheets" },
  ];

  return (
    <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-col gap-4 rounded-3xl border border-white/10 bg-slate-900/70 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-300">Director only</div>
          <h1 className="mt-1 text-2xl font-bold text-white">Payroll</h1>
          <p className="mt-1 text-sm text-slate-400">
            Signed into payroll as {session.user.email}
          </p>
        </div>

        <button
          type="button"
          onClick={handleSupabaseLogout}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:bg-white/10"
        >
          Lock Payroll
        </button>
      </div>

      <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60 p-2">
        {nav.map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setSection(item.key);
              setNotice("");
              setDataError("");
            }}
            className={
              "whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium " +
              (section === item.key
                ? "bg-blue-600 text-white"
                : "text-slate-300 hover:bg-white/10")
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      {dataError && (
        <div className="mb-4 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {dataError}
        </div>
      )}

      {dataLoading && (
        <div className="mb-4 text-sm text-slate-400">Loading payroll data…</div>
      )}

      {section === "dashboard" && (
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["Companies", counts.companies],
            ["Technicians", counts.technicians],
            ["Rate Sheets", counts.rateSheets],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
              <div className="text-sm text-slate-400">{label}</div>
              <div className="mt-2 text-3xl font-bold text-white">{value}</div>
            </div>
          ))}
        </div>
      )}

      {section === "companies" && (
        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <form onSubmit={createCompany} className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
            <h2 className="text-lg font-semibold text-white">Add company</h2>

            <input
              required
              placeholder="Company name"
              value={companyName}
              onChange={event => setCompanyName(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            />

            <input
              placeholder="Legal name (optional)"
              value={companyLegalName}
              onChange={event => setCompanyLegalName(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            />

            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">How this company gets paid</span>
              <select
                value={companyPaymentType}
                onChange={event => setCompanyPaymentType(event.target.value as "individual" | "company")}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="individual">Individual contractors</option>
                <option value="company">One company payment</option>
              </select>
            </label>

            <button className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">
              Save company
            </button>
          </form>

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
            <div className="border-b border-white/10 px-5 py-4 text-lg font-semibold">Companies</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white/5 text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Company</th>
                    <th className="px-4 py-3 text-left font-medium">Legal name</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map(company => (
                    <tr key={company.id} className="border-t border-white/5">
                      <td className="px-4 py-3 font-medium text-white">{company.company_name}</td>
                      <td className="px-4 py-3 text-slate-300">{company.legal_name || "—"}</td>
                      <td className="px-4 py-3 text-slate-300">{company.active ? "Active" : "Inactive"}</td>
                    </tr>
                  ))}
                  {!companies.length && (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">No companies yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {section === "technicians" && (
        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <form onSubmit={createTechnician} className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
            <h2 className="text-lg font-semibold text-white">Add technician</h2>

            <input
              required
              placeholder="Tech number"
              value={techNumber}
              onChange={event => setTechNumber(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm uppercase"
            />

            <input
              placeholder="Technician name"
              value={techName}
              onChange={event => setTechName(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            />

            <select
              value={techRegion}
              onChange={event => setTechRegion(event.target.value as (typeof REGIONS)[number])}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            >
              {REGIONS.map(region => <option key={region}>{region}</option>)}
            </select>

            <select
              required
              value={techCompanyId}
              onChange={event => {
                const nextCompanyId = event.target.value;
                setTechCompanyId(nextCompanyId);
                const company = companies.find(row => row.id === nextCompanyId);
                if (company?.payee_id) setTechPayeeId(company.payee_id);
              }}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="">Select company</option>
              {companies.filter(c => c.active).map(company => (
                <option key={company.id} value={company.id}>{company.company_name}</option>
              ))}
            </select>

            <select
              required
              value={techPayeeId}
              onChange={event => setTechPayeeId(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="">Select payee</option>
              {payees.filter(p => p.active).map(payee => (
                <option key={payee.id} value={payee.id}>
                  {payee.display_name} ({payee.payee_type})
                </option>
              ))}
            </select>

            <button className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">
              Save technician
            </button>
          </form>

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
            <div className="border-b border-white/10 px-5 py-4 text-lg font-semibold">Technicians</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white/5 text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Tech #</th>
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Region</th>
                    <th className="px-4 py-3 text-left font-medium">Company</th>
                    <th className="px-4 py-3 text-left font-medium">Payee</th>
                  </tr>
                </thead>
                <tbody>
                  {technicians.map(tech => (
                    <tr key={tech.id} className="border-t border-white/5">
                      <td className="px-4 py-3 font-semibold text-white">{tech.tech_number}</td>
                      <td className="px-4 py-3 text-slate-300">{tech.full_name || "—"}</td>
                      <td className="px-4 py-3 text-slate-300">{tech.region || "—"}</td>
                      <td className="px-4 py-3 text-slate-300">{tech.payroll_companies?.company_name || "—"}</td>
                      <td className="px-4 py-3 text-slate-300">{tech.payroll_payees?.display_name || "—"}</td>
                    </tr>
                  ))}
                  {!technicians.length && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No technicians yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {section === "rateSheets" && (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <form onSubmit={createRateSheet} className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
              <h2 className="text-lg font-semibold text-white">Create rate sheet</h2>

              <input
                required
                placeholder="Example: Keystone 2026"
                value={rateSheetName}
                onChange={event => setRateSheetName(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
              />

              <select
                value={rateSheetRegion}
                onChange={event => setRateSheetRegion(event.target.value as (typeof REGIONS)[number])}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
              >
                {REGIONS.map(region => <option key={region}>{region}</option>)}
              </select>

              <button className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">
                Save rate sheet
              </button>
            </form>

            <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
              <div>
                <h2 className="text-lg font-semibold text-white">Import Excel rates</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Supports old .xls files and newer .xlsx files.
                </p>
              </div>

              <select
                value={selectedRateSheetId}
                onChange={event => setSelectedRateSheetId(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="">Select destination rate sheet</option>
                {rateSheets.filter(sheet => sheet.active).map(sheet => (
                  <option key={sheet.id} value={sheet.id}>
                    {sheet.name} — {sheet.region || "No region"}
                  </option>
                ))}
              </select>

              <label className="block cursor-pointer rounded-2xl border border-dashed border-blue-400/30 bg-blue-500/5 p-6 text-center hover:bg-blue-500/10">
                <input
                  type="file"
                  accept=".xls,.xlsx"
                  className="hidden"
                  onChange={event => handleRateFile(event.target.files?.[0] || null)}
                />
                <div className="text-sm font-semibold text-blue-200">
                  Choose rate-sheet Excel file
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Expected columns: Code, Description, Unit Price
                </div>
              </label>

              {rateFileName && (
                <div className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-300">
                  File: {rateFileName}
                </div>
              )}

              {parsedRates.length > 0 && (
                <button
                  type="button"
                  disabled={rateImportBusy || !selectedRateSheetId}
                  onClick={importParsedRates}
                  className="w-full rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
                >
                  {rateImportBusy
                    ? "Importing…"
                    : `Import ${parsedRates.length} rates`}
                </button>
              )}
            </div>
          </div>

          {parsedRates.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
              <div className="border-b border-white/10 px-5 py-4">
                <div className="text-lg font-semibold">Import preview</div>
                <div className="text-xs text-slate-500">
                  Showing the first 25 of {parsedRates.length} detected rates.
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-white/5 text-slate-400">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Code</th>
                      <th className="px-4 py-3 text-left font-medium">Description</th>
                      <th className="px-4 py-3 text-right font-medium">Unit rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRates.slice(0, 25).map(rate => (
                      <tr key={rate.job_code} className="border-t border-white/5">
                        <td className="px-4 py-3 font-semibold text-white">{rate.job_code}</td>
                        <td className="px-4 py-3 text-slate-300">{rate.description || "—"}</td>
                        <td className="px-4 py-3 text-right text-slate-200">
                          ${rate.unit_rate.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
            <div className="border-b border-white/10 px-5 py-4 text-lg font-semibold">Rate sheets</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white/5 text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Region</th>
                    <th className="px-4 py-3 text-left font-medium">Effective</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rateSheets.map(sheet => (
                    <tr key={sheet.id} className="border-t border-white/5">
                      <td className="px-4 py-3 font-medium text-white">{sheet.name}</td>
                      <td className="px-4 py-3 text-slate-300">{sheet.region || "—"}</td>
                      <td className="px-4 py-3 text-slate-300">{sheet.effective_from}</td>
                      <td className="px-4 py-3 text-slate-300">{sheet.active ? "Active" : "Inactive"}</td>
                    </tr>
                  ))}
                  {!rateSheets.length && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No rate sheets yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
