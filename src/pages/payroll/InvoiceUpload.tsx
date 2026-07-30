import { useEffect, useMemo, useRef, useState } from "react";
import { readInvoice } from "../../lib/excel/readInvoice";
import { readLocateInvoice } from "../../lib/excel/readLocateInvoice";
import { buildLocatePayrollPreview } from "../../lib/payroll/buildLocatePayrollPreview";
import { buildPayrollPreview } from "../../lib/payroll/buildPayrollPreview";
import { exportIndividualPayrollFiles } from "../../lib/excel/exportPayroll";
import type { PayrollPreviewRow } from "../../types/invoice";
import { savePayrollRegion, type PayrollRunRegion } from "../../lib/payroll/payrollRuns";
import type { PayrollRegion } from "../../types/payroll";

type InvoiceUploadProps = {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  loadedRegion?: { weekEnding: string; region: PayrollRunRegion } | null;
  onLoadedRegionConsumed?: () => void;
  regions: string[];
};

type PreviewFilter = "all" | "issues" | "matched" | "skipped";

type InvoiceFileItem = {
  id: string;
  file: File;
  fingerprint: string;
  status: "queued" | "processing" | "success" | "failed";
  rows: PayrollPreviewRow[];
  error?: string;
};

async function fingerprintFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
}

function inferredWeekEnding(rows: PayrollPreviewRow[]): string {
  const dates = rows.map(row => row.completion_date).filter((value): value is string => Boolean(value)).sort();
  if (!dates.length) return new Date().toISOString().slice(0, 10);
  const latest = new Date(`${dates[dates.length - 1]}T12:00:00`);
  const daysToSaturday = (6 - latest.getDay() + 7) % 7;
  latest.setDate(latest.getDate() + daysToSaturday);
  return latest.toISOString().slice(0, 10);
}


function money(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [value.message, value.details, value.hint]
      .filter(part => typeof part === "string" && part.trim())
      .map(String);
    if (value.code) parts.push(`Code: ${String(value.code)}`);
    if (parts.length) return parts.join(" — ");
    try { return JSON.stringify(error); } catch { return "An unknown payroll save error occurred."; }
  }
  return String(error);
}

