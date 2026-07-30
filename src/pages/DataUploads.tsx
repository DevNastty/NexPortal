import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../supabase";

type DataKind = "metrics" | "tnps";
type Preview = { file: File; kind: DataKind; region: string; monthKey: string; rows: Record<string, any>[]; warnings: string[] };

const REGIONS = ["Keystone", "Beltway", "Freedom"];
const regionFromName = (name: string) => REGIONS.find(region => name.toLowerCase().includes(region.toLowerCase())) || "";
function delimiter(line: string) { if (line.includes("\t")) return "\t"; if (line.includes(";")) return ";"; if (line.includes("|")) return "|"; return ","; }
function split(line: string, sep: string) { const out:string[]=[]; let cur="", quoted=false; for(let i=0;i<line.length;i++){const c=line[i]; if(c==='"'){if(quoted&&line[i+1]==='"'){cur+='"';i++;}else quoted=!quoted;}else if(c===sep&&!quoted){out.push(cur);cur="";}else cur+=c;} out.push(cur); return out.map(v=>v.trim()); }
const norm = (value:string) => value.toLowerCase().trim().replace(/\s+/g," ");
const number = (value:any) => { const text=String(value??"").replace(/[%,$]/g,"").trim(); const n=Number(text); return Number.isFinite(n)?n:0; };
const isoDate = (value:any) => { const raw=String(value??"").trim(); if(!raw)return null; const d=new Date(raw); return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10); };


function detectDataKind(text: string): DataKind {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n").filter(line => line.trim());
  let best: { kind: DataKind; score: number } = { kind: "metrics", score: 0 };
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const candidateSep = delimiter(lines[i]);
    const headers = split(lines[i], candidateSep).map(norm);
    const has = (...aliases: string[]) => aliases.some(alias => headers.some(header => header === alias || header.includes(alias)));
    const metricsScore =
      (has("total jobs", "jobs") ? 4 : 0) +
      (has("techid", "tech id", "tech #", "technician number") ? 3 : 0) +
      (has("installs") ? 2 : 0) +
      (has("ftr", "tool usage", "toolusage") ? 1 : 0);
    const tnpsScore =
      (has("sms tnps", "tnps", "score", "rating") ? 4 : 0) +
      (has("employee ntid", "employee region") ? 4 : 0) +
      (has("reason for score", "feedback", "comment") ? 2 : 0) +
      (has("transaction date", "response date") ? 1 : 0);
    if (metricsScore > best.score) best = { kind: "metrics", score: metricsScore };
    if (tnpsScore > best.score) best = { kind: "tnps", score: tnpsScore };
  }
  if (best.score < 4) throw new Error("Could not identify this file as a Metrics or tNPS export.");
  return best.kind;
}

