import { useEffect, useMemo, useState } from "react";
import React from "react";
import { ONB_SHEET_CSV_URL, loadLocalCandidates, loadOnbDeleted, onbKey, parseOnbCsvToRows, saveLocalCandidates, saveOnbDeleted, sendOnboardingToSheet, type OnbRow } from "../lib/onboarding";
import { DEFAULT_LOCATIONS, DEFAULT_MANAGERS, loadPortalLocations, loadPortalManagers } from "../lib/management";
import { archiveOnboardingApplication, loadOnboardingFromDatabase, saveOnboardingToDatabase, syncOnboardingRows } from "../lib/onboardingDb";
import { supabase } from "../supabase";
import type { AuthUser } from "../types/navigation";
function Select({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: any }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs text-slate-300 sm:flex-none">
      <span className="pl-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="min-h-10 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/15 sm:min-w-44">{children}</select>
    </label>
  );
}

function Field({ label, children, required = false }: { label: string; children: any; required?: boolean }) {
  return (
    <label className="text-xs text-slate-300 flex flex-col gap-1">
      <span className="opacity-80">{label}{required && <span className="text-red-400"> *</span>}</span>
      {children}
    </label>
  );
}
function OnboardingFormPage() {
  const [status, setStatus] = useState<"" | "ok" | "err">("");
  const [locationOptions, setLocationOptions] = useState<string[]>(DEFAULT_LOCATIONS);
  const [managerOptions, setManagerOptions] = useState<string[]>(DEFAULT_MANAGERS);
  const [form, setForm] = useState<OnbRow>({
    location: "", manager: "", fullName: "", address: "",
    email: "", phone: "", drugZip: "", dlNumber: "", dlExpiration: "", birthDate: "",
  });
  const update = (k: keyof typeof form, v: any) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    loadPortalLocations().then(rows => { const active = rows.filter(row => row.active).map(row => row.name); if (active.length) setLocationOptions(active); }).catch(() => {});
    loadPortalManagers().then(rows => { const active = rows.filter(row => row.active).map(row => `${row.name} (${row.company_name})`); if (active.length) setManagerOptions(active); }).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.location || !form.manager || !form.fullName || !form.address || !form.email || !form.phone || !form.drugZip || !form.dlNumber || !form.dlExpiration) {
      setStatus("err"); return;
    }
    const row: OnbRow = {
      ...form, fullName: form.fullName!.trim(), address: form.address!.trim(),
      email: form.email!.trim(), phone: form.phone!.trim(), drugZip: form.drugZip!.trim(),
      dlNumber: form.dlNumber!.trim(), bg: "pending", drug: "pending",
      paperwork: false, credentials: false, tools: false, truck: false, meter: false,
      mentor: "", notes: "", submittedAt: new Date().toISOString(),
    };
    try {
      await saveOnboardingToDatabase(row);
      // Keep the Google Sheet as a temporary backup until migration is verified.
      void sendOnboardingToSheet(row);
    } catch (error) {
      console.error("Failed to save onboarding to Supabase", error);
      setStatus("err");
      return;
    }
    const existing = loadLocalCandidates();
    existing.push(row);
    saveLocalCandidates(existing);
    setStatus("ok");
    setForm({ location: "", manager: "", fullName: "", address: "", email: "", phone: "", drugZip: "", dlNumber: "", dlExpiration: "" });
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h2 className="text-2xl font-semibold">Onboarding Form</h2>
      <p className="mt-1 text-sm text-slate-400">Fill this out to kick off your onboarding with BPS.</p>
      <form onSubmit={submit} className="mt-6 grid gap-4">
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Location Applying For" required>
            <select className="i" value={form.location} onChange={e => update("location", e.target.value)}>
              <option value="">Select…</option>
              {locationOptions.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Manager Name" required>
            <select className="i" value={form.manager} onChange={e => update("manager", e.target.value)}>
              <option value="">Select…</option>
              {managerOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Full Name" required><input className="i" value={form.fullName} onChange={e => update("fullName", e.target.value)} /></Field>
        <Field label="Current Address" required><input className="i" value={form.address} onChange={e => update("address", e.target.value)} /></Field>
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Email Address" required><input className="i" type="email" value={form.email} onChange={e => update("email", e.target.value)} /></Field>
          <Field label="Phone Number" required><input className="i" value={form.phone} onChange={e => update("phone", e.target.value)} /></Field>
          <Field label="Zip Code for Drug Test" required><input className="i" inputMode="numeric" pattern="\d{5}" placeholder="e.g. 17112" value={form.drugZip} onChange={e => update("drugZip", e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="block text-sm mb-1">Driver's License Number *</label><input type="text" className="w-full rounded-md px-3 py-2 bg-slate-900 border border-slate-700" value={form.dlNumber || ""} onChange={e => setForm({ ...form, dlNumber: e.target.value })} required /></div>
          <div><label className="block text-sm mb-1">Driver's License Expiration Date *</label><input type="date" className="w-full rounded-md px-3 py-2 bg-slate-900 border border-slate-700" value={form.dlExpiration || ""} onChange={e => setForm({ ...form, dlExpiration: e.target.value })} required /></div>
          <div><label className="block text-sm mb-1">Birth Date *</label><input type="date" className="w-full rounded-md px-3 py-2 bg-slate-900 border border-slate-700" value={form.birthDate || ""} onChange={e => setForm({ ...form, birthDate: e.target.value })} required /></div>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className="rounded-xl px-4 py-2 bg-blue-600 hover:bg-blue-500 text-sm">Submit</button>
          {status === "ok" && <span className="text-xs text-green-300">Submitted — thank you! A manager will reach out.</span>}
          {status === "err" && <span className="text-xs text-red-300">Please complete all required fields.</span>}
        </div>
      </form>
      <style>{`.i{background:#0b1220;border:1px solid rgba(255,255,255,.1);border-radius:.75rem;padding:.5rem .75rem;width:100%;}`}</style>
    </div>
  );
}
function OnboardingMgmtPage({ authUser }: { authUser: AuthUser }) {
  const [rows, setRows] = useState<OnbRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loc, setLoc] = useState("All Locations");
  const [mgr, setMgr] = useState("All Managers");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<OnbRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<OnbRow | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [ownerCompanyName, setOwnerCompanyName] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadOwnerCompany() {
      if (authUser.role !== "bp_owner" || !authUser.companyId) { setOwnerCompanyName(""); return; }
      const result = await supabase.from("payroll_companies").select("company_name").eq("id", authUser.companyId).maybeSingle();
      if (!cancelled) setOwnerCompanyName(String(result.data?.company_name || ""));
    }
    void loadOwnerCompany();
    return () => { cancelled = true; };
  }, [authUser.role, authUser.companyId]);

  const refreshRows = async () => {
    const deletedKeys = new Set(loadOnbDeleted());
    const databaseRows = await loadOnboardingFromDatabase();
    const local = loadLocalCandidates();
    const seen = new Set(databaseRows.map(r => `${r.submittedAt}|${r.fullName}`));
    const merged = [...databaseRows, ...local.filter(r => !seen.has(`${r.submittedAt}|${r.fullName}`))];
    setRows(merged.filter(r => !deletedKeys.has(onbKey(r))));
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        await refreshRows();
      } catch (e) {
        console.error("Failed to load onboarding from Supabase", e);
        setError("Could not load onboarding data from Supabase. Run the onboarding database migration first.");
        const deletedKeys = new Set(loadOnbDeleted());
        setRows(loadLocalCandidates().filter(r => !deletedKeys.has(onbKey(r))));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const importGoogleSheet = async () => {
    if (!ONB_SHEET_CSV_URL) {
      setImportMessage("No Google Sheet CSV URL is configured.");
      return;
    }

    setImporting(true);
    setImportMessage("");
    setError("");
    try {
      const separator = ONB_SHEET_CSV_URL.includes("?") ? "&" : "?";
      const response = await fetch(`${ONB_SHEET_CSV_URL}${separator}t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Google Sheet returned ${response.status}`);

      const sheetRows = parseOnbCsvToRows(await response.text());
      if (!sheetRows.length) {
        setImportMessage("The Google Sheet did not contain any onboarding rows.");
        return;
      }

      const imported = await syncOnboardingRows(sheetRows);
      await refreshRows();
      setImportMessage(`Import complete. Checked ${imported} Google Sheet rows; existing records were skipped.`);
    } catch (e) {
      console.error("Failed to import onboarding Google Sheet", e);
      setError("Google Sheet import failed. Confirm the sheet is published as CSV and your role is Director or higher.");
    } finally {
      setImporting(false);
    }
  };

  const locations = useMemo(
    () => [
      "All Locations",
      ...Array.from(new Set(rows.map(r => r.location).filter(Boolean) as string[])).sort(),
    ],
    [rows]
  );

  const managers = useMemo(
    () => [
      "All Managers",
      ...Array.from(new Set(rows.map(r => r.manager).filter(Boolean) as string[])).sort(),
    ],
    [rows]
  );

  const displayRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows
      .filter(r => {
        if (authUser.role === "bp_owner") {
          if (!ownerCompanyName) return false;
          const managerText = String(r.manager || "").toLowerCase();
          if (!managerText.includes(ownerCompanyName.toLowerCase())) return false;
        }
        if (loc !== "All Locations" && r.location !== loc) return false;
        if (mgr !== "All Managers" && r.manager !== mgr) return false;

        const submittedDate = (r.submittedAt || "").slice(0, 10);
        if (dateFrom && submittedDate < dateFrom) return false;
        if (dateTo && submittedDate > dateTo) return false;

        if (q) {
          const haystack = [
            r.fullName,
            r.email,
            r.phone,
            r.location,
            r.manager,
            r.address,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          if (!haystack.includes(q)) return false;
        }

        return true;
      })
      .sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));
  }, [rows, loc, mgr, dateFrom, dateTo, search, authUser.role, ownerCompanyName]);

  const rowSelectionKey = (row: OnbRow) => row.id ? `id:${row.id}` : `local:${onbKey(row)}`;

  const visibleSelectionKeys = useMemo(
    () => displayRows.map(rowSelectionKey),
    [displayRows]
  );

  const allVisibleSelected = visibleSelectionKeys.length > 0 && visibleSelectionKeys.every(key => selectedKeys.has(key));
  const selectedCount = selectedKeys.size;

  const toggleRowSelection = (row: OnbRow) => {
    const key = rowSelectionKey(row);
    setSelectedKeys(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedKeys(current => {
      const next = new Set(current);
      if (allVisibleSelected) visibleSelectionKeys.forEach(key => next.delete(key));
      else visibleSelectionKeys.forEach(key => next.add(key));
      return next;
    });
  };

  const formatSubmitted = (value?: string) => {
    if (!value) return "Not provided";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  };

  const clearFilters = () => {
    setLoc("All Locations");
    setMgr("All Managers");
    setDateFrom("");
    setDateTo("");
    setSearch("");
  };

  const archiveSelectedRows = async () => {
    const rowsToArchive = rows.filter(row => selectedKeys.has(rowSelectionKey(row)));
    if (!rowsToArchive.length) {
      setBulkDeleteOpen(false);
      return;
    }

    setDeleting(true);
    setError("");
    try {
      const databaseRows = rowsToArchive.filter(row => row.id);
      const localRows = rowsToArchive.filter(row => !row.id);

      await Promise.all(databaseRows.map(row => archiveOnboardingApplication(row.id!)));

      if (localRows.length) {
        const deleted = new Set(loadOnbDeleted());
        localRows.forEach(row => deleted.add(onbKey(row)));
        saveOnbDeleted(Array.from(deleted));
        const localKeys = new Set(localRows.map(onbKey));
        saveLocalCandidates(loadLocalCandidates().filter(row => !localKeys.has(onbKey(row))));
      }

      const removedKeys = new Set(rowsToArchive.map(rowSelectionKey));
      setRows(current => current.filter(row => !removedKeys.has(rowSelectionKey(row))));
      if (selected && removedKeys.has(rowSelectionKey(selected))) setSelected(null);
      setSelectedKeys(new Set());
      setBulkDeleteOpen(false);
    } catch (e) {
      console.error("Failed to archive selected onboarding applications", e);
      setError("Could not remove the selected applications. Confirm the onboarding migration and your permissions are up to date.");
    } finally {
      setDeleting(false);
    }
  };

  const archiveRow = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError("");
    try {
      if (pendingDelete.id) {
        await archiveOnboardingApplication(pendingDelete.id);
      } else {
        const deleted = new Set(loadOnbDeleted());
        deleted.add(onbKey(pendingDelete));
        saveOnbDeleted(Array.from(deleted));
        saveLocalCandidates(loadLocalCandidates().filter(row => onbKey(row) !== onbKey(pendingDelete)));
      }
      const deletedSelectionKey = rowSelectionKey(pendingDelete);
      setRows(current => current.filter(row => row.id
        ? row.id !== pendingDelete.id
        : onbKey(row) !== onbKey(pendingDelete)));
      setSelectedKeys(current => {
        const next = new Set(current);
        next.delete(deletedSelectionKey);
        return next;
      });
      if (selected && ((selected.id && selected.id === pendingDelete.id) || onbKey(selected) === onbKey(pendingDelete))) {
        setSelected(null);
      }
      setPendingDelete(null);
    } catch (e) {
      console.error("Failed to archive onboarding application", e);
      setError("Could not remove this application. Confirm the onboarding migration and your permissions are up to date.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-white">Onboarding Management</h2>
        <p className="text-sm text-slate-400">
          View the information submitted by each applicant.
        </p>
        {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
        {importMessage && <p className="mt-1 text-xs text-emerald-300">{importMessage}</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={importGoogleSheet}
          disabled={importing}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {importing ? "Importing…" : "Import old Google Sheet"}
        </button>
        <span className="text-xs text-slate-500">Safe to run again—records already in Supabase are skipped.</span>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900/65 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Search</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Name, email, phone..."
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
            />
          </label>

          <Select value={loc} onChange={setLoc} label="Location">
            {locations.map(location => (
              <option key={location} value={location}>{location}</option>
            ))}
          </Select>

          <Select value={mgr} onChange={setMgr} label="Manager">
            {managers.map(manager => (
              <option key={manager} value={manager}>{manager}</option>
            ))}
          </Select>

          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </label>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            {loading ? "Loading applications..." : `${displayRows.length} application${displayRows.length === 1 ? "" : "s"}`}
          </div>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:bg-white/10"
          >
            Clear filters
          </button>
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-blue-400/20 bg-blue-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-medium text-blue-100">
            {selectedCount} applicant{selectedCount === 1 ? "" : "s"} selected
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedKeys(new Set())} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Clear selection</button>
            <button type="button" onClick={() => setBulkDeleteOpen(true)} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500">Delete Selected</button>
          </div>
        </div>
      )}

      <div className="mt-5 hidden overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 md:block">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-slate-400">
              <tr>
                <th className="w-12 px-4 py-3 text-left">
                  <input type="checkbox" aria-label="Select all visible applicants" checked={allVisibleSelected} onChange={toggleAllVisible} className="h-4 w-4 rounded border-white/20 bg-slate-950 accent-blue-600" />
                </th>
                {["Submitted", "Applicant", "Phone", "Email", "Location", "Manager", ""].map(header => (
                  <th key={header || "actions"} className="px-4 py-3 text-left font-normal whitespace-nowrap">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, index) => (
                <tr key={`${row.submittedAt}-${row.fullName}-${index}`} className="border-t border-white/5 hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <input type="checkbox" aria-label={`Select ${row.fullName || "applicant"}`} checked={selectedKeys.has(rowSelectionKey(row))} onChange={() => toggleRowSelection(row)} className="h-4 w-4 rounded border-white/20 bg-slate-950 accent-blue-600" />
                  </td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{formatSubmitted(row.submittedAt)}</td>
                  <td className="px-4 py-3 font-medium text-white whitespace-nowrap">{row.fullName || "Not provided"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.phone ? <a href={`tel:${row.phone}`} className="text-blue-300 hover:text-blue-200">{row.phone}</a> : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {row.email ? <a href={`mailto:${row.email}`} className="text-blue-300 hover:text-blue-200">{row.email}</a> : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{row.location || "—"}</td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{row.manager || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setSelected(row)}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(row)}
                        className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!loading && displayRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                    No applications match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:hidden">
        {displayRows.map((row, index) => (
          <article
            key={`mobile-${row.submittedAt}-${row.fullName}-${index}`}
            className="rounded-2xl border border-white/10 bg-slate-900/65 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <input type="checkbox" aria-label={`Select ${row.fullName || "applicant"}`} checked={selectedKeys.has(rowSelectionKey(row))} onChange={() => toggleRowSelection(row)} className="mt-1 h-4 w-4 shrink-0 rounded border-white/20 bg-slate-950 accent-blue-600" />
                <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-white">{row.fullName || "Unnamed applicant"}</h3>
                <p className="mt-1 text-xs text-slate-400">
                  {[row.location, row.manager].filter(Boolean).join(" • ") || "Location and manager not provided"}
                </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setSelected(row)}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(row)}
                  className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300"
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              {row.phone && (
                <a href={`tel:${row.phone}`} className="block truncate text-blue-300">
                  {row.phone}
                </a>
              )}
              {row.email && (
                <a href={`mailto:${row.email}`} className="block truncate text-blue-300">
                  {row.email}
                </a>
              )}
            </div>

            <div className="mt-4 border-t border-white/5 pt-3 text-xs text-slate-500">
              Submitted {formatSubmitted(row.submittedAt)}
            </div>
          </article>
        ))}

        {!loading && displayRows.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">
            No applications match the selected filters.
          </div>
        )}
      </div>

      {bulkDeleteOpen && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <button type="button" aria-label="Cancel bulk delete" className="absolute inset-0 bg-black/75" onClick={() => !deleting && setBulkDeleteOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-red-400/20 bg-slate-900 p-6 shadow-2xl">
            <p className="text-xs font-medium uppercase tracking-wider text-red-300">Delete selected applications</p>
            <h3 className="mt-2 text-xl font-semibold text-white">Remove {selectedCount} selected applicant{selectedCount === 1 ? "" : "s"}?</h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">Database records are archived instead of permanently erased, and the existing single-delete buttons will remain available.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" disabled={deleting} onClick={() => setBulkDeleteOpen(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50">Cancel</button>
              <button type="button" disabled={deleting} onClick={archiveSelectedRows} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">{deleting ? "Deleting…" : "Delete selected"}</button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cancel delete"
            className="absolute inset-0 bg-black/75"
            onClick={() => !deleting && setPendingDelete(null)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-red-400/20 bg-slate-900 p-6 shadow-2xl">
            <p className="text-xs font-medium uppercase tracking-wider text-red-300">Delete application</p>
            <h3 className="mt-2 text-xl font-semibold text-white">Remove {pendingDelete.fullName || "this applicant"}?</h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              This removes the row from the active onboarding list. Database records are archived instead of permanently erased, so an accidental deletion can be recovered later.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={archiveRow}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete application"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <button
            type="button"
            aria-label="Close application"
            className="absolute inset-0 bg-black/70"
            onClick={() => setSelected(null)}
          />

          <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-slate-900 p-5 shadow-2xl sm:max-w-2xl sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-blue-300">Applicant Information</p>
                <h3 className="mt-1 text-xl font-semibold text-white">{selected.fullName || "Unnamed applicant"}</h3>
                <p className="mt-1 text-xs text-slate-400">Submitted {formatSubmitted(selected.submittedAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <ApplicationDetail label="Full Name" value={selected.fullName} />
              <ApplicationDetail label="Phone Number" value={selected.phone} linkType="phone" />
              <ApplicationDetail label="Email Address" value={selected.email} linkType="email" />
              <ApplicationDetail label="Current Address" value={selected.address} />
              <ApplicationDetail label="Location Applying For" value={selected.location} />
              <ApplicationDetail label="Manager" value={selected.manager} />
              <ApplicationDetail label="Drug Test ZIP" value={selected.drugZip} />
              <ApplicationDetail label="Driver's License Number" value={selected.dlNumber} />
              <ApplicationDetail label="Driver's License Expiration" value={selected.dlExpiration} />
              <ApplicationDetail label="Birth Date" value={selected.birthDate} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function ApplicationDetail({
  label,
  value,
  linkType,
}: {
  label: string;
  value?: string;
  linkType?: "phone" | "email";
}) {
  const shown = value?.trim() || "Not provided";

  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      {value && linkType === "phone" ? (
        <a href={`tel:${value}`} className="mt-1 block break-words text-sm text-blue-300 hover:text-blue-200">
          {shown}
        </a>
      ) : value && linkType === "email" ? (
        <a href={`mailto:${value}`} className="mt-1 block break-words text-sm text-blue-300 hover:text-blue-200">
          {shown}
        </a>
      ) : (
        <div className="mt-1 break-words text-sm text-slate-100">{shown}</div>
      )}
    </div>
  );
}
export { OnboardingFormPage, OnboardingMgmtPage };
