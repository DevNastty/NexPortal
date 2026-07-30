import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";
import React from "react";
import Payroll from "./pages/payroll/Payroll";
import Dashboard from "./pages/Dashboard";
import MetricsPage from "./pages/Metrics";
import FtrHitsPage from "./pages/FTR";
import TNPSDashboard from "./pages/TNPS";
import TopNavigation from "./components/layout/TopNavigation";
import type { AuthUser, UserRole, ViewKey } from "./types/navigation";
import { OnboardingFormPage, OnboardingMgmtPage } from "./pages/Onboarding";
import AssetsPage from "./pages/Assets";
import TechnicianProfiles from "./pages/TechnicianProfiles";
import FormsCenter from "./pages/FormsCenter";
import DataUploads from "./pages/DataUploads";
import TechDashboard from "./pages/TechDashboard";
import MyForms from "./pages/MyForms";
import MyProfile from "./pages/MyProfile";
import { TimeOffRequestPage, TimeOffApprovalsPage } from "./pages/TimeOff";
import Administration, { type AdministrationSection } from "./pages/Administration";
import OnlineFeed from "./components/layout/OnlineFeed";
import ManagerGate from "./components/layout/ManagerGate";
import {
  loadCurrentPortalUser,
  onPortalAuthStateChange,
  sendPasswordResetCode,
  signInPortalUser,
  signOutPortalUser,
  updateOwnPassword,
  verifyPasswordResetCode,
} from "./lib/portalAuth";

/* =========================
   AUTH TYPES / CONFIG
   ========================= */
const ROLE_RANK: Record<string, number> = { tech: 0, bp_owner: 1, dispatcher: 2, supervisor: 3, director: 4 };

function hasRole(user: { role?: string } | null | undefined, min: "tech" | "bp_owner" | "dispatcher" | "supervisor" | "director") {
  return (ROLE_RANK[user?.role ?? ""] ?? -1) >= ROLE_RANK[min];
}

function defaultViewForRole(role: UserRole): ViewKey {
  return role === "director" || role === "tech" ? "dashboard" : "metrics";
}

function canAccessView(user: AuthUser | null, view: ViewKey): boolean {
  if (!user) return view === "onbForm";

  if (["metrics", "ftrHits", "tnps"].includes(view)) return true;
  if (view === "dashboard") return user.role === "director" || user.role === "tech";
  if (view === "timeOff") return true;
  if (view === "myForms") return user.role === "tech";
  if (view === "myProfile") return user.role === "tech";
  if (view === "timeOffApprovals") return user.role === "director" || (user.role === "supervisor" && Boolean(user.canApproveTimeOff));
  if (["onbForm", "onbMgmt"].includes(view)) return hasRole(user, "bp_owner");
  if (view === "techProfiles") return user.role === "bp_owner" || user.role === "supervisor" || user.role === "director";
  if (["assets", "formsCenter"].includes(view)) return user.role === "supervisor" || user.role === "director";
  if (view === "dataUploads") return user.role === "dispatcher" || user.role === "supervisor" || user.role === "director";
  if (["payroll", "adminCompanies", "adminLocations", "adminManagers", "adminUsers", "adminSettings"].includes(view)) return user.role === "director";

  return false;
}

/* =========================
   Region + Month → CSV paths
   ========================= */
const REGION_SLUGS: Record<string, string> = {
  Keystone: "keystone",
  Beltway: "beltway",
  Freedom: "freedom",
};

const METRICS_MONTHS = [
  "2025-11",
  "2025-12",
  "2026-1",
  "2026-2",
  "2026-3",
  "2026-4",
  "2026-5",
  "2026-6",
  "2026-7",
];

function getMetricsCsvUrl(region: string, monthKey: string) {
  const slug = REGION_SLUGS[region] ?? region.toLowerCase();
  return `/metrics/${slug}-${monthKey}.csv`;
}

/* =========================
   FTR Hits → CSV file paths
   ========================= */
const FTR_FILES: Record<string, string> = {
  Keystone: "/ftrhit/keystone.csv",
  Beltway: "/ftrhit/beltway.csv",
  Freedom: "/ftrhit/freedom.csv",
};

/* =========================
   PRESENCE — Who's Online
   ========================= */
const PRESENCE_API_URL =
  (import.meta as any)?.env?.VITE_PRESENCE_API_URL ||
  "https://script.google.com/macros/s/AKfycbz-n0wyT-JC8kXWM2QiwsdPOAlYWnv_jmmGWZ32AlsRMWPJHzjD6UCMrXFmOkA6EMV3/exec";

/* =========================
   tNPS — Files, Types, CSV helpers
   ========================= */
function tnps_detectDelim(line: string): string {
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  if (line.includes("|")) return "|";
  return ",";
}

function tnps_normHeader(h: string): string {
  return h.toLowerCase().trim().replace(/\s+/g, " ");
}

function tnps_splitCSVLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === delim && !inQuotes) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

type TNPSRow = {
  region: string;
  date?: string;
  tech_num?: string;
  score?: number;
  comment?: string;
};

const TNPS_HEADER_ALIASES: Record<string, keyof TNPSRow | "ignore"> = {
  "tech": "tech_num", "technician": "tech_num", "tech #": "tech_num",
  "tech#": "tech_num", "tech_num": "tech_num",
  "SMS tNPS": "score", "rating": "score", "nps": "score", "tnps": "score",
  "comment": "comment", "comments": "comment", "note": "comment",
  "notes": "comment", "verbatim": "comment", "feedback": "comment",
  "reason for score": "comment",
  "date": "date", "created at": "date", "createdat": "date", "submitted": "date",
  "id": "ignore", "ticket": "ignore", "workorder": "ignore", "customer": "ignore",
};

