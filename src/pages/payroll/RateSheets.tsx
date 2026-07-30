import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../../supabase";
import { readRateSheet } from "../../lib/excel/readRateSheet";
import {
  type ParsedRateRow,
  type PayrollRateSheet,
  type PayrollRegion,
} from "../../types/payroll";

type RateSheetsProps = {
  rateSheets: PayrollRateSheet[];
  regions: { id: string; name: string }[];
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message || "Unknown error");
  }
  return String(error || "Unknown error");
}

export default function RateSheets({
  rateSheets,
  regions,
  onChanged,
  onNotice,
  onError,
}: RateSheetsProps) {
  const [name, setName] = useState("");
  const [region, setRegion] = useState<PayrollRegion>("");
  const [payrollType, setPayrollType] = useState<"cable" | "locates">("cable");
  const [selectedRateSheetId, setSelectedRateSheetId] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsedRates, setParsedRates] = useState<ParsedRateRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [rateCounts, setRateCounts] = useState<Record<string, number>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadRateCounts() {
    const nextCounts: Record<string, number> = {};

    await Promise.all(
      rateSheets.map(async sheet => {
        const { count, error } = await supabase
          .from("payroll_rates")
          .select("id", { count: "exact", head: true })
          .eq("rate_sheet_id", sheet.id);

        if (!error) nextCounts[sheet.id] = count || 0;
      })
    );

    setRateCounts(nextCounts);
  }

  useEffect(() => {
    void loadRateCounts();
  }, [rateSheets]);

  async function deleteRateSheet(sheet: PayrollRateSheet) {
    const assignedCount = await supabase
      .from("payroll_technicians")
      .select("id", { count: "exact", head: true })
      .eq("rate_sheet_id", sheet.id);

    if (assignedCount.error) {
      onError(`Could not check pay-sheet assignments: ${assignedCount.error.message}`);
      return;
    }

    const confirmed = window.confirm(
      `Permanently delete ${sheet.name}?\n\nThis will delete ${rateCounts[sheet.id] || 0} saved rates and clear the pay-sheet assignment from ${assignedCount.count || 0} technician(s). This cannot be undone.`
    );

    if (!confirmed) return;

    setDeletingId(sheet.id);
    onError("");

    const { error: clearTechError } = await supabase
      .from("payroll_technicians")
      .update({ rate_sheet_id: null })
      .eq("rate_sheet_id", sheet.id);

    if (clearTechError) {
      onError(`Could not clear technician pay sheets: ${clearTechError.message}`);
      setDeletingId(null);
      return;
    }

    const { error: assignmentError } = await supabase
      .from("payroll_rate_assignments")
      .delete()
      .eq("rate_sheet_id", sheet.id);

    if (assignmentError) {
      onError(`Could not delete pay-sheet assignments: ${assignmentError.message}`);
      setDeletingId(null);
      return;
    }

    const { error: ratesError } = await supabase
      .from("payroll_rates")
      .delete()
      .eq("rate_sheet_id", sheet.id);

    if (ratesError) {
      onError(`Could not delete saved rates: ${ratesError.message}`);
      setDeletingId(null);
      return;
    }

    const { error } = await supabase
      .from("payroll_rate_sheets")
      .delete()
      .eq("id", sheet.id);

    if (error) {
      onError(`Could not delete pay sheet: ${error.message}`);
      setDeletingId(null);
      return;
    }

    if (selectedRateSheetId === sheet.id) {
      setSelectedRateSheetId("");
      setParsedRates([]);
      setFileName("");
    }

    onNotice(`${sheet.name} was permanently deleted.`);
    await onChanged();
    setDeletingId(null);
  }

  async function createRateSheet(event: FormEvent) {
    event.preventDefault();
    onError("");

    const { error } = await supabase.from("payroll_rate_sheets").insert({
      name: name.trim(),
      region,
      payroll_type: payrollType,
    });

    if (error) {
      onError(error.message);
      return;
    }

    setName("");
    onNotice("Pay sheet created. Select it on the right and import its Excel rates.");
    await onChanged();
  }

  async function handleFile(file: File | null) {
    onError("");
    setParsedRates([]);
    setFileName("");

    if (!file) return;

    if (!selectedRateSheetId) {
      onError("Select the destination pay sheet before choosing the Excel file.");
      return;
    }

    try {
      const parsed = await readRateSheet(file);
      setParsedRates(parsed);
      setFileName(file.name);
      onNotice(
        `Found ${parsed.length} rates in ${file.name}. Click the green Import button to save them.`
      );
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  async function importRates() {
    onError("");

    if (!selectedRateSheetId) {
      onError("Select the destination pay sheet.");
      return;
    }

    if (!parsedRates.length) {
      onError("Choose an Excel rate sheet first.");
      return;
    }

    setBusy(true);

    try {
      const payload = parsedRates.map(rate => ({
          rate_sheet_id: selectedRateSheetId,
        job_code: rate.job_code.trim().toUpperCase(),
        description: rate.description,
        unit_rate: rate.unit_rate,
      }));

      // Insert in small batches so large pay sheets do not silently fail.
      const batchSize = 100;
      for (let start = 0; start < payload.length; start += batchSize) {
        const batch = payload.slice(start, start + batchSize);
        const { error } = await supabase
          .from("payroll_rates")
          .upsert(batch, { onConflict: "rate_sheet_id,job_code" });

        if (error) throw error;
      }

      // Verify the rows really exist before reporting success.
      const { count, error: countError } = await supabase
        .from("payroll_rates")
        .select("id", { count: "exact", head: true })
        .eq("rate_sheet_id", selectedRateSheetId);

      if (countError) throw countError;

      const savedCount = count || 0;
      if (savedCount === 0) {
        throw new Error(
          "Supabase returned no error, but the pay sheet still contains 0 saved rates. Check the payroll_rates RLS policy for the signed-in director account."
        );
      }

      const sheet = rateSheets.find(item => item.id === selectedRateSheetId);
      setRateCounts(current => ({ ...current, [selectedRateSheetId]: savedCount }));
      setParsedRates([]);
      setFileName("");
      onNotice(
        `Saved and verified ${savedCount} rates in ${sheet?.name || "the selected pay sheet"}.`
      );
    } catch (error) {
      onError(`Rate import failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <form
          onSubmit={createRateSheet}
          className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5"
        >
          <h2 className="text-lg font-semibold text-white">Create pay sheet</h2>

          <input
            required
            placeholder="Example: Keystone Standard 2026"
            value={name}
            onChange={event => setName(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
          />

          <select value={payrollType} onChange={event => setPayrollType(event.target.value as "cable" | "locates")} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm">
            <option value="cable">Cable pay sheet</option><option value="locates">Locate pay sheet</option>
          </select>

          <select
            value={region}
            onChange={event => setRegion(event.target.value as PayrollRegion)}
            className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
          >
            {regions.map(regionItem => (
              <option key={regionItem.id} value={regionItem.name}>{regionItem.name}</option>
            ))}
          </select>

          <button className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">
            Save pay sheet
          </button>
        </form>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">Import Excel rates</h2>
            <p className="mt-1 text-xs text-slate-500">
              Select the pay sheet first, choose the Excel file, then click Import.
            </p>
          </div>

          <select
            value={selectedRateSheetId}
            onChange={event => {
              setSelectedRateSheetId(event.target.value);
              setParsedRates([]);
              setFileName("");
              onError("");
            }}
            className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="">Select destination pay sheet</option>
            {rateSheets.filter(sheet => sheet.active).map(sheet => (
              <option key={sheet.id} value={sheet.id}>
                {sheet.name} — {sheet.region || "No region"} — {rateCounts[sheet.id] || 0} rates
              </option>
            ))}
          </select>

          <label
            className={`block rounded-2xl border border-dashed p-6 text-center ${
              selectedRateSheetId
                ? "cursor-pointer border-blue-400/30 bg-blue-500/5 hover:bg-blue-500/10"
                : "cursor-not-allowed border-white/10 bg-white/[0.02] opacity-50"
            }`}
          >
            <input
              type="file"
              accept=".xls,.xlsx"
              disabled={!selectedRateSheetId || busy}
              className="hidden"
              onChange={event => handleFile(event.target.files?.[0] || null)}
            />
            <div className="text-sm font-semibold text-blue-200">
              Choose .xls or .xlsx file
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Reads CODE, DESCRIPTION and UNIT PRICE from the first worksheet
            </div>
          </label>

          {fileName && (
            <div className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-300">
              File: {fileName} · {parsedRates.length} rates detected
            </div>
          )}

          {parsedRates.length > 0 && (
            <button
              type="button"
              onClick={importRates}
              disabled={busy || !selectedRateSheetId}
              className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? "Saving and verifying rates…" : `Import ${parsedRates.length} rates now`}
            </button>
          )}
        </div>
      </div>

      {parsedRates.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
          <div className="border-b border-white/10 px-5 py-4">
            <div className="text-lg font-semibold">Preview</div>
            <div className="text-xs text-slate-500">
              First 25 of {parsedRates.length} detected codes. These are not saved until you click Import.
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Code</th>
                  <th className="px-4 py-3 text-left font-medium">Description</th>
                  <th className="px-4 py-3 text-right font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {parsedRates.slice(0, 25).map(rate => (
                  <tr key={rate.job_code} className="border-t border-white/5">
                    <td className="px-4 py-3 font-semibold text-white">
                      {rate.job_code}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {rate.description || "—"}
                    </td>
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
        <div className="border-b border-white/10 px-5 py-4 text-lg font-semibold">
          Pay sheets
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Region</th>
                <th className="px-4 py-3 text-left font-medium">Saved rates</th>
                <th className="px-4 py-3 text-left font-medium">Effective</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rateSheets.map(sheet => (
                <tr key={sheet.id} className="border-t border-white/5">
                  <td className="px-4 py-3 font-medium text-white">{sheet.name}</td>
                  <td className="px-4 py-3 text-slate-300">{sheet.payroll_type === "locates" ? "Locates" : "Cable"}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {sheet.region || "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {rateCounts[sheet.id] || 0}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {sheet.effective_from}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {sheet.active ? "Active" : "Inactive"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={deletingId === sheet.id}
                      onClick={() => deleteRateSheet(sheet)}
                      className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {deletingId === sheet.id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
              {!rateSheets.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No pay sheets yet.
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
