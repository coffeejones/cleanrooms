/* Membership scope selects where existing role permissions can be exercised. */
import Departments from '../src/department-model.js';
import Directory from '../src/directory-records.js';
const clone=value=>JSON.parse(JSON.stringify(value));
const allScope=()=>({mode:'all',departmentIds:[]});
export class DepartmentAccessError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const fail=(status,code,message)=>{throw new DepartmentAccessError(status,code,message);};
const rows=async(db,sql,...values)=>(await db.batch([db.prepare(sql).bind(...values)]))[0]?.results||[];
export function normalizeAccessScope(value,{stored=false}={}){
 if(value===undefined)return allScope();
 const invalid=()=>fail(stored?403:400,'department_scope_invalid',stored?'Kontoens afdelingsadgang kunne ikke bekræftes.':'Vælg hele virksomheden eller mindst én gyldig afdeling.');
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['mode','departmentIds'].includes(key))||!['all','departments'].includes(value.mode)||!Array.isArray(value.departmentIds)||value.departmentIds.length>1000||value.departmentIds.some(id=>!Directory.validId('department',id))||new Set(value.departmentIds).size!==value.departmentIds.length)invalid();
 if(value.mode==='all'&&value.departmentIds.length||value.mode==='departments'&&!value.departmentIds.length)invalid();
 return {mode:value.mode,departmentIds:[...value.departmentIds].sort()};
}
export function storedAccessScope(text){try{return normalizeAccessScope(text===undefined?undefined:JSON.parse(text),{stored:true});}catch(error){if(error instanceof DepartmentAccessError)throw error;fail(403,'department_scope_invalid','Kontoens afdelingsadgang kunne ikke bekræftes.');}}
export const isScoped=context=>context?.access?.mode==='departments'||context?.accessScope?.mode==='departments'||context?.member?.accessScope?.mode==='departments';
export const siteAllowed=(context,index)=>!isScoped(context)||Number.isInteger(index)&&context.access?.siteIds?.includes(index)===true;
export const departmentAllowed=(context,id)=>!isScoped(context)||context.access?.departmentIds?.includes(id)===true;
const column=value=>{if(typeof value!=='string'||!/^\w+(?:\.\w+)*$/.test(value))throw new TypeError('Use an internal SQL column.');return value;};
export function sitePredicate(context,siteColumn){return isScoped(context)?{sql:`${column(siteColumn)} IN (SELECT value FROM json_each(?))`,values:[JSON.stringify(context.access?.siteIds||[])]}:{sql:'1=1',values:[]};}
export const scopeSitePredicate=sitePredicate;
export function jsonSitePredicate(context,configColumn,path='$.site'){if(!['$.site','$.shift.site','$.before.site','$.after.site'].includes(path))throw new TypeError('Use an internal site path.');return isScoped(context)?{sql:`json_extract(${column(configColumn)},'${path}') IN (SELECT value FROM json_each(?))`,values:[JSON.stringify(context.access?.siteIds||[])]}:{sql:'1=1',values:[]};}
export function departmentPredicate(context,departmentColumn){return isScoped(context)?{sql:`${column(departmentColumn)} IN (SELECT value FROM json_each(?))`,values:[JSON.stringify(context.access?.departmentIds||[])]}:{sql:'1=1',values:[]};}
export function personPredicate(context,personColumn){if(!isScoped(context))return {sql:'1=1',values:[]};const sites=sitePredicate(context,'scoped_employee.site_index');return {sql:`EXISTS (SELECT 1 FROM workspace_directory_records scoped_employee WHERE scoped_employee.workspace_id=? AND scoped_employee.kind='employee' AND scoped_employee.id=${column(personColumn)} AND scoped_employee.deleted=0 AND ${sites.sql})`,values:[context.workspace.id,...sites.values]};}
export const scopePersonPredicate=personPredicate;
export function accessGuard(context){if(!isScoped(context))return {sql:'1=1',values:[]};const access=context.access;if(!access||!Number.isSafeInteger(access.directoryVersion)||typeof access.directoryToken!=='string')return {sql:'0=1',values:[]};return {sql:'EXISTS (SELECT 1 FROM workspace_directory_state scope_directory WHERE scope_directory.workspace_id=? AND scope_directory.version=? AND scope_directory.write_token=?)',values:[context.workspace.id,access.directoryVersion,access.directoryToken]};}
export function assertSiteAccess(context,index){if(!siteAllowed(context,index))fail(403,'department_site_forbidden','Arbejdsstedet ligger uden for dine afdelinger.');}
export function assertDepartmentAccess(context,id){if(!departmentAllowed(context,id))fail(403,'department_forbidden','Afdelingen ligger uden for din adgang.');}
export async function assertPersonAccess({db,context,personId}){if(!isScoped(context))return;const scope=personPredicate(context,'employee.id');if(!(await rows(db,"SELECT employee.id FROM workspace_directory_records employee WHERE employee.workspace_id=? AND employee.kind='employee' AND employee.id=? AND employee.deleted=0 AND "+scope.sql,context.workspace.id,personId,...scope.values)).length)fail(403,'department_person_forbidden','Medarbejderen ligger uden for dine afdelinger.');}
export async function assertDirectoryKeysAccess({db,context,kind,ids}){
 if(!isScoped(context))return;
 if(!Array.isArray(ids)||ids.length>500)fail(400,'directory_keys_invalid','Vælg højst 500 gyldige poster.');
 const identities=[...new Map(ids.map(value=>typeof value==='string'?{kind,id:value}:value).map(value=>[Directory.key(value?.kind,value?.id),value])).values()];
 if(identities.some(item=>!item||!Directory.KINDS.includes(item.kind)||!Directory.validId(item.kind,item.id)))fail(400,'directory_keys_invalid','Posternes id er ugyldige.');
 if(!identities.length)return;
 const [row]=await rows(db,`SELECT COUNT(*) n FROM json_each(?) chosen CROSS JOIN workspace_directory_records record WHERE record.workspace_id=? AND record.kind=json_extract(chosen.value,'$.kind') AND record.id=json_extract(chosen.value,'$.id') AND record.deleted=0 AND ((record.kind IN ('employee','site') AND record.site_index IN (SELECT value FROM json_each(?))) OR (record.kind='department' AND record.id IN (SELECT value FROM json_each(?))))`,JSON.stringify(identities),context.workspace.id,JSON.stringify(context.access?.siteIds||[]),JSON.stringify(context.access?.departmentIds||[]));
 if(row?.n!==identities.length)fail(403,'department_directory_forbidden','En af de valgte poster ligger uden for dine afdelinger eller er ikke længere tilgængelig.');
}
export async function loadDepartmentAccess({db,context}){
 const scope=context.member.accessScope??allScope();context.accessScope=clone(scope);
 if(scope.mode==='all'){context.access={...scope,siteIds:null};return context.access;}
 const [head]=await rows(db,'SELECT version,write_token FROM workspace_directory_state WHERE workspace_id=?',context.workspace.id);
 if(!head)fail(403,'department_scope_unavailable','Afdelingsadgangen kunne ikke bekræftes. Genindlæs siden.');
 const departments=await rows(db,"SELECT id,catalog FROM workspace_directory_records WHERE workspace_id=? AND kind='department' AND deleted=0 AND id IN (SELECT value FROM json_each(?)) ORDER BY id",context.workspace.id,JSON.stringify(scope.departmentIds));
 const valid=[];const sites=new Set();for(const department of departments){let value;try{value=JSON.parse(department.catalog);}catch{fail(403,'department_scope_invalid','En afdeling kunne ikke bekræftes.');}if(!Array.isArray(value.siteIds)||value.siteIds.some(site=>!Number.isInteger(site)||site<0||site>=2000))fail(403,'department_scope_invalid','Afdelingens arbejdssteder kunne ikke bekræftes.');valid.push(department.id);value.siteIds.forEach(site=>sites.add(site));}
 context.access={...scope,departmentIds:valid,siteIds:[...sites].sort((a,b)=>a-b),directoryVersion:head.version,directoryToken:head.write_token};return context.access;
}
export async function validateGrantScope({db,context,value,current}){
 const scope=normalizeAccessScope(value===undefined?current??(isScoped(context)?context.member.accessScope:undefined):value);
 if(isScoped(context)&&(scope.mode==='all'||scope.departmentIds.some(id=>!departmentAllowed(context,id))))fail(403,'department_scope_grant_forbidden','Du kan kun give adgang inden for dine egne afdelinger.');
 if(scope.mode==='departments'){
  const found=await rows(db,"SELECT id FROM workspace_directory_records WHERE workspace_id=? AND kind='department' AND deleted=0 AND id IN (SELECT value FROM json_each(?))",context.workspace.id,JSON.stringify(scope.departmentIds));if(found.length!==scope.departmentIds.length)fail(400,'department_scope_invalid','Vælg afdelinger fra den aktuelle virksomhed.');
 }
 return scope;
}
export function grantScopeGuard(context,scope){return scope.mode==='all'?{sql:'1=1',values:[]}:{sql:"(SELECT COUNT(*) FROM workspace_directory_records granted_department WHERE granted_department.workspace_id=? AND granted_department.kind='department' AND granted_department.deleted=0 AND granted_department.id IN (SELECT value FROM json_each(?)))=?",values:[context.workspace.id,JSON.stringify(scope.departmentIds),scope.departmentIds.length]};}
export function assertTargetScope(context,value){if(isScoped(context)&&(value?.mode!=='departments'||value.departmentIds.some(id=>!departmentAllowed(context,id))))fail(403,'department_scope_grant_forbidden','Kontoen har adgang uden for dine afdelinger.');}
export function projectOrganization(context,organization){
 if(!isScoped(context))return organization;const source=organization||Departments.defaultOrganization();return {...clone(source),sites:source.sites.map((site,index)=>siteAllowed(context,index)?clone(site):{id:Departments.LEGACY_SITE_IDS[index]||'restricted-site-'+index,name:'Begrænset arbejdssted',address:'',color:Departments.COLORS[0],restricted:true}),departments:source.departments.filter(department=>departmentAllowed(context,department.id)).map(clone)};
}
export function projectStudioAccess(context,studio){
 if(!isScoped(context)||!studio)return studio;const result=clone(studio),staff=(studio.roster||[]).filter(person=>siteAllowed(context,person.site)),people=new Set(staff.map(person=>person.id));
 result.organization=projectOrganization(context,studio.organization);result.roster=staff;result.demoSeed=false;result.series=(studio.series||[]).filter(series=>siteAllowed(context,series.site)&&(!series.person||people.has(series.person)));result.edits=Object.fromEntries(Object.entries(studio.edits||{}).filter(([,shift])=>siteAllowed(context,shift.site)&&(!shift.person||people.has(shift.person))));
 const ids=new Set([...result.series.map(series=>series.id),...Object.keys(result.edits)]);result.deleted=(studio.deleted||[]).filter(id=>ids.has(id)||result.series.some(series=>id.startsWith(series.id+'@')));
 result.weekPlans=Object.fromEntries(Object.entries(studio.weekPlans||{}).map(([id,value])=>[id,{...Object.fromEntries(['published','baselineKind'].filter(key=>Object.hasOwn(value,key)).map(key=>[key,clone(value[key])])),...(Array.isArray(value.baseline)?{baseline:value.baseline.filter(shift=>siteAllowed(context,shift.site)&&(!shift.person||people.has(shift.person))).map(clone)}:{})}]));
 result.checklistProgress=Object.fromEntries(Object.entries(studio.checklistProgress||{}).filter(([,entry])=>people.has(entry.person)&&(!Number.isInteger(entry.site)||siteAllowed(context,entry.site))));
 result.coverageRules=(studio.coverageRules||[]).filter(rule=>Number.isInteger(rule.site)&&siteAllowed(context,rule.site)).map(clone);result.publications={version:1,sequence:0,slots:{},records:[]};
 result.activity=[];result.shiftWorkflow={schema:1,requests:[],messages:[]};result.requests={};delete result.leaveDecisions;delete result.absences;delete result.absenceHasMore;
 if(result.workspaceSettings)result.workspaceSettings=Object.fromEntries(['companyName','productName','description'].filter(key=>Object.hasOwn(result.workspaceSettings,key)).map(key=>[key,result.workspaceSettings[key]]));
 return result;
}
