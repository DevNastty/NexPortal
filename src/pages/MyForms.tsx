import { useEffect, useRef, useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { supabase } from "../supabase";
import type { AuthUser } from "../types/navigation";

type FieldType="text"|"date"|"checkbox"|"signature"|"initials";
type FormField={id:string;label:string;type:FieldType;required:boolean;page:number;x:number;y:number;width:number;height:number};
type Template={id:string;storage_path:string|null;file_name:string|null;fields:FormField[]|null};
type Request={id:string;technician_id:string;template_id:string;template_name:string;status:string;created_at:string;signed_at:string|null;tech_form_templates:Template|null};
const errorText=(e:unknown)=>e instanceof Error?e.message:typeof e==="string"?e:JSON.stringify(e);
export default function MyForms({authUser}:{authUser:AuthUser}){
 const [requests,setRequests]=useState<Request[]>([]),[active,setActive]=useState<Request|null>(null),[techId,setTechId]=useState(""),[name,setName]=useState(authUser.displayName||""),[consent,setConsent]=useState(false),[url,setUrl]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[values,setValues]=useState<Record<string,string|boolean>>({});const canvas=useRef<HTMLCanvasElement>(null),drawing=useRef(false);
 async function load(){
  setMessage("");
  setRequests([]);
  try{
   const email=String(authUser.email||"").trim();
   let resolvedTechId="";
   let baseRequests:Omit<Request,"tech_form_templates">[]=[];

   // Assignments already store the recipient email. Load by the authenticated
   // account first so a missing payroll user_id link cannot hide assigned forms.
   if(email){
    const byEmail=await supabase.from("tech_signature_requests")
     .select("id,technician_id,template_id,template_name,status,created_at,signed_at")
     .ilike("recipient_email",email)
     .neq("status","cancelled")
     .order("created_at",{ascending:false});
    if(byEmail.error)throw new Error(`Assignments load failed: ${byEmail.error.message}`);
    baseRequests=(byEmail.data||[]) as Omit<Request,"tech_form_templates">[];
    resolvedTechId=String(baseRequests[0]?.technician_id||"");
   }

   // Fall back to the payroll link for older assignments that did not save a
   // recipient email or when this technician has not yet received a form.
   if(!resolvedTechId){
    let tr:{data:{id:string}|null;error:{message:string}|null}={data:null,error:null};
    if(authUser.userId)tr=await supabase.from("payroll_technicians").select("id").eq("user_id",authUser.userId).maybeSingle();
    if(!tr.error&&!tr.data&&authUser.techNumber)tr=await supabase.from("payroll_technicians").select("id").eq("tech_number",authUser.techNumber).maybeSingle();
    if(!tr.error&&!tr.data&&email)tr=await supabase.from("payroll_technicians").select("id").ilike("email",email).maybeSingle();
    if(tr.error)throw new Error(`Technician lookup failed: ${tr.error.message}`);
    resolvedTechId=String(tr.data?.id||"");
   }

   if(!resolvedTechId){
    setTechId("");
    setMessage("Your login is not linked to a technician profile and no form assignments were found for your email.");
    return;
   }
   setTechId(resolvedTechId);

   if(!baseRequests.length){
    const requestResult=await supabase.from("tech_signature_requests")
     .select("id,technician_id,template_id,template_name,status,created_at,signed_at")
     .eq("technician_id",resolvedTechId)
     .neq("status","cancelled")
     .order("created_at",{ascending:false});
    if(requestResult.error)throw new Error(`Assignments load failed: ${requestResult.error.message}`);
    baseRequests=(requestResult.data||[]) as Omit<Request,"tech_form_templates">[];
   }

   const templateIds=[...new Set(baseRequests.map(row=>row.template_id).filter(Boolean))];
   let templateMap=new Map<string,Template>();
   if(templateIds.length){
    const templateResult=await supabase.from("tech_form_templates")
     .select("id,storage_path,file_name,fields")
     .in("id",templateIds);
    if(templateResult.error)throw new Error(`Templates load failed: ${templateResult.error.message}`);
    templateMap=new Map(((templateResult.data||[]) as Template[]).map(template=>[template.id,template]));
   }

   setRequests(baseRequests.map(row=>({...row,tech_form_templates:templateMap.get(row.template_id)||null})));
  }catch(e){
   setTechId("");
   setMessage(`Forms load failed: ${errorText(e)}`);
  }
 }
 useEffect(()=>{void load()},[]);
 useEffect(()=>()=>{if(url.startsWith("blob:"))URL.revokeObjectURL(url)},[url]);
 async function open(r:Request){
  setMessage("");
  setActive(r);
  setConsent(false);
  setUrl("");
  const initial:Record<string,string|boolean>={};
  for(const f of r.tech_form_templates?.fields||[]){
   const label=f.label.toLowerCase();
   initial[f.id]=f.type==="checkbox"
    ?false
    :f.type==="date"
     ?new Date().toISOString().slice(0,10)
     :label.includes("email")
      ?(authUser.email||"")
      :label.includes("company name")
       ?"BPS"
       :label.includes("name")
        ?(authUser.displayName||"")
        :"";
  }
  setValues(initial);
  try{
   const templatePath=r.tech_form_templates?.storage_path;
   if(!templatePath)throw new Error("This form template does not have a PDF storage path.");
   const downloaded=await supabase.storage.from("form-templates").download(templatePath);
   if(downloaded.error)throw downloaded.error;
   const previewBlob=downloaded.data.type==="application/pdf"?downloaded.data:new Blob([await downloaded.data.arrayBuffer()],{type:"application/pdf"});
   setUrl(URL.createObjectURL(previewBlob));
  }catch(e){
   setMessage(`Form preview failed: ${errorText(e)}`);
  }
  try{
   const statusUpdate=await supabase.from("tech_signature_requests").update({status:r.status==="pending"?"viewed":r.status,viewed_at:new Date().toISOString()}).eq("id",r.id);
   if(statusUpdate.error)throw statusUpdate.error;
  }catch(e){
   setMessage(current=>current||`Form status update failed: ${errorText(e)}`);
  }
 }
 function pos(e:React.PointerEvent<HTMLCanvasElement>){const c=canvas.current!,b=c.getBoundingClientRect();return{x:(e.clientX-b.left)*(c.width/b.width),y:(e.clientY-b.top)*(c.height/b.height)}}function down(e:React.PointerEvent<HTMLCanvasElement>){drawing.current=true;const p=pos(e),x=canvas.current!.getContext("2d")!;x.beginPath();x.moveTo(p.x,p.y);canvas.current!.setPointerCapture(e.pointerId)}function move(e:React.PointerEvent<HTMLCanvasElement>){if(!drawing.current)return;const p=pos(e),x=canvas.current!.getContext("2d")!;x.lineWidth=2;x.lineCap="round";x.strokeStyle="#111827";x.lineTo(p.x,p.y);x.stroke()}function up(){drawing.current=false}function clear(){canvas.current?.getContext("2d")?.clearRect(0,0,canvas.current.width,canvas.current.height)}
 async function submit(){
  if(!active||!techId||!name.trim()||!consent){setMessage("Enter your printed name, complete required fields, sign, and accept the consent statement.");return}
  const fields=active.tech_form_templates?.fields||[];
  for(const f of fields){
   if(f.required&&f.type!=="signature"&&(values[f.id]===false||String(values[f.id]??"").trim()==="")){setMessage(`Complete the required field: ${f.label}`);return}
  }
  const data=canvas.current?.toDataURL("image/png");
  if(!data||data.length<2000){setMessage("Please draw your signature.");return}
  setBusy(true);setMessage("");
  try{
   const sigBlob=await(await fetch(data)).blob();
   const sigPath=`${techId}/signatures/${active.id}.png`;
   let r=await supabase.storage.from("tech-documents").upload(sigPath,sigBlob,{contentType:"image/png",upsert:true});
   if(r.error)throw new Error(`Signature upload failed: ${r.error.message}`);

   const templatePath=active.tech_form_templates?.storage_path;
   if(!templatePath)throw new Error("Template PDF is missing.");
   const dl=await supabase.storage.from("form-templates").download(templatePath);
   if(dl.error)throw new Error(`Template download failed: ${dl.error.message}`);

   let pdf:PDFDocument;
   try{
    const sourceBytes=new Uint8Array(await dl.data.arrayBuffer());
    pdf=await PDFDocument.load(sourceBytes,{ignoreEncryption:true,updateMetadata:false});
   }catch(e){throw new Error(`PDF load failed: ${errorText(e)}`)}

   const pages=pdf.getPages();
   if(pages.length===0)throw new Error("PDF load failed: the template contains no pages.");

   let font;
   try{font=await pdf.embedFont(StandardFonts.Helvetica)}catch(e){throw new Error(`Font embedding failed: ${errorText(e)}`)}

   let sigImage;
   try{
    const signatureBytes=new Uint8Array(await sigBlob.arrayBuffer());
    sigImage=await pdf.embedPng(signatureBytes);
   }catch(e){throw new Error(`Signature embedding failed: ${errorText(e)}`)}

   try{
    for(const f of fields){
     const pageIndex=Math.max(0,Math.min(pages.length-1,Number(f.page||1)-1));
     const page=pages[pageIndex];
     if(!page)continue;
     const size=page.getSize();
     const x=size.width*(Number(f.x||0)/100),y=size.height*(Number(f.y||0)/100);
     const w=Math.max(1,size.width*(Number(f.width||10)/100)),h=Math.max(1,size.height*(Number(f.height||3)/100));
     if(f.type==="signature"){
      page.drawImage(sigImage,{x,y,width:w,height:h});
     }else if(f.type==="checkbox"){
      if(values[f.id]===true)page.drawText("X",{x:x+2,y:y+1,size:Math.min(16,h),font,color:rgb(0,0,0)});
     }else{
      const text=String(values[f.id]??"").replace(/[\r\n]+/g," ");
      if(text)page.drawText(text,{x,y:y+Math.max(0,(h-10)/2),size:Math.min(11,Math.max(7,h*.7)),font,color:rgb(0,0,0),maxWidth:w});
     }
    }
    if(!fields.some(f=>f.type==="signature")){
     const p=pages[pages.length-1];
     p.drawImage(sigImage,{x:45,y:35,width:180,height:50});
     p.drawText(name.trim(),{x:240,y:50,size:10,font,color:rgb(0,0,0)});
    }
   }catch(e){throw new Error(`Writing fields to PDF failed: ${errorText(e)}`)}

   let pdfBytes:Uint8Array;
   try{pdfBytes=await pdf.save({useObjectStreams:false})}catch(e){throw new Error(`PDF save failed: ${errorText(e)}`)}
   const outputBuffer=new ArrayBuffer(pdfBytes.byteLength);
   new Uint8Array(outputBuffer).set(pdfBytes);
   const pdfPath=`${techId}/signed-forms/${Date.now()}-${active.tech_form_templates?.file_name||"form.pdf"}`;
   r=await supabase.storage.from("tech-documents").upload(pdfPath,new Blob([outputBuffer],{type:"application/pdf"}),{contentType:"application/pdf"});
   if(r.error)throw new Error(`Completed PDF upload failed: ${r.error.message}`);

   const doc=await supabase.from("tech_documents").insert({technician_id:techId,title:active.template_name,document_type:"Signed Form",file_name:active.tech_form_templates?.file_name||`${active.template_name}.pdf`,storage_path:pdfPath,mime_type:"application/pdf",status:"signed",signed_date:new Date().toISOString().slice(0,10),notes:"Electronically completed and signed through BPS Forms Center."}).select("id").single();
   if(doc.error)throw new Error(`Document record failed: ${doc.error.message}`);
   const now=new Date().toISOString();
   const audit=await supabase.from("tech_signature_audit").insert({request_id:active.id,technician_id:techId,signer_name:name.trim(),signer_email:authUser.email||null,consent_accepted:true,consent_text:"I consent to use an electronic signature and agree that my electronic signature is the legal equivalent of my handwritten signature.",signature_storage_path:sigPath,user_agent:navigator.userAgent,signed_at:now,field_values:values,completed_document_path:pdfPath});
   if(audit.error)throw new Error(`Signature audit failed: ${audit.error.message}`);
   const u=await supabase.from("tech_signature_requests").update({status:"signed",signed_at:now,completed_document_id:doc.data.id,completed_document_path:pdfPath,signature_storage_path:sigPath,signer_name:name.trim(),field_values:values}).eq("id",active.id);
   if(u.error)throw new Error(`Form status update failed: ${u.error.message}`);
   setMessage("Form completed, signed, and saved to your documents.");setActive(null);await load();
  }catch(e){setMessage(errorText(e))}finally{setBusy(false)}
 }

 return <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6"><div className="mb-5"><p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-400">Technician</p><h1 className="mt-1 text-2xl font-bold text-white">My Forms</h1><p className="mt-1 text-sm text-slate-400">Review, complete, and electronically sign assigned forms.</p></div>{message&&<div className="mb-4 rounded-xl border border-white/10 bg-slate-900 p-3 text-sm text-slate-200">{message}</div>}<div className="space-y-3">{requests.map(r=><div key={r.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-medium text-white">{r.template_name}</div><div className="mt-1 text-xs text-slate-500">Assigned {new Date(r.created_at).toLocaleDateString()}</div></div><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs ${r.status==="signed"?"bg-emerald-500/10 text-emerald-300":"bg-amber-500/10 text-amber-300"}`}>{r.status}</span>{r.status!=="signed"&&<button onClick={()=>void open(r)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Review & Sign</button>}</div></div>)}</div>
 {active&&<div className="fixed inset-0 z-[80] overflow-y-auto bg-black/80 p-3 sm:p-6"><div className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-slate-900 p-4 sm:p-6"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold text-white">{active.template_name}</h2><button onClick={()=>setActive(null)} className="rounded-lg px-3 py-2 text-slate-300">Close</button></div>{url&&<iframe src={url} title={active.template_name} className="mt-4 h-[50vh] w-full rounded-xl bg-white"/>}<div className="mt-5 grid gap-4 md:grid-cols-2">{(active.tech_form_templates?.fields||[]).filter(f=>f.type!=="signature").map(f=>f.type==="checkbox"?<label key={f.id} className="flex items-center gap-3 rounded-xl border border-white/10 p-3 text-sm text-slate-300"><input type="checkbox" checked={Boolean(values[f.id])} onChange={e=>setValues(v=>({...v,[f.id]:e.target.checked}))}/><span>{f.label}{f.required&&" *"}</span></label>:<label key={f.id} className="text-sm text-slate-300">{f.label}{f.required&&" *"}<input type={f.type==="date"?"date":"text"} value={String(values[f.id]??"")} onChange={e=>setValues(v=>({...v,[f.id]:e.target.value}))} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5"/></label>)}<label className="text-sm text-slate-300">Printed signer name<input value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5"/></label><div><div className="text-sm text-slate-300">Signature</div><canvas ref={canvas} width={700} height={180} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} className="mt-1 h-36 w-full touch-none rounded-xl bg-white"/><button onClick={clear} className="mt-1 text-xs text-slate-400">Clear signature</button></div></div><label className="mt-4 flex items-start gap-3 text-sm text-slate-300"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} className="mt-1"/><span>I consent to use an electronic signature and agree that my electronic signature is the legal equivalent of my handwritten signature.</span></label><button disabled={busy} onClick={()=>void submit()} className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy?"Saving…":"Complete, Sign and Submit"}</button></div></div>}</main>}
