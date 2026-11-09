import Model from '../src/payroll-export-profile-model.js';
import {archiveStatements} from './activity-store.mjs';
const query=(db,sql,...values)=>db.prepare(sql).bind(...values);
const all=async(db,sql,...values)=>(await db.batch([query(db,sql,...values)]))[0]?.results??[];
const first=async(...args)=>(await all(...args))[0]??null;
const validId=value=>typeof value==='string'&&/^pex-[0-9a-f-]{36}$/.test(value);
const summary=row=>({id:row.id,name:row.name,version:row.version,updatedAt:row.updated_at,archived:Boolean(row.archived_at),builtIn:false});
const builtin={id:'standard-v1',name:'Standard CSV',version:1,builtIn:true};
function parse(config,h){try{return Model.normalize(typeof config==='string'?JSON.parse(config):config);}catch{h.fail(503,'payroll_export_profile_invalid','Eksportprofilen kunne ikke læses sikkert.');}}
const permission=(context,h,manage=false)=>{
  const caps=h.capabilities(context);if(!caps.viewPayroll||manage&&!caps.managePayroll)h.fail(403,'payroll_export_profile_forbidden','Din rolle har ikke adgang til eksportprofiler.');
  return h.actorGuard(context,['plan','payroll.view',...(manage?['payroll.manage']:[])]);
};
function profileVersion(value,h){if(!Number.isSafeInteger(value)||value<0||value>=Number.MAX_SAFE_INTEGER)h.fail(400,'payroll_export_profile_version','Hent den seneste eksportprofil.');return value;}
async function profileRow(db,context,id,h){if(!validId(id))h.fail(400,'payroll_export_profile_id','Vælg en gyldig eksportprofil.');const row=await first(db,'SELECT * FROM workspace_payroll_export_profiles WHERE workspace_id=? AND id=?',context.workspace.id,id);if(!row)h.fail(404,'payroll_export_profile_missing','Eksportprofilen findes ikke i virksomheden.');return row;}

/** A historical profile version stays readable after changes or archiving. */
export async function resolvePayrollExportProfile({db,context,profileId,profileVersion:version,helpers:h}){
  permission(context,h);const head=await profileRow(db,context,profileId,h);
  if(version===undefined&&head.archived_at)h.fail(409,'payroll_export_profile_archived','Eksportprofilen er arkiveret. Vælg et aktivt format.');
  const selected=version===undefined?head.version:profileVersion(version,h);
  if(selected<1)h.fail(400,'payroll_export_profile_version','Vælg en gemt profilversion.');
  const revision=await first(db,'SELECT config FROM workspace_payroll_export_profile_revisions WHERE workspace_id=? AND profile_id=? AND version=?',context.workspace.id,profileId,selected);
  if(!revision)h.fail(404,'payroll_export_profile_revision_missing','Denne version af eksportprofilen findes ikke.');
  const profile=parse(revision.config,h);await h.assertContext(db,context);
  return {id:profileId,version:selected,name:profile.name,serialize(rows,options){try{return Model.serialize(rows,profile,options);}catch(error){h.fail(422,'payroll_export_profile_incomplete',error.message||'Kontrollér eksportprofilens lønnumre og lønarter.');}}};
}

