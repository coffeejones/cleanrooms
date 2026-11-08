/* Department conversation rows never enter a planning snapshot or grant access. */
import {StudioError} from './studio-store.mjs';
import {readDirectoryHeader} from './directory-store.mjs';
const encode=new TextEncoder(),decode=new TextDecoder('utf-8',{fatal:true});
const fail=(status,code,message)=>{throw new StudioError(status,code,message);};
const statement=(db,sql,...values)=>{if(values.length>100)fail(413,'chat_query_too_large','Handlingen indeholder for mange oplysninger.');return db.prepare(sql).bind(...values);};
const rows=async(db,sql,...values)=>(await db.batch([statement(db,sql,...values)]))[0]?.results||[];
const first=async(...args)=>(await rows(...args))[0]||null;
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=512&&value===value.trim()&&!['__proto__','constructor','prototype'].includes(value)&&!/[\u0000-\u001f\u007f]/.test(value);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const safeText=value=>typeof value==='string'&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const and=(...conditions)=>({sql:conditions.map(value=>'('+value.sql+')').join(' AND '),values:conditions.flatMap(value=>value.values)});
const stamp=()=>new Date().toISOString();
const cursorEncode=value=>btoa(String.fromCharCode(...encode.encode(JSON.stringify(value))));
function cursorDecode(value){try{if(typeof value!=='string'||value.length>8192)throw Error();return JSON.parse(decode.decode(Uint8Array.from(atob(value),char=>char.charCodeAt(0))));}catch{fail(400,'chat_cursor_invalid','Sidehenvisningen til samtalen er ugyldig.');}}
const authorName=(name,example)=>example===1&&typeof name==='string'?name.replace(/^Demo · /,''):name;
const message=row=>({id:row.id,seq:row.seq,text:row.text,authorId:row.author_id,authorName:authorName(row.author_name,row.demo),createdAt:row.created_at,pinned:row.pinned===1,demo:row.demo===1});
function name(value){if(!safeText(value)||/[\u0000-\u001f\u007f]/.test(value)||!value.trim()||value!==value.trim()||value.length>120)fail(400,'chat_name_invalid','Navnet skal være udfyldt uden ydre mellemrum og højst 120 tegn.');return value;}
function allowedPayload(payload){
 const fields={chatList:['cursor','limit','previewPersonId'],chatRead:['roomId','before','limit','previewPersonId'],chatSync:['roomId','afterSeq','version','limit','previewPersonId'],chatCreate:['departmentId','name'],chatUpdate:['roomId','name','version'],chatSend:['roomId','clientId','text'],chatPin:['roomId','messageId','pinned','version'],chatReadMark:['roomId','throughSeq'],chatMute:['roomId','muted'],chatDemo:[]}[payload.action];
 if(!fields||Object.keys(payload).some(key=>key!=='action'&&!fields.includes(key)))fail(400,'chat_payload_invalid','Samtalens oplysninger er ugyldige.');
 if(payload.previewPersonId!==undefined&&!['chatList','chatRead','chatSync'].includes(payload.action))fail(403,'chat_preview_readonly','Medarbejdervisningen er kun en forhåndsvisning.');
}
function actorFacts(context,payload){
 const preview=payload.previewPersonId!==undefined;
 if(preview&&(!context.role.permissions.includes('plan')||!context.role.permissions.includes('chat.manage')||!validId(payload.previewPersonId)))fail(403,'chat_preview_forbidden','Din rolle kan ikke forhåndsvise medarbejdernes chatrum.');
 return {preview,manager:!preview&&context.role.permissions.includes('chat.manage'),personId:preview?payload.previewPersonId:context.member.personId};
}
function principalGuard(context,facts,h){
 const acl=h.actorGuard(context,facts.preview?['plan','chat.manage']:facts.manager?['chat.manage']:[]);
 if(facts.manager)return acl;
 if(!validId(facts.personId))fail(403,'chat_person_required','Din konto skal være knyttet til en aktiv medarbejder for at bruge chat.');
 return and(acl,{sql:"EXISTS (SELECT 1 FROM workspace_directory_records me WHERE me.workspace_id=? AND me.kind='employee' AND me.id=? AND me.deleted=0 AND me.active=1)",values:[context.workspace.id,facts.personId]});
}
function directoryGuard(context,header){return {sql:'EXISTS (SELECT 1 FROM workspace_directory_state directory WHERE directory.workspace_id=? AND directory.version=? AND directory.write_token=?)',values:[context.workspace.id,header.version,header.write_token]};}
function roomAccess(context,facts,alias='room'){
 const dep=`EXISTS (SELECT 1 FROM workspace_directory_records department WHERE department.workspace_id=${alias}.workspace_id AND department.kind='department' AND department.id=${alias}.department_id AND department.deleted=0`;
 if(facts.manager)return {sql:dep+')',values:[]};
 return {sql:dep+" AND EXISTS (SELECT 1 FROM workspace_directory_records me JOIN json_each(department.catalog,'$.siteIds') site ON site.value=me.site_index WHERE me.workspace_id=department.workspace_id AND me.kind='employee' AND me.id=? AND me.deleted=0 AND me.active=1))",values:[facts.personId]};
}
async function readHeader(db,context){const header=await readDirectoryHeader({db,workspaceId:context.workspace.id});if(!header)fail(409,'chat_directory_required','Indlæs virksomhedens afdelinger, før chatten åbnes.');return header;}
async function fence(db,context,guard,h){await h.assertContext(db,context);if(!await first(db,'SELECT 1 AS valid WHERE '+guard.sql,...guard.values))fail(409,'chat_access_changed','Afdelingen eller din adgang er ændret. Åbn chatten igen.');}
async function authorizeRoom(db,context,facts,roomId,base){
 if(!validId(roomId))fail(400,'chat_room_invalid','Vælg et gyldigt chatrum.');const access=roomAccess(context,facts),room=await first(db,`SELECT room.* FROM workspace_chat_rooms room WHERE room.workspace_id=? AND room.id=? AND ${access.sql}`,context.workspace.id,roomId,...access.values);
 if(!room)fail(403,'chat_room_forbidden','Du har ikke adgang til dette chatrum.');
 const condition=and(base,{sql:`EXISTS (SELECT 1 FROM workspace_chat_rooms room WHERE room.workspace_id=? AND room.id=? AND ${access.sql})`,values:[context.workspace.id,roomId,...access.values]});return {room,condition};
}
function wireRoom(row,facts){return {id:row.id,departmentId:row.department_id,departmentName:row.department_name,name:row.name,version:row.version,latestSeq:row.latest_seq,unread:facts.preview?0:row.unread,muted:row.muted===1,memberCount:row.member_count,demo:row.demo===1,lastMessage:row.last_id?{id:row.last_id,seq:row.last_seq,text:row.last_text,authorName:authorName(row.last_author_name,row.last_demo),createdAt:row.last_created_at}:null};}
async function roomSummaries(db,context,facts,{roomId,after='',limit=101}={}){
 const access=roomAccess(context,facts),readerId=facts.preview?null:context.member.userId;
 const result=await rows(db,`SELECT room.*,json_extract(department.catalog,'$.name') department_name,
 COALESCE(reader.last_read_seq,0) read_seq,COALESCE(reader.muted,0) muted,
 (SELECT COUNT(*) FROM json_each(department.catalog,'$.siteIds') site CROSS JOIN workspace_directory_records employee INDEXED BY workspace_directory_site WHERE employee.workspace_id=room.workspace_id AND employee.kind='employee' AND employee.site_index=site.value AND employee.deleted=0 AND employee.active=1) member_count,
 (SELECT COUNT(*) FROM workspace_chat_messages item WHERE item.workspace_id=room.workspace_id AND item.room_id=room.id AND item.seq>COALESCE(reader.last_read_seq,0) AND item.author_id<>?) unread,
 last.id last_id,last.seq last_seq,substr(last.text,1,160) last_text,last.author_name last_author_name,last.demo last_demo,last.created_at last_created_at
 FROM workspace_chat_rooms room JOIN workspace_directory_records department ON department.workspace_id=room.workspace_id AND department.kind='department' AND department.id=room.department_id AND department.deleted=0
 LEFT JOIN workspace_chat_readers reader ON reader.workspace_id=room.workspace_id AND reader.room_id=room.id AND reader.user_id=?
 LEFT JOIN workspace_chat_messages last ON last.workspace_id=room.workspace_id AND last.room_id=room.id AND last.seq=room.latest_seq
 WHERE room.workspace_id=? AND ${roomId?'room.id=?':'room.id>?'} AND ${access.sql} ORDER BY room.id LIMIT ?`,context.member.userId,readerId,context.workspace.id,roomId||after,...access.values,limit);
 return result.map(row=>wireRoom(row,facts));
}
async function roomSummary(db,context,facts,roomId){const room=(await roomSummaries(db,context,facts,{roomId,limit:1}))[0];if(!room)fail(403,'chat_room_forbidden','Du har ikke længere adgang til dette chatrum.');return room;}
async function verifyRoomVersion(db,workspaceId,room,summary){
 const current=await first(db,'SELECT version,latest_seq FROM workspace_chat_rooms WHERE workspace_id=? AND id=?',workspaceId,room.id);
 if(!current||summary.version!==room.version||current.version!==room.version)fail(409,'chat_sync_changed','Samtalen blev ændret under opdateringen. Prøv igen.');return current;
}
function cursorFacts(context,facts){return {workspace:context.workspace.id,user:context.member.userId,person:facts.personId??null,preview:facts.preview};}
function assertCursor(cursor,expected){if(!plain(cursor)||Object.keys(expected).some(key=>cursor[key]!==expected[key]))fail(400,'chat_cursor_invalid','Sidehenvisningen tilhører en anden samtale eller konto.');}