function parseTable(text:string, kind:DataKind){
  const lines=text.replace(/^\uFEFF/,"").replace(/\r\n/g,"\n").split("\n").filter(line=>line.trim());
  if(lines.length<2) throw new Error("The file has no data rows.");
  const metricSignals=["techid","tech id","total jobs","jobs","installs","ftr%","toolusage","tool usage"];
  const tnpsSignals=["score","rating","tnps","sms tnps","reason for score","comment","feedback"];
  const signals=kind==="metrics"?metricSignals:tnpsSignals;
  let headerIndex=-1, sep=",";
  for(let i=0;i<Math.min(lines.length,50);i++){
    const candidateSep=delimiter(lines[i]);
    const candidate=split(lines[i],candidateSep).map(norm);
    const matches=signals.filter(signal=>candidate.some(header=>header===signal||header.includes(signal))).length;
    const required=kind==="metrics"
      ? candidate.some(header=>header==="total jobs"||header==="jobs") && candidate.some(header=>header==="techid"||header==="tech id"||header.includes("tech"))
      : candidate.some(header=>header.includes("tnps")||header==="score"||header==="rating");
    if(required||matches>=2){headerIndex=i;sep=candidateSep;break;}
  }
  if(headerIndex<0) throw new Error(`Could not find the ${kind==="metrics"?"Metrics":"tNPS"} header row in the first 50 rows.`);
  const headers=split(lines[headerIndex],sep).map(norm);
  return {headers, rows:lines.slice(headerIndex+1).map(line=>split(line,sep)), headerIndex};
}
function cell(headers:string[], row:string[], aliases:string[]){ const index=headers.findIndex(header=>aliases.some(alias=>header===alias||header.includes(alias))); return index>=0?(row[index]??"").trim():""; }
function metricRows(text:string, region:string, monthKey:string){
  const {headers,rows,headerIndex}=parseTable(text,"metrics"); const hasJobs=headers.some(h=>h==="jobs"||h==="total jobs"); if(!hasJobs) throw new Error("Metrics file is missing Jobs / Total Jobs.");
  return rows.map((r,index)=>{ const techNum=cell(headers,r,["tech_num","tech id","techid","tech #","technician number"]); const jobs=number(cell(headers,r,["total jobs","jobs"])); const installs=number(cell(headers,r,["installs"])); const isTotals=/totals?/i.test(techNum||r[0]||"");
    const ratio=(pctAliases:string[],nAliases:string[],dAliases:string[])=>{ const nRaw=cell(headers,r,nAliases), dRaw=cell(headers,r,dAliases), pRaw=cell(headers,r,pctAliases); if(nRaw||dRaw)return [number(nRaw),number(dRaw)]; const p=number(pRaw); return isTotals?[(p/100)*jobs,jobs]:[p,100]; };
    const [ftrN,ftrD]=ratio(["ftr%","ftr rate"],["ftr_n"],["ftr_d"]); const [toolN,toolD]=ratio(["toolusage","tool usage"],["tool_use_n"],["tool_use_d"]); const [cbN,cbD]=ratio(["48hr cb%","48hr callback%","cb48%","48hr contact rate"],["cb48_n"],["cb48_d"]);
    let tnpsSum=number(cell(headers,r,["tnps_sum"])), tnpsCnt=number(cell(headers,r,["tnps_cnt"])); const tPct=cell(headers,r,["tnps rate","tnps%"]); if(tPct){const p=number(tPct); tnpsSum=isTotals?p*jobs:p; tnpsCnt=isTotals?jobs:1;}
    const rowRegion=cell(headers,r,["region"])||region; const rowDate=isoDate(cell(headers,r,["date"]))||`${monthKey}-01`;
    return {source_row:index+headerIndex+2,month_key:monthKey,date:rowDate,region:rowRegion,tech:cell(headers,r,["technician","tech name","name"]),tech_num:isTotals?null:techNum,jobs,installs,ftr_n:ftrN,ftr_d:ftrD,tnps_sum:tnpsSum,tnps_cnt:tnpsCnt,tool_use_n:toolN,tool_use_d:toolD,cb48_n:cbN,cb48_d:cbD,is_totals:isTotals};
  }).filter(row=>row.jobs||row.installs||row.tech_num||row.is_totals);
}
function tnpsRows(text:string, region:string){ const {headers,rows,headerIndex}=parseTable(text,"tnps"); return rows.map((r,index)=>{ let score=number(cell(headers,r,["sms tnps","tnps","score","rating","nps"])); if(score>10&&score<=100)score/=10; score=Math.max(0,Math.min(10,score)); const rowRegion=(cell(headers,r,["employee region","region"])||region).replace(/\s+region$/i,"").trim(); return {source_row:index+headerIndex+2,region:rowRegion,response_date:isoDate(cell(headers,r,["response date","transaction date","date","created at","submitted"])),tech_num:cell(headers,r,["employee ntid","tech_num","tech #","technician","tech"] )||null,score,comment:cell(headers,r,["reason for score","comment","comments","verbatim","feedback","notes"])||null}; }).filter(row=>row.score||row.comment); }
function errorText(error:unknown){ return error instanceof Error?error.message:String(error); }
async function readTabularFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx" || extension === "xls") {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new Error("The workbook does not contain a worksheet.");
    const sheet = workbook.Sheets[firstSheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
      dateNF: "yyyy-mm-dd",
    }) as unknown[][];
    if (matrix.length < 2) throw new Error(`Worksheet "${firstSheetName}" has no data rows.`);
    const escapeCell = (value: unknown) => {
      const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "");
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return { text: matrix.map(row => row.map(escapeCell).join(",")).join("\n"), sheetName: firstSheetName };
  }
  if (extension === "csv" || extension === "txt") return { text: await file.text(), sheetName: null };
  throw new Error("Unsupported file type. Upload an Excel (.xlsx/.xls) or CSV file.");
}