function tnps_parseCSV(text: string, region: string): TNPSRow[] {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  const lines: string[] = cleaned.split("\n").filter(l => l.trim().length);
  if (!lines.length) return [];

  const delim = tnps_detectDelim(lines[0]);
  const rawHeaders: string[] = tnps_splitCSVLine(lines[0], delim).map(tnps_normHeader);

  const mapIdx: (keyof TNPSRow | "ignore")[] = rawHeaders.map((h): keyof TNPSRow | "ignore" => {
    const alias = (TNPS_HEADER_ALIASES as Record<string, keyof TNPSRow | "ignore">)[h];
    if (alias) return alias;
    if (h.includes("reason for score")) return "comment";
    if (/(^|\b)(score|rating|nps|tnps)(\b|[\s(:])/i.test(h)) return "score";
    if (h.includes("tech")) return "tech_num";
    if (h.includes("comment") || h.includes("note") || h.includes("verbatim") || h.includes("feedback")) return "comment";
    if (h.includes("date") || h.includes("created") || h.includes("submitted")) return "date";
    return "ignore";
  });

  const out: TNPSRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells: string[] = tnps_splitCSVLine(lines[i], delim);
    const r: TNPSRow = { region };
    for (let c = 0; c < cells.length; c++) {
      const key = mapIdx[c];
      if (!key || key === "ignore") continue;
      const raw = (cells[c] ?? "").trim();
      switch (key) {
        case "tech_num": r.tech_num = raw; break;
        case "comment": r.comment = raw; break;
        case "date": r.date = raw; break;
        case "score": {
          const m = raw.match(/-?\d+([.,]\d+)?/);
          if (m) {
            let n = Number(m[0].replace(",", "."));
            if (!Number.isNaN(n)) {
              if (n > 10 && n <= 100) n = n / 10;
              if (n < 0) n = 0;
              if (n > 10) n = 10;
              r.score = n;
            }
          }
          break;
        }
      }
    }
    if (r.score != null || r.comment) out.push(r);
  }
  return out;
}

const TNPS_FILES: Record<string, string> = {
  Keystone: "/tNPS/Keystonetnps.csv",
  Beltway: "/tNPS/Beltwaytnps.csv",
  Freedom: "/tNPS/Freedomtnps.csv",
};

async function tnps_fetchRegion(region: string): Promise<TNPSRow[]> {
  const url = TNPS_FILES[region];
  if (!url) { console.warn("[tNPS] No URL for region:", region); return []; }
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      alert(`tNPS: couldn't load ${region} CSV (${res.status}). Check the file path:\n${url}`);
      return [];
    }
    const text = await res.text();
    const rows = tnps_parseCSV(text, region);
    if (!rows.length) alert(`tNPS: loaded 0 rows for ${region}. Check CSV headers.`);
    return rows;
  } catch (e) {
    console.error("[tNPS] Fetch error", e);
    alert(`tNPS: error loading ${region} CSV. Open console for details.`);
    return [];
  }
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

/* =========================
   CSV helpers — Metrics
   ========================= */
function detectDelimiter(line: string): string {
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  if (line.includes("|")) return "|";
  return ",";
}

const HEADER_ALIASES: Record<string, string> = {
  "techid": "tech_num", "tech id": "tech_num", "technician": "tech", "name": "tech",
  "total jobs": "jobs", "jobs": "jobs", "installs": "installs",
  "ftr%": "ftr_pct", "ftr rate": "ftr_pct", "tnps rate": "tnps_pct", "tnps%": "tnps_pct",
  "toolusage": "tool_use_pct", "tool usage": "tool_use_pct",
  "ftr_n": "ftr_n", "ftr_d": "ftr_d", "tnps_sum": "tnps_sum", "tnps_cnt": "tnps_cnt",
  "tool_use_n": "tool_use_n", "tool_use_d": "tool_use_d", "date": "date", "region": "region",
  "cb48_n": "cb48_n", "cb48_d": "cb48_d",
  "48hr cb%": "cb48_pct", "48hr callback%": "cb48_pct", "cb48%": "cb48_pct", "callback 48%": "cb48_pct",
  "48hr contact rate%": "cb48_pct", "48hr contact rate": "cb48_pct", "48 hr contact rate%": "cb48_pct",
};

const normalizeHeader = (h: string) => (h || "").trim().toLowerCase().replace(/\s+/g, " ");