export default function InvoiceUpload({
  onNotice,
  onError,
  loadedRegion,
  onLoadedRegionConsumed,
  regions,
}: InvoiceUploadProps) {
  const [fileName, setFileName] = useState("");
  const [invoiceFiles, setInvoiceFiles] = useState<InvoiceFileItem[]>([]);
  const [preview, setPreview] = useState<PayrollPreviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [skippedRows, setSkippedRows] = useState<Set<number>>(() => new Set());
  const [missedQcByTech, setMissedQcByTech] = useState<Record<string, number>>({});
  const [manualAdjustmentsByTech, setManualAdjustmentsByTech] = useState<Record<string, { amount: number; reason: string }>>({});
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>("all");
  const [previewSearch, setPreviewSearch] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [payrollType, setPayrollType] = useState<"cable" | "locates">("cable");

  useEffect(() => {
    if (!loadedRegion) return;
    setFileName(loadedRegion.region.invoice_file_name);
    setInvoiceFiles([]);
    setPreview(Array.isArray(loadedRegion.region.preview_json) ? loadedRegion.region.preview_json : []);
    setSkippedRows(new Set(loadedRegion.region.skipped_rows_json || []));
    setMissedQcByTech(loadedRegion.region.qc_by_tech_json || {});
    const loadedAdjustments: Record<string, { amount: number; reason: string }> = {};
    for (const row of Array.isArray(loadedRegion.region.preview_json) ? loadedRegion.region.preview_json : []) {
      if (!row.tech_number || loadedAdjustments[row.tech_number]) continue;
      const amount = Number(row.manual_adjustment_amount || 0);
      const reason = String(row.manual_adjustment_reason || "");
      if (amount !== 0 || reason) loadedAdjustments[row.tech_number] = { amount, reason };
    }
    setManualAdjustmentsByTech(loadedAdjustments);
    setPreviewFilter("all");
    setPreviewSearch("");
    onNotice(`${loadedRegion.region.region} payroll loaded for week ending ${loadedRegion.weekEnding}.`);
    onLoadedRegionConsumed?.();
  }, [loadedRegion, onLoadedRegionConsumed, onNotice]);

  const previewWithAdjustments = useMemo(
    () =>
      preview.map(row => {
        const missedQcCount = Math.max(
          0,
          Math.floor(missedQcByTech[row.tech_number] || 0)
        );

        const manualAdjustment = manualAdjustmentsByTech[row.tech_number] || { amount: 0, reason: "" };

        return {
          ...row,
          missed_qc_count: missedQcCount,
          missed_qc_deduction: missedQcCount * 30,
          manual_adjustment_amount: Number(manualAdjustment.amount || 0),
          manual_adjustment_reason: manualAdjustment.reason.trim(),
        };
      }),
    [preview, missedQcByTech, manualAdjustmentsByTech]
  );

  const activePreview = useMemo(
    () =>
      previewWithAdjustments.filter(
        row => !skippedRows.has(row.source_row_number)
      ),
    [previewWithAdjustments, skippedRows]
  );

  const issueRows = useMemo(
    () => previewWithAdjustments.filter(row => row.match_status !== "matched"),
    [previewWithAdjustments]
  );

  const techAdjustments = useMemo(() => {
    const byTech = new Map<
      string,
      {
        techNumber: string;
        technicianName: string;
        companyName: string;
        truckLease: number;
        meterLease: number;
        missedQcCount: number;
        missedQcDeduction: number;
        manualAdjustment: number;
        manualAdjustmentReason: string;
      }
    >();

    for (const row of activePreview) {
      if (row.match_status !== "matched" || byTech.has(row.tech_number)) continue;

      byTech.set(row.tech_number, {
        techNumber: row.tech_number,
        technicianName: row.technician_name || row.tech_number,
        companyName: row.company_name || "—",
        truckLease: Number(row.truck_lease_amount ?? 0),
        meterLease: Number(row.meter_lease_amount ?? 0),
        missedQcCount: row.missed_qc_count || 0,
        missedQcDeduction: row.missed_qc_deduction || 0,
        manualAdjustment: Number(row.manual_adjustment_amount || 0),
        manualAdjustmentReason: String(row.manual_adjustment_reason || ""),
      });
    }

    return Array.from(byTech.values()).sort((a, b) =>
      a.techNumber.localeCompare(b.techNumber)
    );
  }, [activePreview]);

  const totals = useMemo(() => {
    const summary = activePreview.reduce(
      (next, row) => {
        next.invoice += row.invoice_total;
        next.grossPay += row.contractor_pay || 0;
        next.margin += row.company_margin || 0;
        if (row.match_status !== "matched") next.issues += 1;
        return next;
      },
      { invoice: 0, grossPay: 0, margin: 0, issues: 0 }
    );

    const truckLease = techAdjustments.reduce(
      (sum, tech) => sum + tech.truckLease,
      0
    );
    const meterLease = techAdjustments.reduce(
      (sum, tech) => sum + tech.meterLease,
      0
    );
    const missedQc = techAdjustments.reduce(
      (sum, tech) => sum + tech.missedQcDeduction,
      0
    );
    const deductions = truckLease + meterLease + missedQc;
    const manualAdjustment = techAdjustments.reduce(
      (sum, tech) => sum + tech.manualAdjustment,
      0
    );

    return {
      ...summary,
      truckLease,
      meterLease,
      missedQc,
      deductions,
      manualAdjustment,
      pay: summary.grossPay - deductions + manualAdjustment,
      margin: summary.margin + deductions - manualAdjustment,
    };
  }, [activePreview, techAdjustments]);

  const filteredPreview = useMemo(() => {
    const query = previewSearch.trim().toLowerCase();

    return previewWithAdjustments.filter(row => {
      const isSkipped = skippedRows.has(row.source_row_number);
      const filterMatch =
        previewFilter === "all" ||
        (previewFilter === "issues" && row.match_status !== "matched" && !isSkipped) ||
        (previewFilter === "matched" && row.match_status === "matched") ||
        (previewFilter === "skipped" && isSkipped);

      const searchMatch =
        !query ||
        row.tech_number.toLowerCase().includes(query) ||
        String(row.technician_name || "").toLowerCase().includes(query) ||
        row.job_code.toLowerCase().includes(query) ||
        String(row.company_name || "").toLowerCase().includes(query) ||
        String(row.job_number || "").toLowerCase().includes(query);

      return filterMatch && searchMatch;
    });
  }, [previewWithAdjustments, skippedRows, previewFilter, previewSearch]);

  const skippedCount = skippedRows.size;

  function rebuildMergedPreview(items: InvoiceFileItem[]) {
    let rowNumber = 1;
    const merged = items
      .filter(item => item.status === "success")
      .flatMap(item => item.rows.map(row => ({ ...row, source_row_number: rowNumber++ })));
    setPreview(merged);
    setFileName(items.filter(item => item.status === "success").map(item => item.file.name).join(", "));
  }

  async function processItem(id: string, file: File, fingerprint: string) {
    setInvoiceFiles(current => current.map(item => item.id === id ? { ...item, status: "processing", error: undefined } : item));
    try {
      const invoiceRows = payrollType === "locates" ? await readLocateInvoice(file) : await readInvoice(file);
      const calculated = payrollType === "locates" ? await buildLocatePayrollPreview(invoiceRows) : await buildPayrollPreview(invoiceRows);
      setInvoiceFiles(current => {
        const next = current.map(item => item.id === id ? { ...item, status: "success" as const, rows: calculated } : item);
        rebuildMergedPreview(next);
        return next;
      });
    } catch (error) {
      setInvoiceFiles(current => current.map(item => item.id === id ? { ...item, status: "failed", error: errorMessage(error), rows: [] } : item));
    }
  }

  async function addFiles(selected: File[]) {
    onError("");
    const excelFiles = selected.filter(file => /\.(xls|xlsx)$/i.test(file.name));
    if (!excelFiles.length) { onError("Choose one or more .xls or .xlsx invoice files."); return; }
    setBusy(true);
    const currentFingerprints = new Set(invoiceFiles.map(item => item.fingerprint));
    const additions: InvoiceFileItem[] = [];
    let duplicates = 0;
    for (const file of excelFiles) {
      const fingerprint = await fingerprintFile(file);
      if (currentFingerprints.has(fingerprint) || additions.some(item => item.fingerprint === fingerprint)) { duplicates += 1; continue; }
      additions.push({ id: crypto.randomUUID(), file, fingerprint, status: "queued", rows: [] });
    }
    if (duplicates) onNotice(`${duplicates} duplicate invoice${duplicates === 1 ? " was" : "s were"} ignored.`);
    setInvoiceFiles(current => [...current, ...additions]);
    setSkippedRows(new Set());
    setMissedQcByTech({});
    setManualAdjustmentsByTech({});
    setPreviewFilter("all");
    setPreviewSearch("");
    for (const item of additions) await processItem(item.id, item.file, item.fingerprint);
    setBusy(false);
  }

  function removeFile(id: string) {
    setInvoiceFiles(current => {
      const target = current.find(item => item.id === id);
      if (target?.status === "processing") return current;
      const next = current.filter(item => item.id !== id);
      rebuildMergedPreview(next);
      return next;
    });
  }

  async function retryFile(item: InvoiceFileItem) {
    setBusy(true);
    await processItem(item.id, item.file, item.fingerprint);
    setBusy(false);
  }

  function validateManualAdjustments(): boolean {
    const missingReason = techAdjustments.find(tech => tech.manualAdjustment !== 0 && !tech.manualAdjustmentReason.trim());
    if (!missingReason) return true;
    onError(`Add a reason for the ${money(missingReason.manualAdjustment)} adjustment for ${missingReason.technicianName}.`);
    return false;
  }

  async function savePayroll(status: "draft" | "complete") {
    onError("");
    if (!validateManualAdjustments()) return;
    if (!preview.length) { onError("Upload at least one successful invoice before saving."); return; }
    if (status === "complete" && totals.issues > 0) { onError("Fix or skip all issue lines before marking payroll complete."); return; }
    const weekEnding = inferredWeekEnding(preview);
    setSaveBusy(true);
    try {
      const payrollRegions = regions.filter(regionName => previewWithAdjustments.some(row => row.region === regionName));
      if (!payrollRegions.length) throw new Error("No matched invoice lines have a recognized payroll region.");
      for (const regionName of payrollRegions) {
        const regionPreview = previewWithAdjustments.filter(row => row.region === regionName);
        const activeRegion = regionPreview.filter(row => !skippedRows.has(row.source_row_number));
        const regionTechs = new Set(activeRegion.filter(row => row.match_status === "matched").map(row => row.tech_number));
        const truckLease = techAdjustments.filter(tech => regionTechs.has(tech.techNumber)).reduce((sum, tech) => sum + tech.truckLease, 0);
        const meterLease = techAdjustments.filter(tech => regionTechs.has(tech.techNumber)).reduce((sum, tech) => sum + tech.meterLease, 0);
        const missedQc = techAdjustments.filter(tech => regionTechs.has(tech.techNumber)).reduce((sum, tech) => sum + tech.missedQcDeduction, 0);
        const manualAdjustment = techAdjustments.filter(tech => regionTechs.has(tech.techNumber)).reduce((sum, tech) => sum + tech.manualAdjustment, 0);
        const invoice = activeRegion.reduce((sum, row) => sum + row.invoice_total, 0);
        const grossPay = activeRegion.reduce((sum, row) => sum + (row.contractor_pay || 0), 0);
        const baseMargin = activeRegion.reduce((sum, row) => sum + (row.company_margin || 0), 0);
        const issues = activeRegion.filter(row => row.match_status !== "matched").length;
        await savePayrollRegion({
          weekEnding, region: regionName, payrollType, fileName: invoiceFiles.filter(item => item.status === "success").map(item => item.file.name).join(", ") || fileName || "Saved payroll", status,
          totals: { invoice, grossPay, truckLease, meterLease, missedQc, manualAdjustment, pay: grossPay - truckLease - meterLease - missedQc + manualAdjustment, margin: baseMargin + truckLease + meterLease + missedQc - manualAdjustment, issues },
          preview: regionPreview, skippedRows: regionPreview.filter(row => skippedRows.has(row.source_row_number)).map(row => row.source_row_number), qcByTech: missedQcByTech,
        });
      }
      onNotice(`${payrollRegions.length} region${payrollRegions.length === 1 ? "" : "s"} saved as ${status} for week ending ${weekEnding}.`);
    } catch (error) { onError(errorMessage(error)); }
    finally { setSaveBusy(false); }
  }

  async function downloadPayroll() {
    onError("");
    if (!validateManualAdjustments()) return;
    setExportBusy(true);

    try {
      await exportIndividualPayrollFiles(activePreview);
      onNotice(
        skippedCount
          ? `Payroll downloaded with ${skippedCount} skipped invoice line${
              skippedCount === 1 ? "" : "s"
            }.`
          : "Payroll breakdown files downloaded."
      );
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setExportBusy(false);
    }
  }

  function toggleSkippedRow(sourceRowNumber: number) {
    setSkippedRows(current => {
      const next = new Set(current);
      if (next.has(sourceRowNumber)) next.delete(sourceRowNumber);
      else next.add(sourceRowNumber);
      return next;
    });
  }

  function toggleAllIssues() {
    const allIssueNumbers = issueRows.map(row => row.source_row_number);
    const allSkipped =
      allIssueNumbers.length > 0 &&
      allIssueNumbers.every(sourceRowNumber => skippedRows.has(sourceRowNumber));

    setSkippedRows(current => {
      const next = new Set(current);
      for (const sourceRowNumber of allIssueNumbers) {
        if (allSkipped) next.delete(sourceRowNumber);
        else next.add(sourceRowNumber);
      }
      return next;
    });
  }

  function updateManualAdjustment(techNumber: string, field: "amount" | "reason", value: number | string) {
    setManualAdjustmentsByTech(current => ({
      ...current,
      [techNumber]: {
        amount: field === "amount" ? (Number.isFinite(Number(value)) ? Number(value) : 0) : Number(current[techNumber]?.amount || 0),
        reason: field === "reason" ? String(value) : String(current[techNumber]?.reason || ""),
      },
    }));
  }

  function updateMissedQc(techNumber: string, value: number) {
    const nextValue = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    setMissedQcByTech(current => ({ ...current, [techNumber]: nextValue }));
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 sm:p-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Payroll type</div>
        <div className="mt-2 inline-flex rounded-xl border border-white/10 bg-slate-950 p-1">
          {(["cable", "locates"] as const).map(type => <button key={type} type="button" onClick={() => { setPayrollType(type); setInvoiceFiles([]); setPreview([]); setFileName(""); }} className={`rounded-lg px-4 py-2 text-sm font-semibold ${payrollType === type ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}>{type === "cable" ? "Cable" : "Locates"}</button>)}
        </div>
        {payrollType === "locates" && <p className="mt-2 text-xs text-slate-400">Reads K = code, M = quantity, O = locator, Q = date done. Every row is converted independently using tickets = ceil(quantity / 500).</p>}
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 sm:p-5">
        <div>
          <h2 className="text-base font-semibold text-white">{payrollType === "locates" ? "Upload locate invoices" : "Upload payroll invoices"}</h2>
          <p className="mt-1 text-xs text-slate-400">{payrollType === "locates" ? "Upload locator invoices. The locator is matched by name to the assigned technician pay sheet." : "Drop every regional invoice here. Each file processes independently, and all successful files merge into one payroll."}</p>
        </div>

        <div
          onDragEnter={event => { event.preventDefault(); setDragActive(true); }}
          onDragOver={event => { event.preventDefault(); setDragActive(true); }}
          onDragLeave={event => { event.preventDefault(); if (event.currentTarget === event.target) setDragActive(false); }}
          onDrop={event => { event.preventDefault(); setDragActive(false); void addFiles(Array.from(event.dataTransfer.files)); }}
          onClick={() => inputRef.current?.click()}
          className={`mt-4 flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${dragActive ? "border-blue-400 bg-blue-500/10" : "border-white/15 bg-slate-950/60 hover:border-blue-400/50"}`}
        >
          <div className="text-4xl text-blue-300">⇧</div>
          <div className="mt-3 text-lg font-bold text-white">Drag & drop invoices here</div>
          <div className="mt-1 text-sm text-slate-400">or click to browse for multiple .xls and .xlsx files</div>
          <input ref={inputRef} type="file" accept=".xls,.xlsx" multiple className="hidden" onChange={event => { void addFiles(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} />
        </div>

        {invoiceFiles.length > 0 && (
          <div className="mt-4 space-y-2">
            {invoiceFiles.map(item => (
              <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">{item.file.name}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{(item.file.size / 1024).toFixed(1)} KB {item.status === "success" ? `• ${item.rows.length} lines` : ""}</div>
                  {item.error && <div className="mt-1 text-xs text-rose-300">{item.error}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${item.status === "success" ? "bg-emerald-500/15 text-emerald-300" : item.status === "failed" ? "bg-rose-500/15 text-rose-300" : "bg-blue-500/15 text-blue-300"}`}>{item.status}</span>
                  {item.status === "failed" && <button type="button" onClick={event => { event.stopPropagation(); void retryFile(item); }} className="rounded-lg border border-amber-400/20 px-3 py-1.5 text-xs font-semibold text-amber-200">Retry</button>}
                  <button type="button" onClick={event => { event.stopPropagation(); removeFile(item.id); }} disabled={item.status === "processing"} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-300 disabled:opacity-40">Remove</button>
                </div>
              </div>
            ))}
            <div className="pt-1 text-xs text-slate-400">{invoiceFiles.filter(item => item.status === "success").length} successful • {invoiceFiles.filter(item => item.status === "failed").length} failed • {preview.length} merged lines</div>
          </div>
        )}
      </div>

      {preview.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Invoice total" value={money(totals.invoice)} hint="Amount billed to BPS" />
            <SummaryCard label="Gross contractor pay" value={money(totals.grossPay)} hint="Before weekly deductions" />
            <SummaryCard label="Net payroll" value={money(totals.pay)} hint={`${money(totals.deductions)} deductions • ${money(totals.manualAdjustment)} adjustments`} emphasis />
            <SummaryCard label="Company margin" value={money(totals.margin)} hint="After payroll deductions" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <DeductionCard label="Truck leases" value={totals.truckLease} />
            <DeductionCard label="Meter leases" value={totals.meterLease} />
            <DeductionCard label="Missed QCs" value={totals.missedQc} />
            <AdjustmentCard value={totals.manualAdjustment} />
            <div className="rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Review status</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className={"text-xl font-bold " + (totals.issues ? "text-amber-300" : "text-emerald-300")}>
                  {totals.issues}
                </span>
                <span className="text-xs text-slate-500">issues</span>
                <span className="text-slate-700">•</span>
                <span className="text-sm font-semibold text-slate-300">{skippedCount} skipped</span>
              </div>
            </div>
          </div>

          {techAdjustments.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
              <div className="flex flex-col gap-2 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-semibold text-white">Weekly deductions and adjustments</div>
                  <div className="text-[11px] text-slate-500">
                    Use a positive amount to add pay or a negative amount for a miscellaneous deduction. Add a reason for every adjustment.
                  </div>
                </div>
                <div className="text-xs text-slate-400">{techAdjustments.length} technicians in this payroll</div>
              </div>

              <div className="max-h-80 overflow-auto">
                <table className="w-full min-w-[1050px] text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-800 text-[10px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2.5 text-left">Tech</th>
                      <th className="px-3 py-2.5 text-left">Technician</th>
                      <th className="px-3 py-2.5 text-left">Company</th>
                      <th className="px-3 py-2.5 text-right">Truck</th>
                      <th className="px-3 py-2.5 text-right">Meter</th>
                      <th className="px-3 py-2.5 text-center">Missed QCs</th>
                      <th className="px-3 py-2.5 text-right">QC charge</th>
                      <th className="px-3 py-2.5 text-right">Adjustment</th>
                      <th className="px-3 py-2.5 text-left">Reason</th>
                      <th className="px-3 py-2.5 text-right">Net deductions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {techAdjustments.map(tech => {
                      const missedCount = missedQcByTech[tech.techNumber] || 0;
                      const qcCharge = missedCount * 30;
                      const adjustment = manualAdjustmentsByTech[tech.techNumber] || { amount: 0, reason: "" };
                      const totalDeduction = tech.truckLease + tech.meterLease + qcCharge - Number(adjustment.amount || 0);

                      return (
                        <tr key={tech.techNumber} className="border-t border-white/5 hover:bg-white/[0.025]">
                          <td className="px-3 py-2.5 font-bold text-white">{tech.techNumber}</td>
                          <td className="px-3 py-2.5 text-slate-300">{tech.technicianName}</td>
                          <td className="px-3 py-2.5 text-slate-500">{tech.companyName}</td>
                          <td className="px-3 py-2.5 text-right text-slate-300">{money(tech.truckLease)}</td>
                          <td className="px-3 py-2.5 text-right text-slate-300">{money(tech.meterLease)}</td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={missedCount}
                              onChange={event =>
                                updateMissedQc(tech.techNumber, Number(event.target.value))
                              }
                              className="w-16 rounded-lg border border-amber-400/20 bg-slate-950 px-2 py-1.5 text-center text-sm font-bold text-white outline-none focus:border-amber-400"
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-amber-300">{money(qcCharge)}</td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              step="0.01"
                              value={adjustment.amount}
                              onChange={event => updateManualAdjustment(tech.techNumber, "amount", event.target.value)}
                              className="w-28 rounded-lg border border-blue-400/20 bg-slate-950 px-2 py-1.5 text-right text-sm font-bold text-white outline-none focus:border-blue-400"
                              aria-label={`Adjustment amount for ${tech.technicianName}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={adjustment.reason}
                              onChange={event => updateManualAdjustment(tech.techNumber, "reason", event.target.value)}
                              placeholder={Number(adjustment.amount || 0) >= 0 ? "Bonus, extra job pay…" : "Tools, damage, advance…"}
                              className="w-56 rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-xs text-white outline-none focus:border-blue-400"
                              aria-label={`Adjustment reason for ${tech.technicianName}`}
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold text-white">{money(totalDeduction)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="font-semibold text-white">Export payroll breakdowns</div>
                <div className="mt-1 text-xs text-slate-400">
                  BPS technicians download individually. Other contractor companies download as one combined workbook.
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button type="button" onClick={() => void savePayroll("draft")} disabled={saveBusy || !preview.length} className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-4 py-2.5 text-xs font-semibold text-blue-200 disabled:opacity-50">{saveBusy ? "Saving…" : "Save payroll draft"}</button>
                <button type="button" onClick={() => void savePayroll("complete")} disabled={saveBusy || totals.issues > 0 || !preview.length} className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-200 disabled:opacity-50">Mark payroll complete</button>
                {issueRows.length > 0 && (
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-2.5 text-xs font-semibold text-amber-200">
                    <input
                      type="checkbox"
                      checked={issueRows.every(row => skippedRows.has(row.source_row_number))}
                      onChange={toggleAllIssues}
                      className="h-4 w-4 rounded border-white/20 bg-slate-950"
                    />
                    Skip all {issueRows.length} issue lines
                  </label>
                )}

                <button
                  type="button"
                  onClick={downloadPayroll}
                  disabled={exportBusy || totals.issues > 0 || activePreview.length === 0}
                  className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {exportBusy
                    ? "Building files…"
                    : totals.issues > 0
                      ? "Fix or skip issues"
                      : "Download Payroll Excel Files"}
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
            <div className="flex flex-col gap-3 border-b border-white/10 p-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="font-semibold text-white">Payroll preview</div>
                <div className="text-[11px] text-slate-500">
                  Showing {Math.min(filteredPreview.length, 250)} of {filteredPreview.length} filtered lines
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex rounded-lg border border-white/10 bg-slate-950 p-1">
                  {([
                    ["all", "All"],
                    ["issues", "Issues"],
                    ["matched", "Matched"],
                    ["skipped", "Skipped"],
                  ] as [PreviewFilter, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPreviewFilter(key)}
                      className={
                        "rounded-md px-3 py-1.5 text-[11px] font-semibold " +
                        (previewFilter === key
                          ? "bg-blue-600 text-white"
                          : "text-slate-500 hover:text-slate-300")
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <input
                  value={previewSearch}
                  onChange={event => setPreviewSearch(event.target.value)}
                  placeholder="Search tech, code, job…"
                  className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs outline-none focus:border-blue-400"
                />
              </div>
            </div>

            <div className="max-h-[62vh] overflow-auto">
              <table className="w-full min-w-[1350px] text-xs">
                <thead className="sticky top-0 z-10 bg-slate-800 text-[10px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5 text-center">Skip</th>
                    <th className="px-3 py-2.5 text-left">Status</th>
                    <th className="px-3 py-2.5 text-left">Tech</th>
                    <th className="px-3 py-2.5 text-left">Region</th>
                    <th className="px-3 py-2.5 text-left">Company</th>
                    <th className="px-3 py-2.5 text-left">Payee</th>
                    <th className="px-3 py-2.5 text-left">Code</th>
                    <th className="px-3 py-2.5 text-left">Pay sheet</th>
                    <th className="px-3 py-2.5 text-right">Qty</th>
                    <th className="px-3 py-2.5 text-right">Billed</th>
                    <th className="px-3 py-2.5 text-right">Rate</th>
                    <th className="px-3 py-2.5 text-right">Pay</th>
                    <th className="px-3 py-2.5 text-right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPreview.slice(0, 250).map((row, index) => {
                    const isIssue = row.match_status !== "matched";
                    const isSkipped = skippedRows.has(row.source_row_number);

                    return (
                      <tr
                        key={`${row.source_row_number}-${index}`}
                        className={
                          "border-t border-white/5 hover:bg-white/[0.025] " +
                          (isSkipped ? "bg-slate-950/80 opacity-50 line-through" : "")
                        }
                      >
                        <td className="px-3 py-2.5 text-center">
                          {isIssue ? (
                            <input
                              type="checkbox"
                              checked={isSkipped}
                              onChange={() => toggleSkippedRow(row.source_row_number)}
                              aria-label={`Skip invoice row ${row.source_row_number}`}
                              className="h-4 w-4 rounded border-white/20 bg-slate-950"
                            />
                          ) : (
                            <span className="text-slate-700">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {isSkipped ? (
                            <span className="rounded-full bg-slate-500/15 px-2 py-1 text-[10px] font-semibold text-slate-400">
                              skipped
                            </span>
                          ) : (
                            <StatusBadge status={row.match_status} />
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-bold text-white">{row.tech_number}</td>
                        <td className="px-3 py-2.5 text-slate-300">{row.region || "—"}</td>
                        <td className="px-3 py-2.5 text-slate-300">{row.company_name || "—"}</td>
                        <td className="max-w-48 truncate px-3 py-2.5 text-slate-400">{row.payee_name || "—"}</td>
                        <td className="px-3 py-2.5 font-semibold text-slate-200">{row.job_code}</td>
                        <td className="max-w-52 truncate px-3 py-2.5 text-slate-400">{row.rate_sheet_name || "—"}</td>
                        <td className="px-3 py-2.5 text-right">{row.quantity}</td>
                        <td className="px-3 py-2.5 text-right text-slate-300">{money(row.invoice_total)}</td>
                        <td className="px-3 py-2.5 text-right text-slate-300">{money(row.contractor_unit_rate)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-slate-200">{money(row.contractor_pay)}</td>
                        <td className="px-3 py-2.5 text-right text-slate-400">{money(row.company_margin)}</td>
                      </tr>
                    );
                  })}

                  {!filteredPreview.length && (
                    <tr>
                      <td colSpan={13} className="px-4 py-12 text-center text-slate-500">
                        No payroll lines match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl border p-4 " +
        (emphasis
          ? "border-emerald-400/20 bg-emerald-500/10"
          : "border-white/10 bg-slate-900/70")
      }
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</div>
      <div className={"mt-2 text-2xl font-bold " + (emphasis ? "text-emerald-300" : "text-white")}>{value}</div>
      <div className="mt-1 text-[11px] text-slate-500">{hint}</div>
    </div>
  );
}

function DeductionCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-amber-300">{money(value)}</div>
    </div>
  );
}

function AdjustmentCard({ value }: { value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Manual adjustments</div>
      <div className={`mt-1 text-xl font-bold ${value >= 0 ? "text-emerald-300" : "text-amber-300"}`}>{money(value)}</div>
      <div className="mt-1 text-[10px] text-slate-500">Positive adds pay • negative deducts</div>
    </div>
  );
}

function StatusBadge({ status }: { status: PayrollPreviewRow["match_status"] }) {
  const labels: Record<PayrollPreviewRow["match_status"], string> = {
    matched: "matched",
    unknown_tech: "unknown tech",
    missing_payee: "missing payee",
    missing_rate_sheet: "missing sheet",
    missing_rate: "missing rate",
  };

  return (
    <span
      className={
        "rounded-full px-2 py-1 text-[10px] font-semibold " +
        (status === "matched"
          ? "bg-emerald-500/15 text-emerald-300"
          : "bg-amber-500/15 text-amber-300")
      }
    >
      {labels[status]}
    </span>
  );
}
