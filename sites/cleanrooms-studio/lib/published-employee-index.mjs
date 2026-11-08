/* Derived, note-free employee metadata. Task descriptors contain hashes only;
 * calendar counts never download instruction documents or task signatures. */
import Checklist from '../src/checklist-progress.js';
import Description from '../src/description-model.js';
import Workflow from '../src/shift-workflow-model.js';
import Instructions from '../src/instruction-state.js';
const encoder=new TextEncoder();
const hash=async value=>'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const query=(db,sql,...values)=>db.prepare(sql).bind(...values);
export function employeeDocuments(values){const result=[];let batch=[],bytes=2;for(const value of values){const text=JSON.stringify(value),size=encoder.encode(text).length;if(size>256*1024)throw new RangeError('En opgaves indeks er for stort.');if(batch.length&&bytes+size+1>256*1024){result.push('['+batch.join(',')+']');batch=[];bytes=2;}batch.push(text);bytes+=size+1;}if(batch.length)result.push('['+batch.join(',')+']');return result;}
export async function publishedEmployeeDescriptor(shift,version){
  const view=Checklist.read({},shift),structure=await hash(JSON.stringify(view.tasks.map(task=>task.key))),tasks=await Promise.all(view.tasks.map(async task=>({shiftId:shift.id,key:task.key,signature:await hash(task.signature),structure,version})));
  const rich=Description.normalize(shift.noteRich)||Description.fromText(shift.note||'');
  return {fields:{employee_version:version,has_description:Number(Description.hasContent(rich)),checklist_total:tasks.length,checklist_structure:structure,workflow_fingerprint:Workflow.fingerprint(shift),instruction_token:Instructions.signature(shift),instruction_version:version},tasks};
}
export function publishedEmployeeIndexStatements({db,workspaceId,descriptors,deletedIds=[],condition}){
  const changes=[...descriptors.map(item=>item.id),...deletedIds],statements=[];
  for(const document of employeeDocuments([...new Set(changes)]))statements.push(query(db,`DELETE FROM workspace_published_checklist_items WHERE workspace_id=? AND shift_id IN (SELECT value FROM json_each(?)) AND ${condition.sql}`,workspaceId,document,...condition.values));
  for(const document of employeeDocuments(descriptors.flatMap(item=>item.descriptor.tasks)))statements.push(query(db,`INSERT INTO workspace_published_checklist_items (workspace_id,shift_id,task_key,signature,structure,published_version)
    SELECT ?,json_extract(item.value,'$.shiftId'),json_extract(item.value,'$.key'),json_extract(item.value,'$.signature'),json_extract(item.value,'$.structure'),json_extract(item.value,'$.version') FROM json_each(?) item
    WHERE ${condition.sql} AND EXISTS (SELECT 1 FROM workspace_published_shifts current WHERE current.workspace_id=? AND current.id=json_extract(item.value,'$.shiftId') AND current.version=json_extract(item.value,'$.version') AND current.deleted=0 AND current.employee_version=current.version)`,workspaceId,document,...condition.values,workspaceId));
  return statements;
}