function splitCsvLineWith(line: string, delim = ",") {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { q = !q; continue; }
    if (ch === delim && !q) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(csv: string) {
  const rawLines = csv.trim().split(/\r?\n/);
  if (!rawLines.length) return [];
  const headerLine = rawLines.shift() || "";
  const delim = detectDelimiter(headerLine);
  const header = headerLine.split(delim).map((s) => HEADER_ALIASES[normalizeHeader(s)] || normalizeHeader(s));
  const idx = (k: string) => header.indexOf(k);
  const has = (k: string) => idx(k) !== -1;

  for (const col of ["jobs", "installs"]) if (!has(col)) throw new Error(`Missing column: ${col}`);

  const isSimple = has("tech_num") && has("jobs") && has("installs");
  const lines = rawLines
    .filter(Boolean)
    .filter((line) => !/^\s*(?:#|\/)/.test(line))
    .map((line) => splitCsvLineWith(line, delim));

  if (isSimple) {
    return lines.map((c) => {
      const get = (k: string, def: any = "") => (has(k) ? c[idx(k)] : def);
      const techNum = get("tech_num");
      const isTotals = /totals?/i.test(String(techNum || c[0] || ""));
      const jobs = +get("jobs", 0) || 0;
      const installs = +get("installs", 0) || 0;
      let toolUseN = +(get("tool_use_n", 0) || 0);
      let toolUseD = +(get("tool_use_d", 0) || 0);
      const toolPct = get("tool_use_pct");
      if (toolPct !== "" && !isNaN(+toolPct)) {
        // Store as (pct/100)*jobs / jobs so ratioPct() gives correct weighted avg
        toolUseN = isTotals ? (+toolPct / 100) * jobs : +toolPct;
        toolUseD = isTotals ? jobs : 100;
      }
      let tnpsSum = +(get("tnps_sum", 0) || 0);
      let tnpsCount = +(get("tnps_cnt", 0) || 0);
      const tnpsPct = get("tnps_pct");
      if (tnpsPct !== "" && !isNaN(+tnpsPct)) {
        // avg() just divides sum/count, so pct*jobs / jobs = pct — works correctly
        tnpsSum = isTotals ? +tnpsPct * jobs : +tnpsPct;
        tnpsCount = isTotals ? jobs : 1;
      }
      let ftrNumerator = +(get("ftr_n", 0) || 0);
      let ftrDenominator = +(get("ftr_d", 0) || 0);
      const ftrPct = get("ftr_pct");
      if (ftrPct !== "" && !isNaN(+ftrPct)) {
        ftrNumerator = isTotals ? (+ftrPct / 100) * jobs : +ftrPct;
        ftrDenominator = isTotals ? jobs : 100;
      }
      let cb48N = +(get("cb48_n", 0) || 0);
      let cb48D = +(get("cb48_d", 0) || 0);
      const cb48Pct = get("cb48_pct");
      if (cb48Pct !== "" && !isNaN(+cb48Pct)) {
        cb48N = isTotals ? (+cb48Pct / 100) * jobs : +cb48Pct;
        cb48D = isTotals ? jobs : 100;
      }
      return {
        date: `${currentMonthKey()}-01`, noDate: true, tech: "", techNum,
        region: get("region", "All Regions") || "All Regions",
        jobs, installs, ftrNumerator, ftrDenominator, tnpsSum, tnpsCount, toolUseN, toolUseD, cb48N, cb48D,
        isTotals,
      } as any;
    });
  }

  return lines
    .filter((cols) => !/totals?/i.test(String(cols[0] || "")))
    .map((c) => {
    const get = (k: string, def: any = "") => (has(k) ? c[header.indexOf(k)] : def);
    return {
      date: get("date") || `${currentMonthKey()}-01`, noDate: !has("date"),
      tech: get("tech"), techNum: get("tech_num"),
      region: get("region", "All Regions") || "All Regions",
      jobs: +get("jobs", 0) || 0, installs: +get("installs", 0) || 0,
      ftrNumerator: +get("ftr_n", 0) || 0, ftrDenominator: +get("ftr_d", 0) || 0,
      tnpsSum: +get("tnps_sum", 0) || 0, tnpsCount: +get("tnps_cnt", 0) || 0,
      toolUseN: +get("tool_use_n", 0) || 0, toolUseD: +get("tool_use_d", 0) || 0,
      cb48N: +get("cb48_n", 0) || 0, cb48D: +get("cb48_d", 0) || 0,
    } as any;
  });
}

/* =========================
   Data loading (cache-busted)
   ========================= */
async function fetchText(url: string) {
  const buildId = (import.meta as any)?.env?.VITE_BUILD_ID ?? Date.now();
  const u = url.includes("?") ? `${url}&v=${buildId}` : `${url}?v=${buildId}`;
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${u}: ${res.status}`);
  return await res.text();
}

type MetricsCsvLoad = { text: string; lastModified: string | null };

async function fetchMetricsText(url: string): Promise<MetricsCsvLoad> {
  const buildId = (import.meta as any)?.env?.VITE_BUILD_ID ?? Date.now();
  const u = url.includes("?") ? `${url}&v=${buildId}` : `${url}?v=${buildId}`;
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${u}: ${res.status}`);
  return {
    text: await res.text(),
    lastModified: res.headers.get("last-modified"),
  };
}

async function loadRegionCsv(region: string, monthKey: string): Promise<MetricsCsvLoad> {
  if (region === "All Regions") {
    const pairs = Object.entries(REGION_SLUGS);
    const results = await Promise.allSettled(
      pairs.map(([display]) => fetchMetricsText(getMetricsCsvUrl(display, monthKey)))
    );
    let header: string | null = null;
    let latestModified: string | null = null;
    const mergedRows: string[] = [];
    results.forEach((res, i) => {
      if (res.status !== "fulfilled") return;
      const text = (res.value.text || "").trim();
      if (!text) return;
      if (res.value.lastModified) {
        const next = new Date(res.value.lastModified);
        const current = latestModified ? new Date(latestModified) : null;
        if (!current || next > current) latestModified = res.value.lastModified;
      }
      const [h, ...rows] = text.split(/\r?\n/);
      if (!header) header = h;
      rows.forEach((r) => { if (r) mergedRows.push(`${r},${pairs[i][0]}`); });
    });
    if (!header) return { text: "", lastModified: latestModified };
    const hasRegion = (header as string).toLowerCase().split(/[,\t;|]/).map(s => s.trim()).includes("region");
    return { text: [(hasRegion ? header : header + ",region"), ...mergedRows].join("\n"), lastModified: latestModified };
  }

  const url = getMetricsCsvUrl(region, monthKey);
  try {
    const loaded = await fetchMetricsText(url);
    const text = loaded.text.trim();
    if (!text) return { text: "", lastModified: loaded.lastModified };
    const lines = text.split(/\r?\n/);
    const hasRegion = (lines[0] ?? "").toLowerCase().split(/[,\t;|]/).map(s => s.trim()).includes("region");
    if (hasRegion) return { text, lastModified: loaded.lastModified };
    const [h, ...rows] = lines;
    return { text: [h + ",region", ...rows.map(r => r && r.trim() ? `${r},${region}` : r)].join("\n"), lastModified: loaded.lastModified };
  } catch (e) {
    console.error("Failed to load metrics CSV:", e);
    return { text: "", lastModified: null };
  }
}

/* =========================
   Utils
   ========================= */
function currentMonthKey() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; }
function ymKey(dateStr: string) { const d = new Date(dateStr); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function prettyMonth(key: string) { const [y, m] = key.split("-"); return new Date(+y, +m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" }); }
function pct(n: number, d: number) { if (!d) return 0; return Math.round((n / d) * 1000) / 10; }
function ratioPct(n: number, d: number) { const v = pct(n, d); return isNaN(v as any) ? 0 : v; }
function avg(sum: number, count: number) { if (!count) return 0; return Math.round((sum / count) * 10) / 10; }
function formatValue(v: any) { return typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(1)) : v; }
function spark(values: number[]) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return "";
  const min = Math.min(...finite), max = Math.max(...finite);
  const norm = finite.map((v) => (max === min ? 0.5 : (v - min) / (max - min)));
  const pts = norm.map((v, i) => `${(i / (finite.length - 1)) * 100},${24 - v * 20}`);
  return `M ${pts[0]} L ${pts.slice(1).join(" ")}`;
}
function getMgmtPin() { return (import.meta as any)?.env?.VITE_MGMT_PIN || "2468"; }

/* =========================
   ONBOARDING — Types & Storage
   ========================= */
type OnbRow = {
  location?: string; manager?: string; fullName?: string; address?: string;
  email?: string; phone?: string; drugZip?: string; dlNumber?: string;
  dlExpiration?: string; birthDate?: string; techNum?: string; region?: string;
  startDate?: string; bg?: string; drug?: string; paperwork?: boolean;
  credentials?: boolean; tools?: boolean; truck?: boolean; meter?: boolean;
  mentor?: string; notes?: string; submittedAt?: string;
};

const ONB_LOCAL_KEY = "nexportal_onboarding_candidates_v1";
const ONB_DELETED_KEY = "nexportal_onboarding_deleted_v1";

function loadLocalCandidates(): OnbRow[] {
  try { return JSON.parse(localStorage.getItem(ONB_LOCAL_KEY) || "[]"); } catch { return []; }
}
function saveLocalCandidates(rows: OnbRow[]) {
  localStorage.setItem(ONB_LOCAL_KEY, JSON.stringify(rows));
}
function loadOnbDeleted(): string[] {
  try { return JSON.parse(localStorage.getItem(ONB_DELETED_KEY) || "[]"); } catch { return []; }
}
function saveOnbDeleted(list: string[]) {
  try { localStorage.setItem(ONB_DELETED_KEY, JSON.stringify(list)); } catch { }
}
function onbKey(r: OnbRow): string {
  return [r.location || "", r.manager || "", r.fullName || "", r.submittedAt || ""].join("|");
}
function toBool(v: any) { return ["y", "yes", "true", "1", "done", "complete"].includes(String(v || "").toLowerCase()); }
function normalize(h: string) { return (h || "").trim().toLowerCase().replace(/\s+/g, " "); }

const ONB_ALIASES: Record<string, string> = {
  "location": "location", "location applying for": "location",
  "manager": "manager", "manager name": "manager",
  "name": "full_name", "full name": "full_name",
  "address": "address", "current address": "address",
  "email": "email", "email address": "email",
  "phone": "phone", "phone number": "phone",
  "zip code for drug test": "drug_zip", "drug zip": "drug_zip",
  "driver's license number": "dl_number", "drivers license number": "dl_number", "dl number": "dl_number",
  "driver's license expiration date": "dl_exp", "drivers license expiration date": "dl_exp", "dl expiration": "dl_exp",
  "birthdate": "birth_date", "birth date": "birth_date",
  "bg": "bg", "drug": "drug", "paperwork": "paperwork",
  "credentials": "credentials", "creds": "credentials",
  "tools": "tools", "truck": "truck", "vehicle": "truck", "meter": "meter",
  "mentor": "mentor", "notes": "notes",
};

/* =========================
   Onboarding → Google Sheet
   ========================= */
const ONB_API_URL =
  (import.meta as any)?.env?.VITE_ONB_API_URL ||
  "https://script.google.com/macros/s/AKfycbzmjtEk8kgu3CNoJ6dFPP6mudAtI7p31R4lAPnwb_88lo0E_k0Xwm-AQfzRs87U7kAuJQ/exec";

async function sendOnboardingToSheet(row: OnbRow) {
  if (!ONB_API_URL) return;
  try {
    await fetch(ONB_API_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ candidate: row }) });
  } catch (err) { console.error("Failed to send onboarding to Sheet", err); }
}

