/* Tenant-scoped directory references are rechecked in the committing SQL. */
import Data from '../src/studio-data.js';
const encode=new TextEncoder();
const fail=(status,code,message)=>{const error=new Error(message);error.status=status;error.code=code;throw error;};
const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
function documents(values){const result=[];let current=[],bytes=2;for(const value of values){const serialized=JSON.stringify(value),size=encode.encode(serialized).length;if(size+2>512*1024)fail(413,'directory_references_too_large','En reference er for stor.');if(current.length&&bytes+size+1>512*1024){result.push('['+current.join(',')+']');current=[];bytes=2;}current.push(serialized);bytes+=size+1;}if(current.length||!result.length)result.push('['+current.join(',')+']');return result;}
function source(values){const parts=documents(values);return {sql:parts.map(()=>'SELECT value FROM json_each(?)').join(' UNION ALL '),values:parts};}
function people(values){if(!Array.isArray(values)||values.some(id=>typeof id!=='string'||id.length>512||/[\u0000-\u001f\u007f]/.test(id)))fail(400,'directory_person_invalid','Vælg gyldige medarbejdere.');return [...new Set(values.filter(Boolean))];}
function sites(values){if(!Array.isArray(values)||values.some(index=>!Number.isInteger(index)||index<0||index>=2000))fail(400,'directory_site_invalid','Vælg gyldige arbejdssteder.');return [...new Set(values)];}

export function directoryVersionGuard({workspaceId,version,token}){
  if(!Number.isSafeInteger(version)||version<0||token!==undefined&&typeof token!=='string')fail(400,'directory_version_invalid','Indlæs medarbejdere og arbejdssteder igen.');
  return {sql:`EXISTS (SELECT 1 FROM workspace_directory_state directory WHERE directory.workspace_id=? AND directory.version=?${token===undefined?'':' AND directory.write_token=?'})`,values:[workspaceId,version,...(token===undefined?[]:[token])]};
}

export function employeeReferenceGuard({workspaceId,personIds=[],active=false}){
  const ids=people(personIds);if(!ids.length)return {sql:'1=1',values:[]};const chosen=source(ids);
  return {sql:`NOT EXISTS (SELECT 1 FROM (${chosen.sql}) chosen LEFT JOIN workspace_directory_records employee ON employee.workspace_id=? AND employee.kind='employee' AND employee.id=chosen.value AND employee.deleted=0${active?' AND employee.active=1':''} WHERE employee.id IS NULL)`,values:[...chosen.values,workspaceId]};
}

export function siteReferenceGuard({workspaceId,siteIndices=[]}){
  const indices=sites(siteIndices);if(!indices.length)return {sql:'1=1',values:[]};const chosen=source(indices);
  return {sql:`NOT EXISTS (SELECT 1 FROM (${chosen.sql}) chosen LEFT JOIN workspace_directory_records site ON site.workspace_id=? AND site.kind='site' AND site.site_index=chosen.value AND site.deleted=0 WHERE site.id IS NULL)`,values:[...chosen.values,workspaceId]};
}

export function siteIdentityGuard({workspaceId,identities=[]}){
  if(!Array.isArray(identities)||identities.some(item=>!record(item)||typeof item.id!=='string'||!item.id))fail(400,'directory_site_invalid','Arbejdsstedets identitet er ugyldig.');sites(identities.map(item=>item.index));const chosen=source(identities);
  return {sql:`NOT EXISTS (SELECT 1 FROM (${chosen.sql}) chosen LEFT JOIN workspace_directory_records site ON site.workspace_id=? AND site.kind='site' AND site.site_index=json_extract(chosen.value,'$.index') AND site.id=json_extract(chosen.value,'$.id') AND site.deleted=0 WHERE site.id IS NULL)`,values:[...chosen.values,workspaceId]};
}