export async function handlePayrollExportProfileAction({db,context,payload,principal,helpers:h}){
  const manage=['payrollExportProfileSave','payrollExportProfileArchive'].includes(payload.action),actor=permission(context,h,manage),workspaceId=context.workspace.id;
  const allowed={payrollExportProfilesRead:[],payrollExportProfileRead:['profileId'],payrollExportProfileSave:['profileId','creationId','version','profile'],payrollExportProfileArchive:['profileId','version'],payrollExportProfileEmployees:['query','cursor','limit','includeArchived']}[payload.action];
  if(!allowed||Object.keys(payload).some(key=>key!=='action'&&!allowed.includes(key)))h.fail(400,'payroll_export_profile_payload','Send en gyldig profilhandling.');
  if(payload.profileId!==undefined&&!validId(payload.profileId))h.fail(400,'payroll_export_profile_id','Vælg en gyldig eksportprofil.');
  if(payload.creationId!==undefined&&(payload.profileId!==undefined||typeof payload.creationId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.creationId)||payload.version!==0))h.fail(400,'payroll_export_profile_creation','Genindlæs profilen, før den oprettes.');
  if(payload.action==='payrollExportProfilesRead'){
    const rows=await all(db,'SELECT id,name,version,updated_at,archived_at FROM workspace_payroll_export_profiles WHERE workspace_id=? AND archived_at IS NULL ORDER BY name,id LIMIT 26',workspaceId);
    await h.assertContext(db,context);return {profiles:[builtin,...rows.sort((a,b)=>a.name.localeCompare(b.name,'da-DK')||a.id.localeCompare(b.id)).map(summary)],fields:Model.fields,kinds:Model.kinds,canManage:h.capabilities(context).managePayroll};
  }
  if(payload.action==='payrollExportProfileEmployees'){
    const search=payload.query??'',limit=payload.limit??25,includeArchived=payload.includeArchived??false;
    if(typeof search!=='string'||search.length>100||/[\u0000-\u001f\u007f]/.test(search)||!Number.isSafeInteger(limit)||limit<1||limit>100||typeof includeArchived!=='boolean')h.fail(400,'payroll_export_profile_search','Søg efter navn eller medarbejder-id.');
    const term=search.trim().toLocaleLowerCase('da-DK'),head=await first(db,'SELECT version FROM workspace_directory_state WHERE workspace_id=?',workspaceId),version=head?.version??0;
    let after=null;if(payload.cursor!==undefined&&payload.cursor!==null){try{if(typeof payload.cursor!=='string'||payload.cursor.length>4096)throw Error();after=JSON.parse(Buffer.from(payload.cursor,'base64url').toString('utf8'));if(after.v!==1||after.workspaceId!==workspaceId||after.version!==version||after.term!==term||after.includeArchived!==includeArchived||typeof after.name!=='string'||typeof after.id!=='string')throw Error();}catch{h.fail(409,'payroll_export_profile_directory_changed','Medarbejderlisten er ændret. Søg igen.');}}
    const where="workspace_id=? AND kind='employee' AND (?=1 OR(deleted=0 AND active=1)) AND (?='' OR instr(name_sort,?)>0 OR instr(lower(id),?)>0)",values=[workspaceId,Number(includeArchived),term,term,term];
    const rows=await all(db,`SELECT id,active,deleted,name_sort,catalog FROM workspace_directory_records WHERE ${where}${after?' AND(name_sort>? OR(name_sort=? AND id>?))':''} ORDER BY name_sort,id LIMIT ?`,...values,...(after?[after.name,after.name,after.id]:[]),limit+1),total=await first(db,`SELECT COUNT(*) AS n FROM workspace_directory_records WHERE ${where}`,...values),latest=await first(db,'SELECT version FROM workspace_directory_state WHERE workspace_id=?',workspaceId);
    if((latest?.version??0)!==version)h.fail(409,'payroll_export_profile_directory_changed','Medarbejderlisten er ændret. Søg igen.');
    const page=rows.slice(0,limit),people=page.map(row=>{let catalog;try{catalog=JSON.parse(row.catalog);}catch{catalog=null;}return {id:row.id,name:catalog?.name||row.id,archived:row.deleted===1||row.active!==1};}),last=page.at(-1);
    await h.assertContext(db,context);return {people,total:total?.n??0,nextCursor:rows.length>limit&&last?Buffer.from(JSON.stringify({v:1,workspaceId,version,term,includeArchived,name:last.name_sort,id:last.id})).toString('base64url'):null,directoryVersion:version};
  }
  if(payload.action==='payrollExportProfileRead'){
    const row=await profileRow(db,context,payload.profileId,h),revisions=await all(db,'SELECT version,created_at FROM workspace_payroll_export_profile_revisions WHERE workspace_id=? AND profile_id=? ORDER BY version DESC LIMIT 100',workspaceId,row.id);
    await h.assertContext(db,context);return {profile:{...summary(row),config:parse(row.config,h)},revisions:revisions.map(item=>({version:item.version,createdAt:item.created_at})),canManage:h.capabilities(context).managePayroll};
  }
  const version=profileVersion(payload.version,h),row=payload.profileId?await profileRow(db,context,payload.profileId,h):null;
  if(row&&(row.version!==version||row.archived_at)||!row&&version!==0)h.fail(409,'payroll_export_profile_changed','Eksportprofilen er ændret. Hent den igen.');
  if(payload.action==='payrollExportProfileArchive'&&!row)h.fail(400,'payroll_export_profile_missing','Vælg en profil, der skal arkiveres.');
  let config;if(payload.action==='payrollExportProfileSave'){try{config=Model.normalize(payload.profile);}catch(error){h.fail(400,'payroll_export_profile_invalid',error.message);}
    if(payload.creationId){const existing=await first(db,'SELECT * FROM workspace_payroll_export_profiles WHERE workspace_id=? AND id=?',workspaceId,'pex-'+payload.creationId);if(existing){if(existing.version!==1||existing.archived_at||JSON.stringify(parse(existing.config,h))!==JSON.stringify(config))h.fail(409,'payroll_export_profile_changed','Profilen er allerede oprettet. Hent den fra listen, før du ændrer den.');await h.assertContext(db,context);return {profile:{...summary(existing),config:parse(existing.config,h)},canManage:true};}}
    const ids=Object.keys(config.employeeNumbers);if(ids.length){const unknown=await first(db,"SELECT value AS id FROM json_each(?) candidate WHERE NOT EXISTS(SELECT 1 FROM workspace_directory_records employee WHERE employee.workspace_id=? AND employee.kind='employee' AND employee.id=candidate.value) LIMIT 1",JSON.stringify(ids),workspaceId);if(unknown)h.fail(400,'payroll_export_profile_employee','Et lønnummer er knyttet til en medarbejder, der ikke findes i virksomheden.');}
  }else config=parse(row.config,h);
  const id=row?.id??'pex-'+(payload.creationId??crypto.randomUUID()),nextVersion=version+1,at=new Date().toISOString(),token=crypto.randomUUID(),archive=payload.action==='payrollExportProfileArchive',encoded=JSON.stringify(config);
  const receipt={sql:'EXISTS(SELECT 1 FROM workspace_payroll_export_profiles WHERE workspace_id=? AND id=? AND version=? AND write_token=?)',values:[workspaceId,id,nextVersion,token]};
  const write=row?query(db,`UPDATE workspace_payroll_export_profiles SET name=?,version=?,config=?,write_token=?,updated_at=?,archived_at=? WHERE workspace_id=? AND id=? AND version=? AND archived_at IS NULL AND ${actor.sql}`,config.name,nextVersion,encoded,token,at,archive?at:null,workspaceId,id,version,...actor.values):query(db,`INSERT INTO workspace_payroll_export_profiles(workspace_id,id,name,version,config,write_token,created_at,updated_at) SELECT ?,?,?,1,?,?,?,? WHERE ${actor.sql} AND(SELECT COUNT(*) FROM workspace_payroll_export_profiles WHERE workspace_id=? AND archived_at IS NULL)<25 ON CONFLICT(workspace_id,id) DO NOTHING`,workspaceId,id,config.name,encoded,token,at,at,...actor.values,workspaceId);
  const result=await db.batch([write,query(db,`INSERT INTO workspace_payroll_export_profile_revisions(workspace_id,profile_id,version,config,created_at,created_by) SELECT ?,?,?,?,?,? WHERE ${receipt.sql}`,workspaceId,id,nextVersion,encoded,at,principal.userId,...receipt.values),...archiveStatements({db,workspaceId,condition:receipt,entries:[{id:'payroll-profile-'+token,at,actor:{userId:principal.userId,name:principal.name},kind:'payroll',summary:archive?'Eksportprofil arkiveret':'Eksportprofil gemt',areas:['payroll'],personIds:[],counts:{total:1},changes:[{field:'payrollExportProfile',after:{id,name:config.name,version:nextVersion,archived:archive}}],recoverable:false}]})]);
  await h.assertContext(db,context);if(result[0]?.meta?.changes!==1){
    if(!row&&payload.creationId){const existing=await first(db,'SELECT * FROM workspace_payroll_export_profiles WHERE workspace_id=? AND id=?',workspaceId,id);if(existing?.version===1&&!existing.archived_at&&JSON.stringify(parse(existing.config,h))===encoded){await h.assertContext(db,context);return {profile:{...summary(existing),config:parse(existing.config,h)},canManage:true};}}
    h.fail(409,'payroll_export_profile_changed',row?'Eksportprofilen eller din adgang er ændret. Hent profilen igen.':'Profilen kunne ikke oprettes. Brug højst 25 aktive profiler.');
  }
  return {profile:{id,name:config.name,version:nextVersion,updatedAt:at,archived:archive,builtIn:false,config},canManage:true};
}