export default function DataUploads(){
  const [kind,setKind]=useState<DataKind>("metrics"); const [region,setRegion]=useState("Keystone"); const [monthKey,setMonthKey]=useState(new Date().toISOString().slice(0,7)); const [previews,setPreviews]=useState<Preview[]>([]); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(""); const [error,setError]=useState("");
  const totalRows=useMemo(()=>previews.reduce((sum,item)=>sum+item.rows.length,0),[previews]);
  async function choose(files:FileList|null){ if(!files)return; setError("");setMessage(""); const next:Preview[]=[]; const failures:string[]=[]; for(const file of Array.from(files)){ try{const {text,sheetName}=await readTabularFile(file); const detectedKind=detectDataKind(text); const inferredRegion=regionFromName(file.name)||region; const inferredMonth=monthKey; const rows=detectedKind==="metrics"?metricRows(text,inferredRegion,inferredMonth):tnpsRows(text,inferredRegion); const warnings:string[]=[]; if(sheetName)warnings.push(`Imported from worksheet: ${sheetName}`); if(detectedKind!==kind)warnings.push(`Auto-detected as ${detectedKind==="metrics"?"Monthly Metrics":"tNPS Feedback"}`); next.push({file,kind:detectedKind,region:inferredRegion,monthKey:inferredMonth,rows,warnings});}catch(e){failures.push(`${file.name}: ${errorText(e)}`);} } if(failures.length)setError(failures.join(" | ")); setPreviews(current=>[...current,...next]); }
  async function upload(){ if(!previews.length)return; setBusy(true);setError("");setMessage(""); try{for(const item of previews){ const uploadResult=await supabase.from("portal_data_imports").insert({data_type:item.kind,file_name:item.file.name,region:item.region,month_key:item.kind==="metrics"?item.monthKey:null,row_count:item.rows.length,status:"processing"}).select("id").single(); if(uploadResult.error)throw uploadResult.error; const importId=uploadResult.data.id;
      if(item.kind==="metrics"){ const del=await supabase.from("portal_metric_rows").delete().eq("region",item.region).eq("month_key",item.monthKey); if(del.error)throw del.error; const ins=await supabase.from("portal_metric_rows").insert(item.rows.map(row=>({...row,import_id:importId}))); if(ins.error)throw ins.error; }
      else { const del=await supabase.from("portal_tnps_rows").delete().eq("region",item.region); if(del.error)throw del.error; const ins=await supabase.from("portal_tnps_rows").insert(item.rows.map(row=>({...row,import_id:importId}))); if(ins.error)throw ins.error; }
      const done=await supabase.from("portal_data_imports").update({status:"completed",completed_at:new Date().toISOString()}).eq("id",importId); if(done.error)throw done.error;
    } setMessage(`Imported ${totalRows.toLocaleString()} rows from ${previews.length} file${previews.length===1?"":"s"}.`);setPreviews([]);}catch(e){setError(errorText(e));}finally{setBusy(false);} }
  return <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6"><div className="rounded-3xl border border-white/10 bg-slate-900/75 p-6 shadow-2xl"><div className="text-[10px] font-semibold uppercase tracking-[.22em] text-blue-300">Director Management</div><h1 className="mt-1 text-2xl font-bold text-white">Data Uploads</h1><p className="mt-2 text-sm text-slate-400">Drop the same Metrics and tNPS Excel or CSV exports you already use. The portal validates and stores them in Supabase—no file renaming, code edits, or redeploy required.</p>
    {(message||error)&&<div className={`mt-5 rounded-xl border px-4 py-3 text-sm ${error?"border-red-400/20 bg-red-500/10 text-red-200":"border-emerald-400/20 bg-emerald-500/10 text-emerald-200"}`}>{error||message}</div>}
    <div className="mt-6 grid gap-5 lg:grid-cols-[360px_1fr]"><section className="space-y-4 rounded-2xl border border-white/10 bg-slate-950/55 p-5"><div><label className="text-xs text-slate-400">Data type</label><select value={kind} onChange={e=>{setKind(e.target.value as DataKind);setPreviews([]);}} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5"><option value="metrics">Monthly Metrics</option><option value="tnps">tNPS Feedback</option></select></div><div><label className="text-xs text-slate-400">Default region</label><select value={region} onChange={e=>setRegion(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5">{REGIONS.map(r=><option key={r}>{r}</option>)}</select></div>{kind==="metrics"&&<div><label className="text-xs text-slate-400">Default reporting month</label><input type="month" value={monthKey} onChange={e=>setMonthKey(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5"/></div>}<label className="block cursor-pointer rounded-2xl border border-dashed border-blue-400/30 bg-blue-500/5 p-8 text-center hover:bg-blue-500/10"><div className="text-3xl">⇧</div><div className="mt-2 font-semibold">Choose Excel or CSV files</div><div className="mt-1 text-xs text-slate-400">Supports .xlsx, .xls, and .csv. The first Excel worksheet is read automatically; region may be inferred from the filename; the reporting month always uses the month selected above.</div><input className="hidden" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,.txt" multiple onChange={e=>void choose(e.target.files)}/></label></section>
      <section className="rounded-2xl border border-white/10 bg-slate-950/45 p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Ready to import</h2><p className="text-xs text-slate-400">Uploading replaces the selected region/month so duplicate rows do not accumulate.</p></div><button disabled={busy||!previews.length} onClick={()=>void upload()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">{busy?"Importing…":`Import ${totalRows.toLocaleString()} rows`}</button></div><div className="mt-4 space-y-3">{!previews.length&&<div className="rounded-xl border border-white/5 p-8 text-center text-sm text-slate-500">No files selected.</div>}{previews.map((item,index)=><div key={`${item.file.name}-${index}`} className="flex items-center gap-4 rounded-xl border border-white/10 bg-slate-900/60 p-4"><div className="min-w-0 flex-1"><div className="truncate font-medium text-white">{item.file.name}</div><div className="mt-1 text-xs text-slate-400">{item.kind==="metrics"?`${item.region} • ${item.monthKey}`:item.region} • {item.rows.length.toLocaleString()} valid rows{item.warnings[0]?` • ${item.warnings[0]}`:""}</div></div><button onClick={()=>setPreviews(rows=>rows.filter((_,i)=>i!==index))} className="rounded-lg px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10">Remove</button></div>)}</div></section></div></div></main>;
}