export function employeeRemovalGuard({workspaceId,personIds=[]}){
  const ids=people(personIds);if(!ids.length)return {sql:'1=1',values:[]};const chosen=source(ids),refs=[
    ['workspace_members','person_id'],['workspace_invites','person_id'],['workspace_plan_records','person_id'],['workspace_published_shifts','person_id'],['workspace_absences','person_id'],['workspace_time_entries','person_id'],['workspace_payroll','person_id'],['workspace_payroll_revisions','person_id'],['workspace_checklist_tasks','person_id'],['workspace_shift_messages','person_id'],['workspace_message_receipts','person_id'],['workspace_shift_requests','from_person_id'],['workspace_shift_requests','to_person_id']
  ].map(([table,column])=>`EXISTS (SELECT 1 FROM ${table} referenced WHERE referenced.workspace_id=tenant.id AND referenced.${column}=removed.value)`);
  refs.push("EXISTS (SELECT 1 FROM workspace_payroll_policies policy,json_tree(policy.config) linked WHERE policy.workspace_id=tenant.id AND linked.key='personId' AND linked.value=removed.value)","EXISTS (SELECT 1 FROM workspace_payroll_policies policy,json_tree(policy.history) linked WHERE policy.workspace_id=tenant.id AND linked.key='personId' AND linked.value=removed.value)","EXISTS (SELECT 1 FROM workspace_timekeeping ledger,json_each(ledger.config,'$.entries') entry WHERE ledger.workspace_id=tenant.id AND json_extract(entry.value,'$.personId')=removed.value)");
  return {sql:`EXISTS (SELECT 1 FROM workspace_plan_imports WHERE workspace_id=?) AND NOT EXISTS (SELECT 1 FROM (${chosen.sql}) removed CROSS JOIN (SELECT ? AS id) tenant WHERE ${refs.join(' OR ')})`,values:[workspaceId,...chosen.values,workspaceId]};
}

export async function assertDirectoryReferences({db,...options}){
  const guards=[employeeReferenceGuard(options),siteReferenceGuard(options)],sql=guards.map(guard=>'('+guard.sql+')').join(' AND '),values=guards.flatMap(guard=>guard.values),result=await db.batch([db.prepare('SELECT 1 AS allowed WHERE '+sql).bind(...values)]);if(!result[0]?.results?.length)fail(409,'directory_reference_changed','En medarbejder eller et arbejdssted er ændret. Indlæs oplysningerne igen.');
}

export async function directoryPlanningContext({db,workspaceId,studio,personIds=[],siteIndices=[],includeDemo=true}){
  sites(siteIndices);const Directory=await import('./directory-store.mjs'),header=await Directory.readDirectoryHeader({db,workspaceId});if(!header)fail(409,'directory_missing','Indlæs medarbejdere og arbejdssteder igen.');
  const referenced=[...personIds,...(studio.series||[]).map(item=>item.person),...Object.values(studio.edits||{}).map(item=>item.person),...Object.values(studio.publications?.slots||{}).flatMap(slot=>slot.shifts||[]).map(item=>item.person)].filter(id=>typeof id==='string'&&id),ids=people([...referenced,...(includeDemo&&studio.demoSeed!==false?Data.staff.map(person=>person.id):[])]),records=[],versions={},siteRows=[];let cursor=null;
  for(let start=0;start<ids.length;start+=500){const result=await Directory.readDirectoryRecords({db,workspaceId,kind:'employee',ids:ids.slice(start,start+500),catalog:true});records.push(...result.records);for(const row of result.records)versions[JSON.stringify([row.kind,row.id])]=row.version;}
  do{const page=await Directory.readDirectoryPage({db,workspaceId,kind:'site',cursor,limit:500,catalog:true});siteRows.push(...page.records);cursor=page.nextCursor;}while(cursor);
  const workSites=[];for(const row of siteRows){const index=row.siteIndex??row.site_index??row.position;if(!Number.isInteger(index)||index<0||index>=2000||workSites[index])fail(500,'directory_sites_invalid','Arbejdsstedernes faste numre kunne ikke læses.');workSites[index]=row.value;}
  if(workSites.length!==header.next_site_index||[...workSites].some(site=>!site))fail(500,'directory_sites_invalid','Et arbejdssted mangler sit faste nummer.');
  const current=await Directory.readDirectoryHeader({db,workspaceId});if(current?.version!==header.version||current?.write_token!==header.write_token)fail(409,'directory_changed','Medarbejdere eller arbejdssteder er ændret. Indlæs igen.');
  const next={...studio,roster:records.filter(row=>row.kind==='employee'&&row.value).map(row=>row.value),organization:{version:1,sites:workSites,departments:[]}},directory={schema:1,revision:header.version,nextSiteIndex:header.next_site_index,versions};Object.defineProperty(next,'directory',{value:directory,enumerable:false});return {studio:next,directory,header,guard:directoryVersionGuard({workspaceId,version:header.version,token:header.write_token})};
}