export async function handleChatAction({db,context,payload,helpers:h}){
 allowedPayload(payload);const facts=actorFacts(context,payload),header=await readHeader(db,context),base=and(principalGuard(context,facts,h),directoryGuard(context,header)),workspaceId=context.workspace.id;
 await fence(db,context,base,h);
 const shared={canManage:facts.manager,readonly:facts.preview,accessKey:[context.member.version,context.role.id,context.role.version,header.version,facts.preview?facts.personId:''].join(':'),viewer:{userId:context.member.userId,name:context.member.name}};
 if(payload.action==='chatList'){
  const limit=payload.limit??100;if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'chat_limit_invalid','Vælg højst 100 chatrum ad gangen.');
  let after='';if(payload.cursor!==undefined){const cursor=cursorDecode(payload.cursor);assertCursor(cursor,{...cursorFacts(context,facts),kind:'rooms'});if(!validId(cursor.after))fail(400,'chat_cursor_invalid','Sidehenvisningen er ugyldig.');after=cursor.after;}
  const found=await roomSummaries(db,context,facts,{after,limit:limit+1}),selected=found.slice(0,limit),rooms=selected;
  const departments=[];if(facts.manager){const values=await rows(db,`SELECT department.id,json_extract(department.catalog,'$.name') name,
   (SELECT COUNT(*) FROM json_each(department.catalog,'$.siteIds') site CROSS JOIN workspace_directory_records employee INDEXED BY workspace_directory_site WHERE employee.workspace_id=department.workspace_id AND employee.kind='employee' AND employee.site_index=site.value AND employee.deleted=0 AND employee.active=1) member_count,
   EXISTS(SELECT 1 FROM workspace_chat_rooms room WHERE room.workspace_id=department.workspace_id AND room.department_id=department.id) has_room
   FROM workspace_directory_records department WHERE department.workspace_id=? AND department.kind='department' AND department.deleted=0 ORDER BY department.name_sort,department.id LIMIT 1001`,workspaceId);if(values.length>1000)fail(413,'chat_departments_too_many','Virksomheden har for mange afdelinger til denne oversigt.');for(const row of values)departments.push({id:row.id,name:row.name,memberCount:row.member_count,hasRoom:Boolean(row.has_room)});}
  const access=roomAccess(context,facts),unreadRow=facts.preview?{n:0}:await first(db,`SELECT SUM((SELECT COUNT(*) FROM workspace_chat_messages item WHERE item.workspace_id=room.workspace_id AND item.room_id=room.id AND item.seq>COALESCE(reader.last_read_seq,0) AND item.author_id<>?)) n
   FROM workspace_chat_rooms room LEFT JOIN workspace_chat_readers reader ON reader.workspace_id=room.workspace_id AND reader.room_id=room.id AND reader.user_id=?
   WHERE room.workspace_id=? AND COALESCE(reader.muted,0)=0 AND ${access.sql}`,context.member.userId,context.member.userId,workspaceId,...access.values);
  await fence(db,context,base,h);return {...shared,rooms,departments,unreadCount:Number(unreadRow?.n||0),nextCursor:found.length>limit?cursorEncode({...cursorFacts(context,facts),kind:'rooms',after:selected.at(-1).id}):null};
 }
 if(payload.action==='chatCreate'){
  if(!facts.manager)fail(403,'chat_manage_required','Din rolle kan ikke oprette chatrum.');if(!validId(payload.departmentId))fail(400,'chat_department_invalid','Vælg en gyldig afdeling.');const title=name(payload.name),department=await first(db,"SELECT id FROM workspace_directory_records WHERE workspace_id=? AND kind='department' AND id=? AND deleted=0",workspaceId,payload.departmentId);if(!department)fail(404,'chat_department_missing','Afdelingen findes ikke længere.');
  if(await first(db,'SELECT id FROM workspace_chat_rooms WHERE workspace_id=? AND department_id=?',workspaceId,payload.departmentId))fail(409,'chat_room_exists','Afdelingen har allerede et chatrum.');
  const id='chat-'+crypto.randomUUID(),at=stamp(),token=crypto.randomUUID(),condition=and(base,{sql:"EXISTS (SELECT 1 FROM workspace_directory_records WHERE workspace_id=? AND kind='department' AND id=? AND deleted=0)",values:[workspaceId,payload.departmentId]});
  const result=await db.batch([statement(db,`INSERT INTO workspace_chat_rooms(workspace_id,id,department_id,name,version,latest_seq,write_token,created_by,created_at,updated_at,demo) SELECT ?,?,?,?,1,0,?,?,?,?,0 WHERE ${condition.sql} ON CONFLICT(workspace_id,department_id) DO NOTHING`,workspaceId,id,payload.departmentId,title,token,context.member.userId,at,at,...condition.values)]);
  await fence(db,context,condition,h);if(result[0]?.meta?.changes!==1)fail(409,'chat_room_exists','Afdelingen har allerede et chatrum.');const summary=await roomSummary(db,context,facts,id);await fence(db,context,condition,h);return {...shared,room:summary};
 }
 if(payload.action==='chatDemo')return seedDemo({db,context,facts,base,h,shared});
 const {room,condition}=await authorizeRoom(db,context,facts,payload.roomId,base);
 if(payload.action==='chatSync'){
  const afterSeq=payload.afterSeq,version=payload.version,limit=payload.limit??50;
  if(!Number.isSafeInteger(afterSeq)||afterSeq<0||afterSeq>room.latest_seq)fail(400,'chat_sequence_invalid','Hent samtalen igen, før nye beskeder læses.');
  if(!Number.isSafeInteger(version)||version<1)fail(400,'chat_version_invalid','Hent chatrummet igen, før nye beskeder læses.');
  if(!Number.isInteger(limit)||limit<1||limit>50)fail(400,'chat_limit_invalid','Vælg højst 50 beskeder ad gangen.');
  // Unchanged conversations need no history, pins or roster/count projection.
  if(afterSeq===room.latest_seq&&version===room.version){await fence(db,context,condition,h);return {...shared,unchanged:true,latestSeq:room.latest_seq,version:room.version,throughSeq:afterSeq,hasMoreNew:false};}
  const found=await rows(db,'SELECT * FROM workspace_chat_messages WHERE workspace_id=? AND room_id=? AND seq>? ORDER BY seq ASC LIMIT ?',workspaceId,room.id,afterSeq,limit+1),selected=[];let bytes=0;
  for(const row of found.slice(0,limit)){const size=encode.encode(row.text).length+1024;if(selected.length&&bytes+size>512*1024)break;if(row.seq!==afterSeq+selected.length+1)fail(409,'chat_sync_changed','Samtalens beskeder er ændret. Hent samtalen igen.');selected.push(row);bytes+=size;}
  let pins;
  if(version!==room.version){const values=await rows(db,'SELECT * FROM workspace_chat_messages WHERE workspace_id=? AND room_id=? AND pinned=1 ORDER BY seq DESC LIMIT 4',workspaceId,room.id);if(values.length>3)fail(500,'chat_pins_invalid','Samtalens fastgjorte beskeder kunne ikke bekræftes.');pins=values.reverse().map(message);}
  const summary=await roomSummary(db,context,facts,room.id);
  // Never acknowledge a newer pin/name version than the body actually read.
  const current=await verifyRoomVersion(db,workspaceId,room,summary);
  const throughSeq=selected.at(-1)?.seq??afterSeq,latestSeq=Math.max(current.latest_seq,summary.latestSeq,throughSeq);
  if(!selected.length&&latestSeq>afterSeq)fail(409,'chat_sync_changed','Samtalens beskeder er ændret. Hent samtalen igen.');
  await fence(db,context,condition,h);
  return {...shared,unchanged:false,room:summary,messages:selected.map(message),...(pins?{pins}:{}),throughSeq,hasMoreNew:latestSeq>throughSeq,latestSeq,version:room.version};
 }
 if(payload.action==='chatRead'){
  const limit=payload.limit??50;if(!Number.isInteger(limit)||limit<1||limit>50)fail(400,'chat_limit_invalid','Vælg højst 50 beskeder ad gangen.');let before=Number.MAX_SAFE_INTEGER;
  if(payload.before!==undefined){const cursor=cursorDecode(payload.before);assertCursor(cursor,{...cursorFacts(context,facts),kind:'messages',room:room.id});if(!Number.isSafeInteger(cursor.before)||cursor.before<1)fail(400,'chat_cursor_invalid','Sidehenvisningen er ugyldig.');before=cursor.before;}
  const found=await rows(db,'SELECT * FROM workspace_chat_messages WHERE workspace_id=? AND room_id=? AND seq<? ORDER BY seq DESC LIMIT ?',workspaceId,room.id,before,limit+1),selected=[];let bytes=0;for(const row of found.slice(0,limit)){const size=encode.encode(row.text).length+1024;if(selected.length&&bytes+size>512*1024)break;selected.push(row);bytes+=size;}
  const hasMore=found.length>selected.length,pins=await rows(db,'SELECT * FROM workspace_chat_messages WHERE workspace_id=? AND room_id=? AND pinned=1 ORDER BY seq DESC LIMIT 4',workspaceId,room.id);if(pins.length>3)fail(500,'chat_pins_invalid','Samtalens fastgjorte beskeder kunne ikke bekræftes.');const summary=await roomSummary(db,context,facts,room.id);await verifyRoomVersion(db,workspaceId,room,summary);await fence(db,context,condition,h);return {...shared,room:summary,messages:selected.reverse().map(message),pins:pins.reverse().map(message),hasMore,nextCursor:hasMore?cursorEncode({...cursorFacts(context,facts),kind:'messages',room:room.id,before:selected[0].seq}):null};
 }
 if(facts.preview)fail(403,'chat_preview_readonly','Medarbejdervisningen er kun en forhåndsvisning.');
 if(payload.action==='chatSend'){
  if(!validId(payload.clientId)||payload.clientId.length>120)fail(400,'chat_client_invalid','Beskedens identitet er ugyldig.');if(!safeText(payload.text)||!payload.text.trim()||payload.text.length>10000||encode.encode(payload.text).length>40*1024)fail(400,'chat_text_invalid','Skriv en besked på højst 10.000 tegn.');
  const previous=await first(db,'SELECT * FROM workspace_chat_messages WHERE workspace_id=? AND room_id=? AND author_id=? AND client_id=?',workspaceId,room.id,context.member.userId,payload.clientId);
  if(previous){if(previous.text!==payload.text)fail(409,'chat_client_conflict','Beskedens identitet er allerede brugt til en anden tekst.');await fence(db,context,condition,h);const summary=await roomSummary(db,context,facts,room.id);await fence(db,context,condition,h);return {...shared,message:message(previous),room:summary};}
  const token=crypto.randomUUID(),at=stamp(),id='message-'+crypto.randomUUID(),receipt={sql:'EXISTS (SELECT 1 FROM workspace_chat_rooms WHERE workspace_id=? AND id=? AND write_token=?)',values:[workspaceId,room.id,token]};
  await db.batch([statement(db,`UPDATE workspace_chat_rooms SET latest_seq=latest_seq+1,write_token=?,updated_at=? WHERE workspace_id=? AND id=? AND latest_seq<9007199254740990 AND ${condition.sql} AND NOT EXISTS (SELECT 1 FROM workspace_chat_messages WHERE workspace_id=? AND room_id=? AND author_id=? AND client_id=?)`,token,at,workspaceId,room.id,...condition.values,workspaceId,room.id,context.member.userId,payload.clientId),statement(db,`INSERT INTO workspace_chat_messages(workspace_id,room_id,id,seq,author_id,author_name,client_id,text,created_at,pinned,demo) SELECT workspace_id,id,?,latest_seq,?,?,?,?,?,0,0 FROM workspace_chat_rooms WHERE workspace_id=? AND id=? AND ${receipt.sql} AND ${condition.sql}`,id,context.member.userId,context.member.name,payload.clientId,payload.text,at,workspaceId,room.id,...receipt.values,...condition.values)]);
  await fence(db,context,condition,h);const saved=await first(db,'SELECT * FROM workspace_chat_messages WHERE workspace_id=? AND room_id=? AND author_id=? AND client_id=?',workspaceId,room.id,context.member.userId,payload.clientId);if(!saved||saved.text!==payload.text)fail(409,'chat_send_changed','Beskeden kunne ikke gemmes. Prøv igen.');const summary=await roomSummary(db,context,facts,room.id);await fence(db,context,condition,h);return {...shared,message:message(saved),room:summary};
 }
 if(payload.action==='chatUpdate'||payload.action==='chatPin'){
  if(!facts.manager)fail(403,'chat_manage_required','Din rolle kan ikke administrere chatrum.');if(!Number.isSafeInteger(payload.version)||payload.version<1)fail(400,'chat_version_invalid','Hent chatrummet igen, før ændringen gemmes.');if(room.version!==payload.version)fail(409,'chat_room_changed','Chatrummet er ændret. Hent det igen.');if(room.version>=Number.MAX_SAFE_INTEGER)fail(409,'chat_version_exhausted','Chatrummets version kan ikke øges sikkert.');
  const at=stamp(),token=crypto.randomUUID();let mutations=[];
  if(payload.action==='chatUpdate')mutations=[statement(db,`UPDATE workspace_chat_rooms SET name=?,version=version+1,write_token=?,updated_at=? WHERE workspace_id=? AND id=? AND version=? AND ${condition.sql}`,name(payload.name),token,at,workspaceId,room.id,payload.version,...condition.values)];
  else{
   if(!validId(payload.messageId)||typeof payload.pinned!=='boolean')fail(400,'chat_pin_invalid','Vælg en gyldig besked.');const chosen=await first(db,'SELECT pinned FROM workspace_chat_messages WHERE workspace_id=? AND room_id=? AND id=?',workspaceId,room.id,payload.messageId);if(!chosen)fail(404,'chat_message_missing','Beskeden findes ikke i chatrummet.');
   if(Boolean(chosen.pinned)===payload.pinned){await fence(db,context,condition,h);const summary=await roomSummary(db,context,facts,room.id);await fence(db,context,condition,h);return {...shared,room:summary};}
   if(payload.pinned&&(await first(db,'SELECT COUNT(*) n FROM workspace_chat_messages WHERE workspace_id=? AND room_id=? AND pinned=1',workspaceId,room.id)).n>=3)fail(400,'chat_pin_limit','Der kan højst være tre fastgjorte beskeder i et rum.');
   const receipt={sql:'EXISTS (SELECT 1 FROM workspace_chat_rooms WHERE workspace_id=? AND id=? AND version=? AND write_token=?)',values:[workspaceId,room.id,payload.version+1,token]};
   mutations=[statement(db,`UPDATE workspace_chat_rooms SET version=version+1,write_token=?,updated_at=? WHERE workspace_id=? AND id=? AND version=? AND ${condition.sql} AND (?=0 OR (SELECT COUNT(*) FROM workspace_chat_messages WHERE workspace_id=? AND room_id=? AND pinned=1)<3)`,token,at,workspaceId,room.id,payload.version,...condition.values,Number(payload.pinned),workspaceId,room.id),statement(db,`UPDATE workspace_chat_messages SET pinned=? WHERE workspace_id=? AND room_id=? AND id=? AND ${receipt.sql} AND ${condition.sql}`,Number(payload.pinned),workspaceId,room.id,payload.messageId,...receipt.values,...condition.values)];
  }
  const result=await db.batch(mutations);await fence(db,context,condition,h);if(result[0]?.meta?.changes!==1||mutations.length>1&&result[1]?.meta?.changes!==1)fail(409,'chat_room_changed','Chatrummet er ændret. Hent det igen.');const summary=await roomSummary(db,context,facts,room.id);await fence(db,context,condition,h);return {...shared,room:summary};
 }
 if(payload.action==='chatReadMark'||payload.action==='chatMute'){
  const marking=payload.action==='chatReadMark';if(marking&&(!Number.isSafeInteger(payload.throughSeq)||payload.throughSeq<0||payload.throughSeq>room.latest_seq))fail(400,'chat_read_invalid','Læsestatus skal pege på en eksisterende besked.');if(!marking&&typeof payload.muted!=='boolean')fail(400,'chat_mute_invalid','Vælg om chatrummet skal være lydløst.');
  const at=stamp(),result=await db.batch([statement(db,`INSERT INTO workspace_chat_readers(workspace_id,room_id,user_id,last_read_seq,muted,updated_at) SELECT ?,?,?,?,?,? WHERE ${condition.sql} ON CONFLICT(workspace_id,room_id,user_id) DO UPDATE SET ${marking?'last_read_seq=MAX(workspace_chat_readers.last_read_seq,excluded.last_read_seq)':'muted=excluded.muted'},updated_at=excluded.updated_at`,workspaceId,room.id,context.member.userId,marking?payload.throughSeq:0,marking?0:Number(payload.muted),at,...condition.values)]);await fence(db,context,condition,h);if(result[0]?.meta?.changes!==1)fail(409,'chat_access_changed','Din adgang til chatrummet er ændret.');const summary=await roomSummary(db,context,facts,room.id);await fence(db,context,condition,h);return {...shared,room:summary};
 }
 fail(400,'chat_action_invalid','Vælg en gyldig chathandling.');
}

