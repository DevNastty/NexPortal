import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import type { AuthUser, ViewKey } from "../types/navigation";

type Props={authUser:AuthUser;onNavigate:(view:ViewKey)=>void};
type Metric={jobs:number;installs:number;ftr_n:number;ftr_d:number;tnps_sum:number;tnps_cnt:number;tool_use_n:number;tool_use_d:number;month_key:string};
const pct=(n:number,d:number)=>d>0?`${((n/d)*100).toFixed(1)}%`:"—";
const score=(n:number,d:number)=>d>0?(n/d).toFixed(1):"—";
export default function TechDashboard({authUser,onNavigate}:Props){
 const [metric,setMetric]=useState<Metric|null>(null),[forms,setForms]=useState({pending:0,completed:0}),[timeOff,setTimeOff]=useState<any[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
 useEffect(()=>{void load()},[authUser.userId,authUser.techNumber]);
 async function load(){
  setLoading(true);setError("");
  try{
   if(authUser.techNumber){
    const imports=await supabase.from("portal_data_imports").select("month_key").eq("data_type","metrics").eq("status","completed").not("month_key","is",null).order("month_key",{ascending:false}).limit(1);
    let month=String(imports.data?.[0]?.month_key||"");
    if(!month){const months=await supabase.from("portal_metric_rows").select("month_key").not("month_key","is",null).order("month_key",{ascending:false}).limit(1);if(months.error)throw months.error;month=String(months.data?.[0]?.month_key||"");}
    if(month){const r=await supabase.from("portal_metric_rows").select("jobs,installs,ftr_n,ftr_d,tnps_sum,tnps_cnt,tool_use_n,tool_use_d,month_key").eq("tech_num",authUser.techNumber).eq("month_key",month).eq("is_totals",false);if(r.error)throw r.error;const rows=r.data||[];setMetric(rows.reduce((a:any,x:any)=>({month_key:month,jobs:a.jobs+Number(x.jobs||0),installs:a.installs+Number(x.installs||0),ftr_n:a.ftr_n+Number(x.ftr_n||0),ftr_d:a.ftr_d+Number(x.ftr_d||0),tnps_sum:a.tnps_sum+Number(x.tnps_sum||0),tnps_cnt:a.tnps_cnt+Number(x.tnps_cnt||0),tool_use_n:a.tool_use_n+Number(x.tool_use_n||0),tool_use_d:a.tool_use_d+Number(x.tool_use_d||0)}),{jobs:0,installs:0,ftr_n:0,ftr_d:0,tnps_sum:0,tnps_cnt:0,tool_use_n:0,tool_use_d:0,month_key:month}));}
   }
   let techId="";
   if(authUser.userId){const t=await supabase.from("payroll_technicians").select("id").eq("user_id",authUser.userId).maybeSingle();if(!t.error&&t.data)techId=t.data.id;}
   if(!techId&&authUser.techNumber){const t=await supabase.from("payroll_technicians").select("id").eq("tech_number",authUser.techNumber).maybeSingle();if(!t.error&&t.data)techId=t.data.id;}
   if(techId){const f=await supabase.from("tech_signature_requests").select("status").eq("technician_id",techId).neq("status","cancelled");if(f.error)throw f.error;setForms({pending:(f.data||[]).filter((x:any)=>!["signed","completed"].includes(x.status)).length,completed:(f.data||[]).filter((x:any)=>["signed","completed"].includes(x.status)).length});}
   if(authUser.userId){const r=await supabase.from("tech_time_off_requests").select("id,start_date,end_date,request_type,status").eq("tech_user_id",authUser.userId).gte("end_date",new Date().toISOString().slice(0,10)).order("start_date").limit(5);if(r.error)throw r.error;setTimeOff(r.data||[]);}
  }catch(e:any){setError(e?.message||String(e))}finally{setLoading(false)}
 }
 const cards=[['Jobs',metric?.jobs??0],['Installs',metric?.installs??0],['FTR',metric?pct(metric.ftr_n,metric.ftr_d):'—'],['tNPS',metric?score(metric.tnps_sum,metric.tnps_cnt):'—'],['Tool Usage',metric?pct(metric.tool_use_n,metric.tool_use_d):'—']];
 return <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
  <div className="mb-6"><h1 className="text-2xl font-bold text-white">Welcome, {authUser.displayName||authUser.username}</h1><p className="mt-1 text-sm text-slate-400">Your performance, forms, and upcoming time off in one place.</p></div>
  {error&&<div className="mb-4 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{cards.map(([l,v])=><div key={String(l)} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><div className="text-xs uppercase tracking-wide text-slate-500">{l}</div><div className="mt-2 text-2xl font-bold text-white">{loading?'…':v}</div></div>)}</div>
  <div className="mt-6 grid gap-5 lg:grid-cols-2">
   <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"><div className="flex items-center justify-between"><h2 className="font-semibold text-white">My Forms</h2><button onClick={()=>onNavigate('myForms')} className="text-xs text-blue-300">Open forms</button></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-amber-500/10 p-4"><div className="text-xs text-amber-200">Pending</div><div className="mt-1 text-2xl font-bold">{forms.pending}</div></div><div className="rounded-xl bg-emerald-500/10 p-4"><div className="text-xs text-emerald-200">Completed</div><div className="mt-1 text-2xl font-bold">{forms.completed}</div></div></div></section>
   <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"><div className="flex items-center justify-between"><h2 className="font-semibold text-white">Upcoming Time Off</h2><button onClick={()=>onNavigate('timeOff')} className="text-xs text-blue-300">Time Off Request</button></div><div className="mt-4 space-y-2">{timeOff.length?timeOff.map(r=><div key={r.id} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-3 text-sm"><span>{r.start_date}{r.end_date!==r.start_date?` – ${r.end_date}`:''} · {r.request_type}</span><span className="capitalize text-slate-400">{r.status}</span></div>):<div className="text-sm text-slate-500">No upcoming requests.</div>}</div></section>
  </div>
 </main>
}