const ONB_SHEET_CSV_URL =
  (import.meta as any)?.env?.VITE_ONB_SHEET_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSfB75pE7p-8EaCs_zR1APkHsJoKz_8D36ZDi-LrSZqZm3SI3kGT1iL-jaH70TzB24tFnTJl_fud_uJ/pub?gid=1034762031&single=true&output=csv";

function splitCsvRow(row: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    const next = row[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);

  return result.map(v => v.trim());
}

function parseOnbCsvToRows(csv: string): OnbRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];

  return lines.slice(1).map(line => {
    const cols = splitCsvRow(line);

    return {
      location: cols[1] || "",
      manager: cols[2] || "",
      fullName: cols[3] || "",
      address: cols[4] || "",
      email: cols[5] || "",
      phone: cols[6] || "",
      drugZip: cols[7] || "",
      dlNumber: cols[8] || "",
      dlExpiration: cols[9] || "",
      birthDate: cols[10] || "",
      bg: cols[11] || "pending",
      drug: cols[12] || "pending",
      paperwork: /^true$/i.test(cols[13] || ""),
      credentials: /^true$/i.test(cols[14] || ""),
      tools: /^true$/i.test(cols[15] || ""),
      truck: /^true$/i.test(cols[16] || ""),
      meter: /^true$/i.test(cols[17] || ""),
      mentor: cols[18] || "",
      notes: cols[19] || "",
      submittedAt: cols[20] || cols[0] || "",
    };
  });
}

/* =========================
   FTR CSV parser
   ========================= */
type FtrHitRow = {
  techId: string; order1Date: string; order2Date: string; daysBetween: number;
  order1Job: string; order2Job: string; order1Code: string; order2Code: string;
  order1TIH?: number; order2TIH?: number;
};

function parseFtrCsv(csv: string): FtrHitRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  const delim = detectDelimiter(lines[0]);
  const headers = lines[0].split(delim).map(h => (h || "").trim().toLowerCase().replace(/\s+/g, " "));
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
    const daysBetween = Number(get(idxDays)) || 0;
    const row: FtrHitRow = {
      techId: get(idxTech), order1Date: get(idxO1Date), order2Date: get(idxO2Date),
      daysBetween, order1Job: get(idxO1Job), order2Job: get(idxO2Job),
      order1Code: get(idxO1Code), order2Code: get(idxO2Code),
    };
    const o1t = get(idxO1TIH), o2t = get(idxO2TIH);
    if (o1t) row.order1TIH = Number(o1t) || 0;
    if (o2t) row.order2TIH = Number(o2t) || 0;
    if (row.techId && row.daysBetween <= 30 && row.daysBetween >= 0) out.push(row);
  }
  return out;
}

/* =========================
   Rollup helpers
   ========================= */
function summarize(rows: any[]) {
  return rows.reduce((a, r) => ({
    jobs: a.jobs + r.jobs, installs: a.installs + r.installs,
    ftrNumerator: a.ftrNumerator + r.ftrNumerator, ftrDenominator: a.ftrDenominator + r.ftrDenominator,
    tnpsSum: a.tnpsSum + r.tnpsSum, tnpsCount: a.tnpsCount + r.tnpsCount,
    toolUseN: a.toolUseN + (r.toolUseN || 0), toolUseD: a.toolUseD + (r.toolUseD || 0),
    cb48N: a.cb48N + (r.cb48N || 0), cb48D: a.cb48D + (r.cb48D || 0),
  }), { jobs: 0, installs: 0, ftrNumerator: 0, ftrDenominator: 0, tnpsSum: 0, tnpsCount: 0, toolUseN: 0, toolUseD: 0, cb48N: 0, cb48D: 0 });
}
function rollupByDate(rows: any[]) {
  const dates = Array.from(new Set(rows.map(r => r.date))).sort();
  return dates.map(d => ({ date: d, ...summarize(rows.filter(r => r.date === d)) }));
}
function rollupByTech(rows: any[]) {
  return Array.from(new Set(rows.map(r => String(r.techNum || r.tech || "")))).filter(Boolean)
    .map(k => {
      const part = rows.filter(r => String(r.techNum || r.tech || "") === k);
      return {
        tech: (part[0] || {}).tech || "",
        techNum: (part[0] || {}).techNum || "",
        region: (part[0] || {}).region || "",
        ...summarize(part),
      };
    })
    .sort((a, b) => String(a.techNum).localeCompare(String(b.techNum)));
}

