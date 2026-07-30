import { FormEvent, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import {
  type PayrollCompany,
  type PayrollPayee,
  type PayrollRateSheet,
  type PayrollRegion,
  type PayrollTechnician,
} from "../../types/payroll";

type TechniciansProps = {
  companies: PayrollCompany[];
  payees: PayrollPayee[];
  rateSheets: PayrollRateSheet[];
  technicians: PayrollTechnician[];
  regions: { id: string; name: string }[];
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

export default function Technicians({
  companies,
  payees,
  rateSheets,
  technicians,
  regions,
  onChanged,
  onNotice,
  onError,
}: TechniciansProps) {
  const [techNumber, setTechNumber] = useState("");
  const [techName, setTechName] = useState("");
  const [region, setRegion] = useState<PayrollRegion>("");
  const [workerType, setWorkerType] = useState<"cable" | "locator">("cable");
  const [companyId, setCompanyId] = useState("");
  const [payeeId, setPayeeId] = useState("");
  const [rateSheetId, setRateSheetId] = useState("");
  const [truckLeaseAmount, setTruckLeaseAmount] = useState<0 | 125 | 175>(0);
  const [meterLeaseActive, setMeterLeaseActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("All");
  const [companyFilter, setCompanyFilter] = useState("All");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const matchingRateSheets = rateSheets.filter(
    sheet => sheet.active && (!sheet.region || sheet.region === region)
  );

  const filteredTechnicians = useMemo(() => {
    const query = search.trim().toLowerCase();

    return technicians.filter(tech => {
      const companyName = tech.payroll_companies?.company_name || "";
      const payeeName = tech.payroll_payees?.display_name || "";
      const matchesSearch =
        !query ||
        tech.tech_number.toLowerCase().includes(query) ||
        String(tech.full_name || "").toLowerCase().includes(query) ||
        companyName.toLowerCase().includes(query) ||
        payeeName.toLowerCase().includes(query);

      const matchesRegion = regionFilter === "All" || tech.region === regionFilter;
      const matchesCompany = companyFilter === "All" || tech.company_id === companyFilter;

      return matchesSearch && matchesRegion && matchesCompany;
    });
  }, [technicians, search, regionFilter, companyFilter]);

  async function createTechnician(event: FormEvent) {
    event.preventDefault();
    onError("");

    if (!companyId || !payeeId) {
      onError("Select both a company and a payee.");
      return;
    }

    setBusy(true);

    const { error } = await supabase.from("payroll_technicians").insert({
      tech_number: techNumber.trim().toUpperCase(),
      full_name: techName.trim() || null,
      worker_type: workerType,
      region,
      company_id: companyId,
      payee_id: payeeId,
      rate_sheet_id: rateSheetId || null,
      truck_lease_active: truckLeaseAmount > 0,
      truck_lease_amount: truckLeaseAmount,
      meter_lease_active: meterLeaseActive,
      meter_lease_amount: meterLeaseActive ? 15 : 0,
      operating_company:
        companies.find(company => company.id === companyId)?.company_name || null,
    });

    if (error) {
      onError(error.message);
      setBusy(false);
      return;
    }

    setTechNumber("");
    setTechName("");
    setRateSheetId("");
    setTruckLeaseAmount(0);
    setMeterLeaseActive(false);
    onNotice("Technician created.");
    await onChanged();
    setBusy(false);
  }

  async function deleteTechnician(technician: PayrollTechnician) {
    const label = technician.full_name
      ? `${technician.tech_number} — ${technician.full_name}`
      : technician.tech_number;

    const confirmed = window.confirm(
      `Permanently delete technician ${label}?\n\nThis removes the technician from payroll setup and cannot be undone.`
    );

    if (!confirmed) return;

    setDeletingId(technician.id);
    onError("");

    const { error: assignmentError } = await supabase
      .from("payroll_rate_assignments")
      .delete()
      .eq("technician_id", technician.id);

    if (assignmentError) {
      onError(`Could not remove technician assignments: ${assignmentError.message}`);
      setDeletingId(null);
      return;
    }

    const { error } = await supabase
      .from("payroll_technicians")
      .delete()
      .eq("id", technician.id);

    if (error) {
      onError(`Could not delete technician: ${error.message}`);
      setDeletingId(null);
      return;
    }

    onNotice(`${label} was permanently deleted.`);
    await onChanged();
    setDeletingId(null);
  }

  async function updateTechRateSheet(technicianId: string, nextRateSheetId: string) {
    onError("");

    const { error } = await supabase
      .from("payroll_technicians")
      .update({ rate_sheet_id: nextRateSheetId || null })
      .eq("id", technicianId);

    if (error) {
      onError(error.message);
      return;
    }

    onNotice("Technician pay sheet updated.");
    await onChanged();
  }

  async function updateTruckLeaseAmount(
    technicianId: string,
    amount: 0 | 125 | 175
  ) {
    onError("");

    const { error } = await supabase
      .from("payroll_technicians")
      .update({
        truck_lease_active: amount > 0,
        truck_lease_amount: amount,
      })
      .eq("id", technicianId);

    if (error) {
      onError(error.message);
      return;
    }

    onNotice(amount > 0 ? `Truck lease set to $${amount}.` : "Truck lease removed.");
    await onChanged();
  }

  async function updateMeterLease(technicianId: string, enabled: boolean) {
    onError("");

    const { error } = await supabase
      .from("payroll_technicians")
      .update({
        meter_lease_active: enabled,
        meter_lease_amount: enabled ? 15 : 0,
      })
      .eq("id", technicianId);

    if (error) {
      onError(error.message);
      return;
    }

    onNotice(enabled ? "Meter lease enabled." : "Meter lease removed.");
    await onChanged();
  }

  return (
    <div className="grid gap-4 2xl:grid-cols-[280px_minmax(0,1fr)]">
      <form
        onSubmit={createTechnician}
        className="h-fit space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-4 2xl:sticky 2xl:top-24"
      >
        <div>
          <h2 className="text-base font-semibold text-white">Add technician</h2>
          <p className="mt-1 text-[11px] text-slate-500">Create the payroll assignment once.</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input
            required
            placeholder="Tech #"
            value={techNumber}
            onChange={event => setTechNumber(event.target.value)}
            className="min-w-0 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs uppercase outline-none focus:border-blue-400"
          />
          <input
            placeholder="Name"
            value={techName}
            onChange={event => setTechName(event.target.value)}
            className="min-w-0 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs outline-none focus:border-blue-400"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select value={workerType} onChange={event => setWorkerType(event.target.value as "cable" | "locator")} className="min-w-0 rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-xs">
            <option value="cable">Cable technician</option><option value="locator">Locator</option>
          </select>
          <select
            value={region}
            onChange={event => {
              setRegion(event.target.value as PayrollRegion);
              setRateSheetId("");
            }}
            className="min-w-0 rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-xs"
          >
            {regions.map(regionItem => (
              <option key={regionItem.id} value={regionItem.name}>{regionItem.name}</option>
            ))}
          </select>

          <select
            required
            value={companyId}
            onChange={event => {
              const nextCompanyId = event.target.value;
              setCompanyId(nextCompanyId);
              const company = companies.find(item => item.id === nextCompanyId);
              if (company?.payee_id) setPayeeId(company.payee_id);
            }}
            className="min-w-0 rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-xs"
          >
            <option value="">Company</option>
            {companies.filter(company => company.active).map(company => (
              <option key={company.id} value={company.id}>
                {company.company_name}
              </option>
            ))}
          </select>
        </div>

        <select
          required
          value={payeeId}
          onChange={event => setPayeeId(event.target.value)}
          className="w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-xs"
        >
          <option value="">Select payee</option>
          {payees.filter(payee => payee.active).map(payee => (
            <option key={payee.id} value={payee.id}>
              {payee.display_name}
            </option>
          ))}
        </select>

        <select
          value={rateSheetId}
          onChange={event => setRateSheetId(event.target.value)}
          className="w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-xs"
        >
          <option value="">Automatic pay sheet</option>
          {matchingRateSheets.map(sheet => (
            <option key={sheet.id} value={sheet.id}>
              {sheet.name}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">Truck</span>
            <select
              value={truckLeaseAmount}
              onChange={event =>
                setTruckLeaseAmount(Number(event.target.value) as 0 | 125 | 175)
              }
              className="w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-xs"
            >
              <option value={0}>$0</option>
              <option value={125}>$125</option>
              <option value={175}>$175</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">Meter</span>
            <button
              type="button"
              onClick={() => setMeterLeaseActive(value => !value)}
              className={
                "w-full rounded-lg border px-2 py-2 text-xs font-semibold " +
                (meterLeaseActive
                  ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300"
                  : "border-white/10 bg-slate-950 text-slate-500")
              }
            >
              {meterLeaseActive ? "$15 On" : "$0 Off"}
            </button>
          </label>
        </div>

        <button
          disabled={busy}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Add technician"}
        </button>
      </form>

      <div className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
        <div className="border-b border-white/10 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Technicians</h2>
              <p className="text-[11px] text-slate-500">
                Showing {filteredTechnicians.length} of {technicians.length}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_150px_180px]">
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search tech, name, company…"
                className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs outline-none focus:border-blue-400"
              />

              <select
                value={regionFilter}
                onChange={event => setRegionFilter(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-xs"
              >
                <option value="All">All regions</option>
                {regions.map(regionItem => (
                  <option key={regionItem.id} value={regionItem.name}>{regionItem.name}</option>
                ))}
              </select>

              <select
                value={companyFilter}
                onChange={event => setCompanyFilter(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-xs"
              >
                <option value="All">All companies</option>
                {companies.filter(company => company.active).map(company => (
                  <option key={company.id} value={company.id}>
                    {company.company_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="max-h-[calc(100vh-220px)] overflow-auto">
          <table className="w-full min-w-[1050px] text-xs">
            <thead className="sticky top-0 z-10 bg-slate-800 text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2.5 text-left">Tech</th>
                <th className="px-3 py-2.5 text-left">Name</th>
                <th className="px-3 py-2.5 text-left">Type</th>
                <th className="px-3 py-2.5 text-left">Region</th>
                <th className="px-3 py-2.5 text-left">Company / Payee</th>
                <th className="px-3 py-2.5 text-left">Pay sheet</th>
                <th className="w-24 px-3 py-2.5 text-center">Truck</th>
                <th className="w-20 px-3 py-2.5 text-center">Meter</th>
                <th className="w-20 px-3 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredTechnicians.map(tech => (
                <tr key={tech.id} className="border-t border-white/5 hover:bg-white/[0.025]">
                  <td className="px-3 py-2.5 font-bold text-white">{tech.tech_number}</td>
                  <td className="max-w-44 truncate px-3 py-2.5 text-slate-300">
                    {tech.full_name || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-slate-300">{tech.worker_type === "locator" ? "Locates" : "Cable"}</td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[10px] font-semibold text-blue-300">
                      {tech.region || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-slate-200">
                      {tech.payroll_companies?.company_name || "—"}
                    </div>
                    <div className="max-w-52 truncate text-[10px] text-slate-500">
                      {tech.payroll_payees?.display_name || "No payee"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      value={tech.rate_sheet_id || ""}
                      onChange={event => updateTechRateSheet(tech.id, event.target.value)}
                      className="w-full min-w-52 rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200"
                    >
                      <option value="">Automatic</option>
                      {rateSheets
                        .filter(
                          sheet =>
                            sheet.active && (!sheet.region || sheet.region === tech.region)
                        )
                        .map(sheet => (
                          <option key={sheet.id} value={sheet.id}>
                            {sheet.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <select
                      value={Number(tech.truck_lease_amount || 0)}
                      onChange={event =>
                        updateTruckLeaseAmount(
                          tech.id,
                          Number(event.target.value) as 0 | 125 | 175
                        )
                      }
                      className="w-20 rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-center text-[11px] font-semibold text-slate-200"
                    >
                      <option value={0}>$0</option>
                      <option value={125}>$125</option>
                      <option value={175}>$175</option>
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => updateMeterLease(tech.id, !tech.meter_lease_active)}
                      className={
                        "rounded-full px-3 py-1.5 text-[10px] font-bold " +
                        (tech.meter_lease_active
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-white/5 text-slate-500")
                      }
                    >
                      {tech.meter_lease_active ? "$15" : "$0"}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      disabled={deletingId === tech.id}
                      onClick={() => deleteTechnician(tech)}
                      className="rounded-lg border border-red-400/20 bg-red-500/10 px-2.5 py-1.5 text-[10px] font-bold text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {deletingId === tech.id ? "…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}

              {!filteredTechnicians.length && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                    No technicians match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
