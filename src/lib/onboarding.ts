export type OnbRow = {
  id?: string; archivedAt?: string;
  location?: string; manager?: string; fullName?: string; address?: string; email?: string; phone?: string; drugZip?: string; dlNumber?: string; dlExpiration?: string; birthDate?: string; techNum?: string; region?: string; startDate?: string; bg?: string; drug?: string; paperwork?: boolean; credentials?: boolean; tools?: boolean; truck?: boolean; meter?: boolean; mentor?: string; notes?: string; submittedAt?: string;
};
const ONB_LOCAL_KEY="nexportal_onboarding_candidates_v1"; const ONB_DELETED_KEY="nexportal_onboarding_deleted_v1";
export function loadLocalCandidates(): OnbRow[]{try{return JSON.parse(localStorage.getItem(ONB_LOCAL_KEY)||"[]")}catch{return []}}
export function saveLocalCandidates(rows:OnbRow[]){localStorage.setItem(ONB_LOCAL_KEY,JSON.stringify(rows))}
export function loadOnbDeleted():string[]{try{return JSON.parse(localStorage.getItem(ONB_DELETED_KEY)||"[]")}catch{return []}}
export function saveOnbDeleted(list:string[]){try{localStorage.setItem(ONB_DELETED_KEY,JSON.stringify(list))}catch{}}
export function onbKey(r:OnbRow){return [r.location||"",r.manager||"",r.fullName||"",r.submittedAt||""].join("|")}
export const ONB_SHEET_CSV_URL=(import.meta as any)?.env?.VITE_ONB_SHEET_CSV_URL||"https://docs.google.com/spreadsheets/d/e/2PACX-1vSfB75pE7p-8EaCs_zR1APkHsJoKz_8D36ZDi-LrSZqZm3SI3kGT1iL-jaH70TzB24tFnTJl_fud_uJ/pub?gid=1034762031&single=true&output=csv";
const ONB_API_URL=(import.meta as any)?.env?.VITE_ONB_API_URL||"https://script.google.com/macros/s/AKfycbzmjtEk8kgu3CNoJ6dFPP6mudAtI7p31R4lAPnwb_88lo0E_k0Xwm-AQfzRs87U7kAuJQ/exec";
export async function sendOnboardingToSheet(row:OnbRow){if(!ONB_API_URL)return;try{await fetch(ONB_API_URL,{method:"POST",mode:"no-cors",body:JSON.stringify({candidate:row})})}catch(err){console.error("Failed to send onboarding to Sheet",err)}}
function splitCsvRow(row:string){const result:string[]=[];let current="",inQuotes=false;for(let i=0;i<row.length;i++){const char=row[i],next=row[i+1];if(char==='"'&&inQuotes&&next==='"'){current+='"';i++}else if(char==='"')inQuotes=!inQuotes;else if(char===","&&!inQuotes){result.push(current);current=""}else current+=char}result.push(current);return result.map(v=>v.trim())}
export function parseOnbCsvToRows(csv:string):OnbRow[]{const lines=csv.trim().split(/\r?\n/);if(lines.length<=1)return[];return lines.slice(1).map(line=>{const c=splitCsvRow(line);return{location:c[1]||"",manager:c[2]||"",fullName:c[3]||"",address:c[4]||"",email:c[5]||"",phone:c[6]||"",drugZip:c[7]||"",dlNumber:c[8]||"",dlExpiration:c[9]||"",birthDate:c[10]||"",bg:c[11]||"pending",drug:c[12]||"pending",paperwork:/^true$/i.test(c[13]||""),credentials:/^true$/i.test(c[14]||""),tools:/^true$/i.test(c[15]||""),truck:/^true$/i.test(c[16]||""),meter:/^true$/i.test(c[17]||""),mentor:c[18]||"",notes:c[19]||"",submittedAt:c[20]||c[0]||""}})}