function denseRank(values: number[], higherIsBetter = true): number[] {
  const unique = Array.from(new Set(values.filter(Number.isFinite)))
    .sort((a, b) => higherIsBetter ? b - a : a - b);
  const rankMap = new Map(unique.map((value, index) => [value, index + 1]));
  return values.map(value => rankMap.get(value) ?? unique.length + 1);
}

type StackRankingRow = {
  rank: number;
  weightedScore: number;
  techNum: string;
  tech: string;
  region: string;
  jobs: number;
  installs: number;
  toolUsage: number;
  toolRank: number;
  tnps: number;
  tnpsRank: number;
  ftr: number;
  ftrRank: number;
};

function buildStackRankings(rows: any[]): StackRankingRow[] {
  const techRows = rollupByTech(rows).filter(t => String(t.techNum || t.tech || "").trim());
  const toolValues = techRows.map(t => ratioPct(t.toolUseN, t.toolUseD));
  const tnpsValues = techRows.map(t => avg(t.tnpsSum, t.tnpsCount));
  const ftrValues = techRows.map(t => ratioPct(t.ftrNumerator, t.ftrDenominator));

  const toolRanks = denseRank(toolValues, true);
  const tnpsRanks = denseRank(tnpsValues, true);
  const ftrRanks = denseRank(ftrValues, true);

  const scored = techRows.map((t, index) => ({
    rank: 0,
    weightedScore: Number((toolRanks[index] * 0.30 + tnpsRanks[index] * 0.35 + ftrRanks[index] * 0.35).toFixed(2)),
    techNum: String(t.techNum || ""),
    tech: String(t.tech || ""),
    region: String(t.region || ""),
    jobs: t.jobs,
    installs: t.installs,
    toolUsage: toolValues[index],
    toolRank: toolRanks[index],
    tnps: tnpsValues[index],
    tnpsRank: tnpsRanks[index],
    ftr: ftrValues[index],
    ftrRank: ftrRanks[index],
  }));

  scored.sort((a, b) =>
    a.weightedScore - b.weightedScore ||
    b.ftr - a.ftr ||
    b.tnps - a.tnps ||
    b.toolUsage - a.toolUsage ||
    a.techNum.localeCompare(b.techNum)
  );

  let lastScore: number | null = null;
  let currentRank = 0;
  scored.forEach((row, index) => {
    if (lastScore === null || row.weightedScore !== lastScore) currentRank = index + 1;
    row.rank = currentRank;
    lastScore = row.weightedScore;
  });

  return scored;
}

/* =========================
   UI (App)
   ========================= */
/* =========================
   PRESENCE / WHO'S ONLINE
   ========================= */
type OnlineUser = {
  username: string;
  displayName: string;
  role: "tech" | "manager" | string;
  lastSeen: string;
};

function getAuthRedirectMode(): "invite" | "recovery" | null {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const action = query.get("auth_action");
  const type = query.get("type") || hash.get("type");

  if (query.get("setup") === "1" || action === "invite" || type === "invite") return "invite";
  if (query.get("reset") === "1" || type === "recovery") return "recovery";
  return null;
}

function getAuthRedirectError(): string | null {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return query.get("error_description") || hash.get("error_description");
}









