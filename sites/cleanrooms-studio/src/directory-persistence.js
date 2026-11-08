/* Independent directory records never become planning metadata or plan revisions. */
(() => {
  'use strict';
  const Model=globalThis.CleanRoomsDirectoryRecords||(typeof require==='function'?require('./directory-records.js'):null);
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const failure=(message,status=503)=>({ok:false,status,message});
  function create({transport,onReconciled=()=>{},maxCatalogRecords=20000,maxCatalogBytes=64*1024*1024,maxProfiles=32,maxProfileBytes=32*1024*1024}={}){
    if(!Model||typeof transport?.directoryRead!=='function'||typeof transport?.directoryWrite!=='function')throw new TypeError('Medarbejderregisterets forbindelse mangler.');
    let records=new Map(),profiles=new Map(),header=null,catalogRevision=null,ready=false,epoch=0,loadGeneration=0,loading=null,workspaceId=null,writeQueue=Promise.resolve(),session=0,writing=0;
    const pointGenerations=new Map();
    function receipt(value){if(!object(value)||value.schema!==1||!Number.isSafeInteger(value.revision)||value.revision<0||value.nextSiteIndex!==undefined&&(!Number.isInteger(value.nextSiteIndex)||value.nextSiteIndex<0||value.nextSiteIndex>2000))throw new TypeError('Medarbejderregisterets version kunne ikke bekræftes.');return clone(value);}
    function row(value){if(!object(value)||!Model.KINDS.includes(value.kind)||!Model.validId(value.kind,value.id)||!Number.isSafeInteger(value.version)||value.version<1||!object(value.value)||value.value.id!==value.id||!Model.safe(value.value)||value.siteIndex!==undefined&&(value.kind!=='site'||!Number.isInteger(value.siteIndex)||value.siteIndex<0||value.siteIndex>=2000)||value.kind==='site'&&!Number.isInteger(value.siteIndex)||value.position!==undefined&&(!Number.isSafeInteger(value.position)||value.position<0))throw new TypeError('En post i medarbejderregisteret er ugyldig.');return clone(value);}
    function bindWorkspace(value){const id=value?.workspace?.id;if(id!==undefined){if(typeof id!=='string'||!id||workspaceId&&workspaceId!==id)throw new TypeError('Medarbejderregisterets arbejdsområde er ændret. Genindlæs siden.');workspaceId=id;}}
    function latest(value){const next=receipt(value);if(!header||next.revision>=header.revision)header=next;}
    function snapshot(extra={}){const rows=[...records.values()].map(clone),assembled=Model.assemble(rows);return {ok:true,directory:clone(header),records:rows,catalog:assembled,staff:assembled.roster,organization:assembled.organization,ready,coverageValid:ready&&header?.revision===catalogRevision,catalogRevision,...extra};}
    function announce(extra={}){const value=snapshot(extra);onReconciled(clone(value));return value;}
    function compact(value){return {...value,value:Model.catalog(value.kind,value.value)};}
    function keepProfile(value){const key=Model.key(value.kind,value.id);profiles.delete(key);profiles.set(key,clone(value));let total=[...profiles.values()].reduce((sum,item)=>sum+bytes(item),0);while(profiles.size>1&&(profiles.size>maxProfiles||total>maxProfileBytes)){const oldest=profiles.keys().next().value;total-=bytes(profiles.get(oldest));profiles.delete(oldest);}}
    function apply(values,{details=false}={}){
      const staged=new Map(records),accepted=[];for(const input of values){const value=row(input),key=Model.key(value.kind,value.id),old=staged.get(key),next=compact(value);
        if(old&&old.version>value.version)continue;
        if(old&&old.version===value.version&&Model.canonical(old.value)!==Model.canonical(next.value))throw new TypeError('En post har ændret indhold uden et nyt versionsnummer.');
        staged.set(key,next);accepted.push(value);
      }
      records=staged;for(const value of accepted){const key=Model.key(value.kind,value.id);if(details)keepProfile(value);else if(profiles.get(key)?.version!==value.version)profiles.delete(key);}
    }
    function replace(value,rows){const next=new Map();for(const input of rows){const item=compact(row(input)),key=Model.key(item.kind,item.id);if(next.has(key)&&Model.canonical(next.get(key))!==Model.canonical(item))throw new TypeError('Medarbejderregisteret indeholder gentagne poster.');next.set(key,item);}
      const sites=[...next.values()].filter(item=>item.kind==='site').sort((a,b)=>a.siteIndex-b.siteIndex);if(sites.some((item,index)=>item.siteIndex!==index)||value.nextSiteIndex!==undefined&&sites.length!==value.nextSiteIndex)throw new TypeError('Arbejdsstedernes faste rækkefølge kunne ikke bekræftes.');
      records=next;for(const [key,profile]of profiles)if(records.get(key)?.version!==profile.version)profiles.delete(key);header=receipt(value);catalogRevision=header.revision;ready=true;
    }
    function bootstrap(result){const directory=receipt(result.directory);if(directory.complete!==true)return false;let rows=result.records;
      if(!rows&&result.studio){if(!Array.isArray(result.studio.roster)||!object(result.studio.organization)||!Array.isArray(result.studio.organization.sites)||!Array.isArray(result.studio.organization.departments)||!object(directory.versions))throw new TypeError('Medarbejderregisterets postversioner mangler.');rows=Model.flatten({roster:result.studio.roster,organization:result.studio.organization}).map(value=>({...value,version:directory.versions[Model.key(value.kind,value.id)]}));if(Object.keys(directory.versions).length!==rows.length)throw new TypeError('Medarbejderregisterets katalog er ufuldstændigt.');}
      if(!Array.isArray(rows))throw new TypeError('Medarbejderregisterets katalog mangler.');bindWorkspace(result);if(header&&directory.revision<header.revision)return false;replace(directory,rows);return true;
    }
    function reconcile(result){try{if(!object(result)||!result.directory)return failure('Medarbejderregisterets kvittering mangler.',400);bindWorkspace(result);if(bootstrap(result))return announce({complete:true});const directory=receipt(result.directory);if(Array.isArray(result.records))apply(result.records,{details:true});latest(directory);return announce({complete:false});}catch(error){return failure(error.message,409);}}
    async function loadCatalog({force=false}={}){
      if(writing)await writeQueue;
      if(ready&&header?.revision===catalogRevision&&!force)return snapshot({cached:true});if(loading&&!force)return loading;
      const generation=++loadGeneration,work=(async()=>{await writeQueue;const started=epoch;
        for(let attempt=0;attempt<2;attempt++){
          const rows=new Map(),cursors=new Set();let cursor=null,first=null,size=0,retry=false;
          for(;;){const result=await transport.directoryRead({catalog:true,limit:500,...(cursor?{cursor}:{})});if(generation!==loadGeneration||started!==epoch)return {ok:false,superseded:true};if(!result.ok){if(result.status===409&&attempt===0){retry=true;break;}return result;}
            bindWorkspace(result);const directory=receipt(result.directory);if(!first)first=directory;else if(directory.revision!==first.revision||directory.nextSiteIndex!==first.nextSiteIndex)throw new TypeError('Medarbejderregisteret er ændret under indlæsningen.');if(!Array.isArray(result.records))throw new TypeError('Medarbejderregisterets poster mangler.');
            size+=bytes(result);if(size>maxCatalogBytes)throw new RangeError('Medarbejderregisteret indeholder for mange data til denne visning.');for(const input of result.records){const item=row(input),key=Model.key(item.kind,item.id);if(rows.has(key)&&Model.canonical(rows.get(key))!==Model.canonical(item))throw new TypeError('En post ændrede sig under indlæsningen.');rows.set(key,item);}if(rows.size>maxCatalogRecords)throw new RangeError('Medarbejderregisteret indeholder for mange poster til denne visning.');
            cursor=result.nextCursor??null;if(cursor===null){if(header&&first.revision<header.revision)return {ok:false,superseded:true};replace(first,[...rows.values()]);return announce({complete:true});}if(typeof cursor!=='string'||!cursor||cursor.length>16384||cursors.has(cursor))throw new TypeError('Medarbejderregisterets sidehenvisning er ugyldig.');cursors.add(cursor);
          }
          if(!retry)break;
        }
        return failure('Medarbejderregisteret ændrer sig. Prøv igen.',409);
      })().catch(error=>failure(error.message));loading=work;try{return await work;}finally{if(loading===work)loading=null;}
    }
    async function get(kind,id,{force=false}={}){
      if(writing)await writeQueue;
      if(!Model.KINDS.includes(kind)||!Model.validId(kind,id))return failure('Vælg en gyldig post.',400);const key=Model.key(kind,id);if(!force&&profiles.has(key)){const value=profiles.get(key);profiles.delete(key);profiles.set(key,value);return {ok:true,directory:clone(header),record:clone(value),records:[clone(value)],cached:true};}
      const generation=(pointGenerations.get(key)||0)+1;pointGenerations.set(key,generation);await writeQueue;const started=epoch;
      try{const result=await transport.directoryRead({kind,ids:[id]});if(generation!==pointGenerations.get(key)||started!==epoch)return {ok:false,superseded:true};if(!result.ok)return result;bindWorkspace(result);const directory=receipt(result.directory);if(!Array.isArray(result.records)||result.records.length>1)throw new TypeError('Postens oplysninger kunne ikke bekræftes.');if(!result.records.length)return failure('Posten findes ikke længere.',404);const value=row(result.records[0]);if(value.kind!==kind||value.id!==id)throw new TypeError('Postens identitet stemmer ikke overens.');apply([value],{details:true});latest(directory);announce({complete:false});return {ok:true,directory,record:clone(value),records:[clone(value)]};}catch(error){return failure(error.message);}
    }
    function commit(changes){const errors=Model.validateChanges(changes);if(errors.length)return Promise.resolve(failure(errors[0],400));if(!changes.length)return Promise.resolve(snapshot({records:[]}));const captured=clone(changes),started=session;epoch++;loadGeneration++;writing++;const work=writeQueue.then(async()=>{
        if(started!==session)return {ok:false,superseded:true};try{const result=await transport.directoryWrite({changes:captured});if(started!==session)return {ok:false,superseded:true};if(!result.ok)return result;bindWorkspace(result);const directory=receipt(result.directory),requested=new Map(captured.map(value=>[Model.key(value.kind,value.id),value])),seen=new Set();if(!Array.isArray(result.records)||result.records.length!==requested.size)throw new TypeError('Gemningen mangler en kvittering for berørte poster.');for(const input of result.records){const value=row(input),key=Model.key(value.kind,value.id),change=requested.get(key);if(!change||seen.has(key)||![change.expectedVersion,change.expectedVersion+1].includes(value.version)||change.expectedVersion===0&&value.version!==1)throw new TypeError('Gemningens postversioner stemmer ikke overens.');seen.add(key);}apply(result.records,{details:true});latest(directory);announce({complete:false});return {...clone(result),ok:true};}catch(error){return failure(error.message);}
      }).finally(()=>{writing--;});writeQueue=work.then(()=>undefined,()=>undefined);return work;
    }
    function reset(){session++;epoch++;loadGeneration++;pointGenerations.clear();records=new Map();profiles=new Map();header=null;catalogRevision=null;ready=false;workspaceId=null;loading=null;}
    return {loadCatalog,get,commit,reconcile,reset,version:(kind,id)=>records.get(Model.key(kind,id))?.version??0,get records(){return [...records.values()].map(clone);},get versions(){return Object.fromEntries([...records].map(([key,value])=>[key,value.version]));},get catalog(){return Model.assemble([...records.values()]);},get staff(){return Model.assemble([...records.values()]).roster;},get organization(){return Model.assemble([...records.values()]).organization;},get revision(){return header?.revision??null;},get catalogRevision(){return catalogRevision;},get coverageValid(){return ready&&header?.revision===catalogRevision;},get ready(){return ready;},get directory(){return clone(header);}};
  }
  const api=Object.freeze({create});globalThis.CleanRoomsDirectory=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