async function seedDemo({db,context,facts,base,h,shared}){
 if(!facts.manager)fail(403,'chat_manage_required','Kun en person med chatrettigheder kan tilføje demoeksempler.');const departments=await rows(db,"SELECT id,catalog FROM workspace_directory_records WHERE workspace_id=? AND kind='department' AND deleted=0 ORDER BY position,id LIMIT 2",context.workspace.id),roomIds=[];
 const examples=[[
  ['Demo · Teamleder','Velkommen til afdelingens chat. Brug rummet til praktiske aftaler om arbejdsdagen.',true],
  ['Demo · Medarbejder','Jeg har lagt de ekstra nøglekort i skabet ved indgangen.',false],
  ['Demo · Teamleder','Tak! Husk at skrive her, hvis der mangler udstyr, så vi kan få det med på næste levering.',false]
 ],[
  ['Demo · Teamleder','Her samler vi beskeder om den daglige drift hos kunden.',true],
  ['Demo · Medarbejder','Der er snart ikke flere affaldsposer i depotet. Kan vi få en ekstra kasse?',false],
  ['Demo · Teamleder','Ja, jeg tager en kasse med i morgen.',false]
 ]];
 for(let index=0;index<departments.length;index++){
  const dep=departments[index],existing=await first(db,'SELECT id FROM workspace_chat_rooms WHERE workspace_id=? AND department_id=?',context.workspace.id,dep.id);
  // User-created rooms are never modified by the demo helper.
  if(existing){roomIds.push(existing.id);continue;}
  let definition;try{definition=JSON.parse(dep.catalog);}catch{fail(500,'chat_department_invalid','Afdelingen kunne ikke læses.');}
  const id='chat-demo-'+crypto.randomUUID(),at=stamp(),token=crypto.randomUUID(),condition=and(base,{sql:"EXISTS (SELECT 1 FROM workspace_directory_records WHERE workspace_id=? AND kind='department' AND id=? AND deleted=0)",values:[context.workspace.id,dep.id]}),receipt={sql:'EXISTS (SELECT 1 FROM workspace_chat_rooms WHERE workspace_id=? AND id=? AND write_token=? AND demo=1)',values:[context.workspace.id,id,token]},write=and(condition,receipt);
  const mutations=[statement(db,`INSERT INTO workspace_chat_rooms(workspace_id,id,department_id,name,version,latest_seq,write_token,created_by,created_at,updated_at,demo) SELECT ?,?,?,?,1,3,?,?,?,?,1 WHERE ${condition.sql} ON CONFLICT(workspace_id,department_id) DO NOTHING`,context.workspace.id,id,dep.id,definition.name,token,context.member.userId,at,at,...condition.values)];
  examples[index].forEach(([author,text,pinned],position)=>mutations.push(statement(db,`INSERT INTO workspace_chat_messages(workspace_id,room_id,id,seq,author_id,author_name,client_id,text,created_at,pinned,demo) SELECT ?,?,?,?,?,?,?,?,?,?,1 WHERE ${write.sql}`,context.workspace.id,id,'demo-message-'+crypto.randomUUID(),position+1,'chat-demo-person-'+position,author,'demo-'+position,text,new Date(Date.parse(at)-(3-position)*3600000).toISOString(),Number(pinned),...write.values)));
  await db.batch(mutations);await fence(db,context,condition,h);const saved=await first(db,'SELECT id FROM workspace_chat_rooms WHERE workspace_id=? AND department_id=?',context.workspace.id,dep.id);if(saved)roomIds.push(saved.id);
 }
 const rooms=[];for(const id of roomIds)rooms.push(await roomSummary(db,context,facts,id));await fence(db,context,base,h);return {...shared,rooms};
}