export default function App() {
  const [region, setRegion] = useState("Keystone");
  const [rows, setRows] = useState<any[]>([]);
  const [dashboardMetricsByRegion, setDashboardMetricsByRegion] = useState<Record<string, any>>({});
  const [dashboardMetricMonth, setDashboardMetricMonth] = useState("");
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [selectedTechNum, setSelectedTechNum] = useState("All Techs");
  const [monthFilter, setMonthFilter] = useState(currentMonthKey());
  const [loading, setLoading] = useState(false);
  const [metricsUpdatedAt, setMetricsUpdatedAt] = useState<string | null>(null);

  const [view, setView] = useState<ViewKey>("dashboard");

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "forgot" | "verify" | "newPassword">("login");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [isManager, setIsManager] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem("nexportal_is_manager") === "1";
  });
  const [showMgrLock, setShowMgrLock] = useState(false);

  // Auto-set manager flag when manager OR director logs in
  useEffect(() => {
    if (hasRole(authUser, "bp_owner")) {
      setIsManager(true);
      localStorage.setItem("nexportal_is_manager", "1");
    }
  }, [authUser]);

  // Supabase Auth is the only portal login source.
  useEffect(() => {
    let cancelled = false;

    const applySession = async () => {
      try {
        const user = await loadCurrentPortalUser();
        if (!cancelled) {
  setAuthUser(user);

  const redirectError = getAuthRedirectError();
  const redirectMode = getAuthRedirectMode();

  if (redirectError) {
    setAuthError(redirectError);
  }
  if (redirectMode) {
    setAuthMode("newPassword");
  } else if (user) {
    setView(defaultViewForRole(user.role));
  }
}
      } catch (error) {
        if (!cancelled) setAuthError(error instanceof Error ? error.message : "Unable to load your account.");
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    };

    void applySession();
    const unsubscribe = onPortalAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setAuthMode("newPassword");
      if (!session) {
        setAuthUser(null);
        setAuthReady(true);
        return;
      }
      void loadCurrentPortalUser(session)
        .then(user => {
          if (!cancelled) {
            setAuthUser(user);
            if (getAuthRedirectMode()) {
              setAuthMode("newPassword");
            }
          }
        })
        .catch(error => !cancelled && setAuthError(error instanceof Error ? error.message : "Unable to load your account."));
    });

    return () => { cancelled = true; unsubscribe(); };
  }, []);

  // Keep every role inside its approved workspace.
  useEffect(() => {
    if (!authUser) {
      if (view !== "onbForm") setView("onbForm");
      return;
    }

    if (!canAccessView(authUser, view)) {
      setView(defaultViewForRole(authUser.role));
    }
  }, [authUser, view]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const next = await signInPortalUser(loginEmail, loginPassword);
      setAuthUser(next);
      setLoginEmail("");
      setLoginPassword("");
      setView(defaultViewForRole(next.role));

    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setAuthLoading(false);
    }
  };

  const requestResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      await sendPasswordResetCode(resetEmail);
      setAuthMode("verify");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to send the reset code.");
    } finally { setAuthLoading(false); }
  };

  const verifyResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      await verifyPasswordResetCode(resetEmail, resetCode);
      setAuthMode("newPassword");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "The verification code is invalid or expired.");
    } finally { setAuthLoading(false); }
  };

  const saveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (newPassword.length < 8) {
      setAuthError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setAuthError("The passwords do not match.");
      return;
    }
    setAuthLoading(true);
    try {
      await updateOwnPassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setResetCode("");
      setAuthMode("login");
      window.history.replaceState({}, "", window.location.pathname);
      const next = await loadCurrentPortalUser();
      setAuthUser(next);
      if (next) setView(defaultViewForRole(next.role));
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to save your new password.");
    } finally { setAuthLoading(false); }
  };

  const handleLogout = async () => {
    try { await signOutPortalUser(); } catch { /* session is cleared locally below */ }
    setAuthUser(null);
    try { localStorage.removeItem("nexportal_is_manager"); } catch { }
    setIsManager(false);
    setView("onbForm");
  };

  // Load metrics CSV
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const loaded = await loadRegionCsv(region, monthFilter);
        if (loaded.text) {
          setRows(parseCsv(loaded.text));
          setMetricsUpdatedAt(loaded.lastModified);
        } else {
          setRows(parseCsv(sampleCsv));
          setMetricsUpdatedAt(null);
        }
      } finally { setLoading(false); }
    })();
  }, [region, monthFilter]);

  // The Dashboard always loads the newest reporting month directly from Supabase.
  useEffect(() => {
    if (!authUser || authUser.role !== "director") return;
    let cancelled = false;

    async function loadDashboardMetrics() {
      setDashboardLoading(true);
      try {
        const importMonthResult = await supabase
          .from("portal_data_imports")
          .select("month_key")
          .eq("data_type", "metrics")
          .eq("status", "completed")
          .not("month_key", "is", null)
          .order("month_key", { ascending: false })
          .limit(1);

        let newestMonth = "";

        if (!importMonthResult.error) {
          newestMonth = String(importMonthResult.data?.[0]?.month_key || "");
        }

        // Compatibility fallback for older imports that predate the import log.
        if (!newestMonth) {
          const rowMonthResult = await supabase
            .from("portal_metric_rows")
            .select("month_key")
            .not("month_key", "is", null)
            .order("month_key", { ascending: false })
            .limit(1);

          if (rowMonthResult.error) throw rowMonthResult.error;
          newestMonth = String(rowMonthResult.data?.[0]?.month_key || "");
        }

        if (!newestMonth) {
          if (!cancelled) {
            setDashboardMetricMonth("");
            setDashboardMetricsByRegion({});
          }
          return;
        }

        const rowsResult = await supabase
          .from("portal_metric_rows")
          .select("region,jobs,installs,ftr_n,ftr_d,tnps_sum,tnps_cnt,tool_use_n,tool_use_d,is_totals")
          .eq("month_key", newestMonth);

        if (rowsResult.error) throw rowsResult.error;
        const sourceRows = rowsResult.data || [];
        const numberValue = (value: unknown) => {
          const parsed = Number(value ?? 0);
          return Number.isFinite(parsed) ? parsed : 0;
        };
        const summarizeRows = (items: any[]) => items.reduce((total, row) => ({
          jobs: total.jobs + numberValue(row.jobs),
          installs: total.installs + numberValue(row.installs),
          ftrNumerator: total.ftrNumerator + numberValue(row.ftr_n),
          ftrDenominator: total.ftrDenominator + numberValue(row.ftr_d),
          tnpsSum: total.tnpsSum + numberValue(row.tnps_sum),
          tnpsCount: total.tnpsCount + numberValue(row.tnps_cnt),
          toolUseN: total.toolUseN + numberValue(row.tool_use_n),
          toolUseD: total.toolUseD + numberValue(row.tool_use_d),
        }), { jobs: 0, installs: 0, ftrNumerator: 0, ftrDenominator: 0, tnpsSum: 0, tnpsCount: 0, toolUseN: 0, toolUseD: 0 });
        const summaryFor = (regionName: string) => {
          const scoped = sourceRows.filter((row: any) => regionName === "All Regions" || String(row.region || "").trim().toLowerCase() === regionName.toLowerCase());
          const detail = scoped.filter((row: any) => !row.is_totals);
          const totals = scoped.filter((row: any) => row.is_totals);
          return summarizeRows(totals.length ? totals : detail);
        };

        if (!cancelled) {
          setDashboardMetricMonth(newestMonth);
          setDashboardMetricsByRegion({
            "All Regions": summaryFor("All Regions"),
            Keystone: summaryFor("Keystone"),
            Beltway: summaryFor("Beltway"),
            Freedom: summaryFor("Freedom"),
          });
        }
      } catch (error) {
        console.error("Unable to load dashboard metrics", error);
        if (!cancelled) {
          setDashboardMetricMonth("");
          setDashboardMetricsByRegion({});
        }
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    }

    void loadDashboardMetrics();
    return () => { cancelled = true; };
  }, [authUser?.userId, authUser?.role]);

  const months = useMemo(() => [...METRICS_MONTHS].sort().reverse(), []);
  useEffect(() => {
    if (months.length && !months.includes(monthFilter)) setMonthFilter(months[0]);
  }, [months]);

  const numsForRegion = useMemo(() => {
    const norm = (v: any) => String(v ?? "").trim().toLowerCase();
    const sub = rows.filter(r => !r.isTotals && (region === "All Regions" ? true : norm(r.region) === norm(region)));
    const msub = sub.filter(r => { try { return ymKey(r.date) === monthFilter; } catch { return true; } });
    return Array.from(new Set((msub.length ? msub : sub).map(r => r.techNum).filter(Boolean)));
  }, [rows, region, monthFilter]);

  const filtered = useMemo(() => {
    const norm = (v: any) => String(v ?? "").trim().toLowerCase();
    const hasRealDates = rows.some(r => r.date && !r.noDate);
    return rows.filter(r => {
      const regionOk = region === "All Regions" ? true : norm(r.region || "All Regions") === norm(region);
      let monthOk = true;
      if (hasRealDates) { try { monthOk = ymKey(r.date) === monthFilter; } catch { monthOk = true; } }
      const techOk = selectedTechNum === "All Techs" || String(r.techNum || "") === String(selectedTechNum);
      return regionOk && monthOk && techOk;
    });
  }, [rows, selectedTechNum, monthFilter, region]);

  const nonTotalsFiltered = useMemo(() => filtered.filter(r => !r.isTotals), [filtered]);
  const totalsFiltered = useMemo(() => filtered.filter(r => r.isTotals), [filtered]);
  const daily = useMemo(() => rollupByDate(nonTotalsFiltered), [nonTotalsFiltered]);
  const byTech = useMemo(() => rollupByTech(nonTotalsFiltered), [nonTotalsFiltered]);
  const stackRankings = useMemo(() => buildStackRankings(nonTotalsFiltered), [nonTotalsFiltered]);
  const totals = useMemo(() => summarize(totalsFiltered.length ? totalsFiltered : nonTotalsFiltered), [totalsFiltered, nonTotalsFiltered]);


  useEffect(() => {
    if (region === "All Regions" && selectedTechNum !== "All Techs") {
      setSelectedTechNum("All Techs");
    }
  }, [region, selectedTechNum]);

  return (
    <div className="min-h-screen nexportal-shell bg-[radial-gradient(circle_at_12%_-8%,_rgba(37,208,255,0.18),_transparent_28%),radial-gradient(circle_at_88%_4%,_rgba(139,92,246,0.14),_transparent_24%),linear-gradient(to_bottom,_#050b14,_#081425_50%,_#050b14)] text-slate-100 pb-14">
      <TopNavigation
        view={view}
        onNavigate={setView}
        isManager={isManager}
        authUser={authUser}
        onLogout={handleLogout}
      />

      {authUser?.role === "director" && view === "dashboard" && (
        <Dashboard
          authUser={authUser}
          onNavigate={setView}
          metricsByRegion={dashboardMetricsByRegion}
          metricMonth={dashboardMetricMonth}
          metricsLoading={dashboardLoading}
        />
      )}

      {authUser?.role === "tech" && view === "dashboard" && (
        <TechDashboard authUser={authUser} onNavigate={setView} />
      )}

      {/* Supabase Auth */}
      {authReady && (!authUser || authMode === "newPassword") && (
        <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-[1.1fr_.9fr]">
        <div className="hidden lg:block">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,.9)]" /> BPS Demo Environment
          </div>
          <h1 className="mt-6 max-w-xl text-5xl font-black leading-[1.02] tracking-[-0.05em] text-white xl:text-6xl">Field operations, <span className="bg-gradient-to-r from-cyan-300 via-blue-400 to-violet-400 bg-clip-text text-transparent">finally connected.</span></h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-slate-400">NexPortal brings performance, onboarding, assets, forms, payroll, and workforce insights into one modern command center.</p>
          <div className="mt-8 grid max-w-xl grid-cols-3 gap-3">
            {[['Live','Metrics'],['One','Workspace'],['Role-based','Access']].map(([value,label]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-xl shadow-black/10"><div className="text-sm font-bold text-white">{value}</div><div className="mt-1 text-[11px] text-slate-500">{label}</div></div>)}
          </div>
        </div>
        <div className="w-full max-w-md justify-self-center lg:justify-self-end">
          {!authUser && authMode === "login" && (
            <form onSubmit={handleLoginSubmit} className="space-y-4 rounded-[28px] border border-white/10 bg-slate-900/70 p-7 shadow-[0_28px_80px_rgba(0,0,0,.38)] backdrop-blur-2xl">
              <div>
                <div className="text-lg font-semibold text-white">Sign in</div>
                <div className="mt-1 text-xs text-slate-400">Use the email address from your portal invitation.</div>
              </div>
              {authError && <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">{authError}</div>}
              <label className="block text-xs text-slate-300">Email
                <input type="email" required className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} autoComplete="email" />
              </label>
              <label className="block text-xs text-slate-300">Password
                <input type="password" required className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} autoComplete="current-password" />
              </label>
              <button type="submit" disabled={authLoading} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{authLoading ? "Signing in…" : "Sign in"}</button>
              <button type="button" onClick={() => { setAuthError(null); setResetEmail(loginEmail); setAuthMode("forgot"); }} className="w-full text-xs text-blue-300 hover:text-blue-200">Forgot password?</button>
            </form>
          )}

          {!authUser && authMode === "forgot" && (
            <form onSubmit={requestResetCode} className="space-y-4 rounded-[28px] border border-white/10 bg-slate-900/70 p-7 shadow-[0_28px_80px_rgba(0,0,0,.38)] backdrop-blur-2xl">
              <div><div className="text-lg font-semibold">Reset password</div><div className="mt-1 text-xs text-slate-400">We’ll email a verification code before allowing a password change.</div></div>
              {authError && <div className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-200">{authError}</div>}
              <input type="email" required placeholder="Email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm" />
              <button disabled={authLoading} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{authLoading ? "Sending…" : "Send verification code"}</button>
              <button type="button" onClick={() => setAuthMode("login")} className="w-full text-xs text-slate-400">Back to sign in</button>
            </form>
          )}

          {!authUser && authMode === "verify" && (
            <form onSubmit={verifyResetCode} className="space-y-4 rounded-[28px] border border-white/10 bg-slate-900/70 p-7 shadow-[0_28px_80px_rgba(0,0,0,.38)] backdrop-blur-2xl">
              <div><div className="text-lg font-semibold">Verify your code</div><div className="mt-1 text-xs text-slate-400">Enter the code sent to {resetEmail}.</div></div>
              {authError && <div className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-200">{authError}</div>}
              <input inputMode="numeric" required placeholder="Verification code" value={resetCode} onChange={e => setResetCode(e.target.value.replace(/\D/g, ""))} className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-center text-xl tracking-[0.35em]" />
              <button disabled={authLoading} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{authLoading ? "Verifying…" : "Verify code"}</button>
              <button type="button" onClick={() => void sendPasswordResetCode(resetEmail)} className="w-full text-xs text-blue-300">Send a new code</button>
            </form>
          )}

          {authMode === "newPassword" && (
  <form
    onSubmit={saveNewPassword}
    className="space-y-4 rounded-[28px] border border-white/10 bg-slate-900/75 p-7 shadow-[0_28px_80px_rgba(0,0,0,.38)] backdrop-blur-2xl"
  >
    <div>
      <div className="text-lg font-semibold text-white">
        {getAuthRedirectMode() === "invite"
          ? "Create your password"
          : "Choose a new password"}
      </div>

      <div className="mt-1 text-xs text-slate-400">
        Use at least 8 characters. You will use this password to sign in to
        the NexPortal.
      </div>
    </div>

    {authError && (
      <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
        {authError}
      </div>
    )}

    <label className="block text-xs text-slate-300">
      New password
      <input
        type="password"
        minLength={8}
        required
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        autoComplete="new-password"
        className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500"
      />
    </label>

    <label className="block text-xs text-slate-300">
      Confirm password
      <input
        type="password"
        minLength={8}
        required
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        autoComplete="new-password"
        className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500"
      />
    </label>

    <button
      disabled={authLoading}
      className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
    >
      {authLoading ? "Saving…" : "Save password"}
    </button>
  </form>
)}
        </div>
        </div>
      )}

      {!authReady && <div className="mx-auto max-w-md px-6 pt-10 text-center text-sm text-slate-400">Loading secure sign-in…</div>}

      {authUser && view === "metrics" && <MetricsPage authUser={authUser} />}


      {view === "onbForm" && <OnboardingFormPage />}

      {view === "onbMgmt" && (
        hasRole(authUser, "bp_owner") || isManager ? <OnboardingMgmtPage authUser={authUser!} /> :
          <ManagerGate onCancel={() => setView("onbForm")} onUnlock={() => { localStorage.setItem("nexportal_is_manager", "1"); setIsManager(true); }} />
      )}

      {authUser && view === "ftrHits" && <FtrHitsPage authUser={authUser} />}


      {authUser && view === "tnps" && <TNPSDashboard authUser={authUser} />}

      {authUser && view === "payroll" && hasRole(authUser, "director") && (
        <Payroll
  portalUser={{
    username: authUser.username,
    role: "director",
    displayName: authUser.displayName,
  }}
/>
      )}

      {authUser && view === "assets" && hasRole(authUser, "supervisor") && (
        <AssetsPage authUser={authUser} />
      )}

      {authUser && view === "techProfiles" && (authUser.role === "bp_owner" || authUser.role === "supervisor" || authUser.role === "director") && (
        <TechnicianProfiles authUser={authUser} />
      )}

      {authUser && view === "formsCenter" && hasRole(authUser, "supervisor") && (
        <FormsCenter />
      )}

      {authUser && view === "dataUploads" && (authUser.role === "dispatcher" || authUser.role === "supervisor" || authUser.role === "director") && (
        <DataUploads />
      )}

      {authUser?.role === "tech" && view === "myForms" && (
        <MyForms authUser={authUser} />
      )}

      {authUser?.role === "tech" && view === "myProfile" && (
        <MyProfile authUser={authUser} onNavigate={setView} />
      )}

      {authUser && view === "timeOff" && (
        <TimeOffRequestPage authUser={authUser} />
      )}

      {authUser && view === "timeOffApprovals" && (authUser.role === "director" || (authUser.role === "supervisor" && Boolean(authUser.canApproveTimeOff))) && (
        <TimeOffApprovalsPage />
      )}

      {authUser?.role === "director" && view.startsWith("admin") && (
        <Administration section={view as AdministrationSection} />
      )}

      {showMgrLock && (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowMgrLock(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-4">
            <ManagerGate onCancel={() => setShowMgrLock(false)} onUnlock={() => { setShowMgrLock(false); localStorage.setItem("nexportal_is_manager", "1"); setIsManager(true); setView("onbMgmt"); }} />
          </div>
        </div>
      )}

      <OnlineFeed authUser={authUser} />
    </div>
  );
}

/* =========================
   Reusable UI components
   ========================= */
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

function MetricCard({ title, value, sub, trend, icon, suffix }: { title: string; value: any; sub?: string; trend?: string; icon?: string; suffix?: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/95 to-slate-800/75 p-4 shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:border-blue-400/25">
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-blue-500/5 blur-2xl transition group-hover:bg-blue-500/10" />
      <div className="relative flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-slate-400">{title}</div>
        {icon && <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-white/5 text-sm">{icon}</div>}
      </div>
      <div className="relative mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">{formatValue(value)}{suffix && <span className="ml-0.5 text-base text-slate-400">{suffix}</span>}</div>
      {sub && <div className="relative mt-1 text-[11px] text-slate-500">{sub}</div>}
      {trend && <svg className="relative mt-3 h-9 w-full opacity-80" viewBox="0 0 100 24" preserveAspectRatio="none"><path d={trend} fill="none" stroke="currentColor" className="text-blue-400" strokeWidth="1.8" /></svg>}
    </div>
  );
}

function MiniStat({ label, value, rank }: { label: string; value: any; rank: number }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.035] p-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-100">{value}</div>
      <div className="mt-0.5 text-[10px] text-slate-500">Rank #{rank}</div>
    </div>
  );
}

/* =========================
   TRUCK LEASE PAGE
   ========================= */
const LEASE_WIDGET_URL =
  "https://na1.documents.adobe.com/public/esignWidget?wid=CBFCIBAA3AAABLblqZhCBLSUGhChw_D55GpbumQ73SgaB8gImkXcN9PpZ-v7kVCZvf4V5hJd2YZVIpiUcgQs*";



/* =========================
   ONBOARDING FORM PAGE
   ========================= */


/* =========================
   ONBOARDING MGMT PAGE
   ========================= */






/* =========================
   Demo fallback
   ========================= */
const sampleCsv = `date,tech,tech_num,jobs,installs,ftr_n,ftr_d,tnps_sum,tnps_cnt,tool_use_n,tool_use_d,cb48_n,cb48_d,region
2025-11-01,Austin,101,6,4,5,6,45,6,5,6,5,6,Keystone
2025-11-01,Sam,202,5,3,4,5,27,4,12,14,4,5,Beltway
2025-11-02,Austin,101,7,5,6,7,50,7,6,7,6,7,Keystone
2025-11-02,Sam,202,4,2,3,4,20,3,9,10,3,4,Beltway
2025-11-03,Austin,101,5,3,4,5,38,5,4,5,4,5,Freedom
2025-11-03,Sam,202,6,4,5,6,34,5,11,12,5,6,Keystone`;
