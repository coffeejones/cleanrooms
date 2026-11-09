/* Versioned editor commands are merged with current server-owned plan state. */
import Planning from '../src/planning-records.js';
import {StudioError} from './studio-store.mjs';
import {planningCoreErrors} from './planning-validation.mjs';
const clone=value=>JSON.parse(JSON.stringify(value));
const fail=(status,code,message,conflicts)=>{const error=new StudioError(status,code,message);if(conflicts)error.conflicts=conflicts;throw error;};

export function planningReceipt(saved){
  const value=saved?.planning;
  return value?{schema:value.schema,versions:value.versions,metadataHash:value.metadataHash}:undefined;
}

export function preparePlanningSubmission(payload,saved){
  const errors=Planning.validatePlanning(payload.planning);
  if(errors.length)fail(400,'invalid_planning_command',errors[0]);
  const receipt=saved.planning;
  if(!receipt)fail(409,'planning_reload_required','Hent den seneste plan, før du gemmer.');
  const changes=clone(payload.planning.changes),versions=receipt.versions||{},conflicts=[];
  for(const change of changes){
    if(change.kind==='week')continue; // Derived UI cache has a conservative merge policy.
    const version=versions[Planning.key(change.kind,change.id)]||0;
    if(version!==change.expectedVersion)conflicts.push({kind:change.kind,id:change.id,expectedVersion:change.expectedVersion,version});
  }
  const dependencies=Planning.checkDependencies(saved.studio||{},versions,payload.planning.dependencies,changes);
  if(!dependencies.ok)conflicts.push(...dependencies.conflicts);
  if(conflicts.length)fail(409,'planning_record_changed','En af de berørte vagter eller vagtserier er ændret. Hent den seneste version.',conflicts);
  if(payload.planning.metadataChanged&&payload.planning.metadataBase!==receipt.metadataHash)fail(409,'planning_metadata_changed','Virksomheds- eller planindstillingerne er ændret. Hent den seneste version.');
  let next=clone(saved.studio||{});
  if(payload.planning.metadataChanged){
    const before=Planning.metadata(next),after=Planning.metadata(payload.studio);
    for(const field of Object.keys(before))if(!Object.hasOwn(after,field))delete next[field];
    Object.assign(next,after);
    // Older clients still submit complete directory collections as metadata.
    // The legacy adapter checks permissions and entity versions before storing them.
    for(const field of ['roster','organization'])if(Object.hasOwn(payload.studio,field))next[field]=clone(payload.studio[field]);
  }
  for(const change of changes)if(change.kind==='week'){
    change.value=Planning.rebaseWeek(next.weekPlans?.[change.id],change.value);
    change.expectedVersion=versions[Planning.key(change.kind,change.id)]||0;
  }
  try{next=Planning.apply(next,changes);}catch(error){fail(400,'invalid_planning_command',error.message);}
  const coreErrors=planningCoreErrors(next,saved.studio);if(coreErrors.length)fail(400,'invalid_studio',coreErrors[0]);
  return {studio:next,changes,rebased:payload.revision!==saved.revision};
}
