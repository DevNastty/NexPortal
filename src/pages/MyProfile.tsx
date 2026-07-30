import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import type { AuthUser, ViewKey } from "../types/navigation";

type Props = { authUser: AuthUser; onNavigate: (view: ViewKey) => void };
type Tech = {
  id: string; tech_number: string; full_name: string | null; email: string | null;
  phone: string | null; address: string | null; region: string | null; start_date: string | null;
  manager_name: string | null; emergency_contact_name: string | null; emergency_contact_phone: string | null;
  headshot_path: string | null; company_id: string | null; active: boolean;
  payroll_companies?: { company_name: string } | null;
};
type Truck = { id: string; unit_number: string | null; vin: string; year: number | null; make: string | null; model: string | null; license_plate: string | null; status: string };
type Meter = { id: string; serial_number: string; mac_address: string | null; manufacturer: string | null; model: string | null; status: string };
type Metric = { jobs: number; installs: number; ftr_n: number; ftr_d: number; tnps_sum: number; tnps_cnt: number; tool_use_n: number; tool_use_d: number; month_key: string };

const BUCKET = "tech-documents";
const errText = (e: unknown) => e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as {message?:unknown}).message) : String(e);
const pct = (n:number,d:number) => d > 0 ? `${((n/d)*100).toFixed(1)}%` : "—";
const avg = (n:number,d:number) => d > 0 ? (n/d).toFixed(1) : "—";
const prettyDate = (value:string|null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString() : "Not listed";

export default function MyProfile({ authUser, onNavigate }: Props) {
  const [tech,setTech]=useState<Tech|null>(null),[truck,setTruck]=useState<Truck|null>(null),[meter,setMeter]=useState<Meter|null>(null);
  const [metric,setMetric]=useState<Metric|null>(null),[forms,setForms]=useState({pending:0,completed:0}),[photo,setPhoto]=useState<string|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState("");

  useEffect(()=>{ void load(); },[authUser.userId,authUser.techNumber,authUser.email]);

  async function load(){
    setLoading(true); setError("");
    try {
      let query = supabase.from("payroll_technicians")
        .select("id,tech_number,full_name,email,phone,address,region,start_date,manager_name,emergency_contact_name,emergency_contact_phone,headshot_path,company_id,active,payroll_companies(company_name)");
      if (authUser.userId) query = query.eq("user_id",authUser.userId);
      else if (authUser.techNumber) query = query.eq("tech_number",authUser.techNumber);
      else if (authUser.email) query = query.ilike("email",authUser.email);
      else throw new Error("Your login is missing a technician identifier.");
      let result = await query.maybeSingle();
      if (result.error && authUser.techNumber) {
        result = await supabase.from("payroll_technicians")
          .select("id,tech_number,full_name,email,phone,address,region,start_date,manager_name,emergency_contact_name,emergency_contact_phone,headshot_path,company_id,active,payroll_companies(company_name)")
          .eq("tech_number",authUser.techNumber).maybeSingle();
      }
      if (result.error) throw result.error;
      if (!result.data) throw new Error("Your login is not linked to a technician profile.");
      const current = result.data as unknown as Tech; setTech(current);

      const [truckResult,meterResult,formResult] = await Promise.all([
        supabase.from("asset_trucks").select("id,unit_number,vin,year,make,model,license_plate,status").eq("assigned_technician_id",current.id).maybeSingle(),
        supabase.from("asset_meters").select("id,serial_number,mac_address,manufacturer,model,status").eq("assigned_technician_id",current.id).maybeSingle(),
        supabase.from("tech_signature_requests").select("status").eq("technician_id",current.id).neq("status","cancelled"),
      ]);
      if (!truckResult.error) setTruck((truckResult.data||null) as Truck|null);
      if (!meterResult.error) setMeter((meterResult.data||null) as Meter|null);
      if (!formResult.error) {
        const all=formResult.data||[];
        setForms({pending:all.filter((x:any)=>!["signed","completed"].includes(x.status)).length,completed:all.filter((x:any)=>["signed","completed"].includes(x.status)).length});
      }
      if (current.headshot_path) {
        const signed=await supabase.storage.from(BUCKET).createSignedUrl(current.headshot_path,3600);
        setPhoto(signed.data?.signedUrl||null);
      } else setPhoto(null);

      const imports=await supabase.from("portal_data_imports").select("month_key").eq("data_type","metrics").eq("status","completed").not("month_key","is",null).order("month_key",{ascending:false}).limit(1);
      let month=String(imports.data?.[0]?.month_key||"");
      if(!month){
        const months=await supabase.from("portal_metric_rows").select("month_key").not("month_key","is",null).order("month_key",{ascending:false}).limit(1);
        month=String(months.data?.[0]?.month_key||"");
      }
      if (month) {
        const metrics=await supabase.from("portal_metric_rows").select("jobs,installs,ftr_n,ftr_d,tnps_sum,tnps_cnt,tool_use_n,tool_use_d,month_key").eq("tech_num",current.tech_number).eq("month_key",month).eq("is_totals",false);
        if (!metrics.error) setMetric((metrics.data||[]).reduce((a:any,x:any)=>({month_key:month,jobs:a.jobs+Number(x.jobs||0),installs:a.installs+Number(x.installs||0),ftr_n:a.ftr_n+Number(x.ftr_n||0),ftr_d:a.ftr_d+Number(x.ftr_d||0),tnps_sum:a.tnps_sum+Number(x.tnps_sum||0),tnps_cnt:a.tnps_cnt+Number(x.tnps_cnt||0),tool_use_n:a.tool_use_n+Number(x.tool_use_n||0),tool_use_d:a.tool_use_d+Number(x.tool_use_d||0)}),{jobs:0,installs:0,ftr_n:0,ftr_d:0,tnps_sum:0,tnps_cnt:0,tool_use_n:0,tool_use_d:0,month_key:month}));
      }
    } catch(e){ setError(errText(e)); } finally { setLoading(false); }
  }

  if (loading) return <main className="mx-auto max-w-6xl px-4 py-16 text-center text-sm text-slate-400">Loading your profile…</main>;
  return <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
    <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-slate-900/70 p-5 sm:flex-row sm:items-center">
      {photo?<img src={photo} alt="" className="h-24 w-24 rounded-2xl object-cover"/>:<div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-blue-600/20 text-2xl font-bold text-blue-300">{(tech?.full_name||authUser.displayName||"Tech").split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase()}</div>}
      <div className="min-w-0 flex-1"><div className="text-xs font-semibold uppercase tracking-[.2em] text-blue-400">Technician Profile</div><h1 className="mt-1 truncate text-2xl font-bold text-white">{tech?.full_name||authUser.displayName||authUser.username}</h1><div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-300"><span className="rounded-full bg-white/5 px-3 py-1">Tech #{tech?.tech_number||authUser.techNumber||"—"}</span><span className="rounded-full bg-white/5 px-3 py-1">{tech?.region||"No region"}</span><span className="rounded-full bg-white/5 px-3 py-1">{tech?.payroll_companies?.company_name||"No company"}</span></div></div>
      <button onClick={()=>void load()} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-200">Refresh</button>
    </div>
    {error&&<div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <Card title="Contact & Work Information"><Info label="Email" value={tech?.email||authUser.email||"Not listed"}/><Info label="Phone" value={tech?.phone||"Not listed"}/><Info label="Address" value={tech?.address||"Not listed"}/><Info label="Supervisor" value={tech?.manager_name||"Not listed"}/><Info label="Start date" value={prettyDate(tech?.start_date||null)}/><Info label="Status" value={tech?.active===false?"Inactive":"Active"}/></Card>
      <Card title="Emergency Contact"><Info label="Name" value={tech?.emergency_contact_name||"Not listed"}/><Info label="Phone" value={tech?.emergency_contact_phone||"Not listed"}/></Card>
      <Card title="Assigned Assets"><Asset label="Truck" main={truck?(truck.unit_number?`Unit ${truck.unit_number}`:"Assigned truck"):"No truck assigned"} sub={truck?[truck.year,truck.make,truck.model].filter(Boolean).join(" ")+` · VIN ${truck.vin}`:""}/><Asset label="Meter" main={meter?meter.serial_number:"No meter assigned"} sub={meter?[meter.manufacturer,meter.model,meter.mac_address&&`MAC ${meter.mac_address}`].filter(Boolean).join(" · "):""}/></Card>
      <Card title="Forms"><div className="grid grid-cols-2 gap-3"><Stat label="Pending" value={String(forms.pending)}/><Stat label="Completed" value={String(forms.completed)}/></div><button onClick={()=>onNavigate("myForms")} className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white">Open My Forms</button></Card>
    </div>
    <section className="mt-5 rounded-2xl border border-white/10 bg-slate-900/70 p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-white">Current Performance</h2><p className="mt-1 text-xs text-slate-500">{metric?.month_key||"No metrics month available"}</p></div><button onClick={()=>onNavigate("metrics")} className="text-xs text-blue-300">View metrics</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Stat label="Jobs" value={String(metric?.jobs??0)}/><Stat label="Installs" value={String(metric?.installs??0)}/><Stat label="FTR" value={metric?pct(metric.ftr_n,metric.ftr_d):"—"}/><Stat label="tNPS" value={metric?avg(metric.tnps_sum,metric.tnps_cnt):"—"}/><Stat label="Tool Usage" value={metric?pct(metric.tool_use_n,metric.tool_use_d):"—"}/></div></section>
  </main>;
}
function Card({title,children}:{title:string;children:React.ReactNode}){return <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"><h2 className="mb-4 font-semibold text-white">{title}</h2><div className="space-y-3">{children}</div></section>}
function Info({label,value}:{label:string;value:string}){return <div className="flex items-start justify-between gap-4 border-b border-white/5 pb-3 last:border-0 last:pb-0"><span className="text-xs text-slate-500">{label}</span><span className="max-w-[70%] text-right text-sm text-slate-200">{value}</span></div>}
function Asset({label,main,sub}:{label:string;main:string;sub:string}){return <div className="rounded-xl bg-white/[.03] p-4"><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 font-medium text-white">{main}</div>{sub&&<div className="mt-1 text-xs text-slate-400">{sub}</div>}</div>}
function Stat({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-white/[.04] p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold text-white">{value}</div></div>}
