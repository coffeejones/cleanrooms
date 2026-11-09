const test=require('node:test'),assert=require('node:assert/strict');
const Model=require('../src/payroll-export-profile-model.js'),View=require('../src/payroll-export-profile-view.js');
const walk=element=>[element,...element.children.flatMap(walk)],flush=()=>new Promise(resolve=>setImmediate(resolve));
class Element{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;this.className='';this.attributes={};this.handlers={};this.text='';this.value='';this.hidden=false;this.disabled=false;this.dataset={};}
  set innerHTML(value){throw Error('Profiles must render literal text, not HTML.');}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  append(...children){for(const child of children){child.remove();child.parentElement=this;this.children.push(child);}}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
  replaceChildren(...children){this.children.forEach(child=>child.parentElement=null);this.children=[];this.text='';this.append(...children);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  addEventListener(key,callback){(this.handlers[key]??=[]).push(callback);}
  querySelectorAll(selector){return walk(this).slice(1).filter(item=>selector.split(',').some(tag=>item.tagName===tag.toUpperCase()));}
  focus(){this.ownerDocument.activeElement=this;}
  getClientRects(){return this.hidden?[]:[{}];}
  async fire(type,props={}){for(const callback of this.handlers[type]??[])await callback({target:this,preventDefault(){},stopPropagation(){},...props});await flush();}
  async click(){if(!this.disabled)await this.fire('click');}
}
function deferred(){let resolve;const promise=new Promise(answer=>{resolve=answer;});return{promise,resolve};}
function fixture({manage=true,action,profileId}={}){
  const doc={activeElement:null,createElement:tag=>new Element(tag,doc)},host=new Element('div',doc),commands=[],saved=[];
  const api=async(name,payload)=>{
    commands.push({name,payload:JSON.parse(JSON.stringify(payload))});if(action){const result=await action(name,payload);if(result!==undefined)return result;}
    if(name==='payrollExportProfilesRead')return {ok:true,profiles:[],canManage:manage};
    if(name==='payrollExportProfileEmployees')return {ok:true,people:[],total:0,nextCursor:null};
    if(name==='payrollExportProfileSave')return {ok:true,profile:{id:payload.profileId??'pex-'+payload.creationId,name:payload.profile.name,version:payload.version+1,config:payload.profile,archived:false},canManage:manage};
    throw Error('Unexpected action '+name);
  };
  const view=View.open({element:host,onAction:api,onSaved:value=>saved.push(value),profileId});
  const nodes=()=>walk(host),button=text=>nodes().find(item=>item.tagName==='BUTTON'&&item.textContent===text),input=label=>nodes().find(item=>item.tagName==='INPUT'&&item.attributes['aria-label']===label);
  return{host,view,commands,saved,nodes,button,input};
}

test('profile editor saves literal named configuration through existing actions without a vendor preset claim',async()=>{
  const app=fixture();await flush();const name=app.input('Profilnavn');name.value='Mit lønformat';await name.fire('input');await app.button('Opret profil').click();await flush();
  const writes=app.commands.filter(item=>item.name==='payrollExportProfileSave');assert.equal(writes.length,1);assert.equal(writes[0].payload.profile.name,'Mit lønformat');assert.equal(app.saved.length,1);assert.match(app.host.textContent,/gemt · version 1/);assert.doesNotMatch(app.host.textContent,/e-conomic|Danløn|Dataløn/);app.view.destroy();
});

test('employee mapping UI requests one bounded page, preserves edits while paging, and can include archived staff',async()=>{
  const app=fixture({action:(name,payload)=>{if(name==='payrollExportProfileEmployees'){const second=payload.cursor==='second';return {ok:true,people:[{id:second?'person-bob':'person-anna',name:second?'Bob':'Anna',archived:second}],total:510,nextCursor:second?null:'second'};}}});await flush();await app.button('Medarbejdere').click();await flush();
  assert.equal(app.commands.at(-1).payload.limit,25);let number=app.input('Lønnummer for Anna');number.value='001';await number.fire('input');await app.button('Næste').click();await flush();number=app.input('Lønnummer for Bob');number.value='002';await number.fire('input');await app.button('Forrige').click();await flush();assert.equal(app.input('Lønnummer for Anna').value,'001');
  await app.button('Opret profil').click();await flush();const write=app.commands.find(item=>item.name==='payrollExportProfileSave');assert.deepEqual(write.payload.profile.employeeNumbers,{'person-anna':'001','person-bob':'002'});assert.ok(app.nodes().filter(item=>item.tagName==='TR').length<=26);app.view.destroy();
});

test('read-only salary viewers can inspect configuration but cannot mutate or create profiles',async()=>{
  const app=fixture({manage:false});await flush();assert.equal(app.input('Profilnavn').disabled,true);assert.equal(app.button('Opret profil'),undefined);assert.equal(app.button('Gem profil'),undefined);await app.button('Lønarter').click();assert.equal(app.button('Tilføj lønart'),undefined);assert.equal(app.commands.some(item=>item.name==='payrollExportProfileSave'),false);app.view.destroy();
});

test('failed saves keep the edited profile, and closing unsaved changes requires an explicit discard',async()=>{
  let writes=0;const app=fixture({action:name=>name==='payrollExportProfileSave'&&++writes===1?{ok:false,message:'Forbindelsen mangler.'}:undefined});await flush();const name=app.input('Profilnavn');name.value='Bevar mit format';await name.fire('input');await app.button('Opret profil').click();await flush();assert.equal(app.input('Profilnavn').value,'Bevar mit format');assert.match(app.host.textContent,/Forbindelsen mangler/);await app.button('Luk').click();assert.ok(app.button('Forlad ændringer'));assert.ok(app.host.children.length);await app.button('Annuller').click();assert.equal(app.input('Profilnavn').value,'Bevar mit format');await app.button('Luk').click();await app.button('Forlad ændringer').click();assert.equal(app.host.children.length,0);
});

test('destroying the editor during a pending save discards its late receipt and parent callback',async()=>{
  const pending=deferred(),app=fixture({action:name=>name==='payrollExportProfileSave'?pending.promise:undefined});await flush();await app.button('Opret profil').click();app.view.destroy();pending.resolve({ok:true,profile:{id:'pex-00000000-0000-4000-8000-000000000001',version:1,config:Model.defaults()},canManage:true});await flush();assert.equal(app.saved.length,0);assert.equal(app.host.children.length,0);
});

test('a mismatched save receipt does not become a visible saved profile or parent selection',async()=>{
  const app=fixture({action:name=>name==='payrollExportProfileSave'?{ok:true,profile:{id:'pex-00000000-0000-4000-8000-000000000001',version:9,config:Model.defaults()},canManage:true}:undefined});await flush();const name=app.input('Profilnavn');name.value='Mit korrekte format';await name.fire('input');await app.button('Opret profil').click();await flush();assert.equal(app.saved.length,0);assert.equal(app.input('Profilnavn').value,'Mit korrekte format');assert.match(app.host.textContent,/kunne ikke bekræftes/);app.view.destroy();
});

test('an explicit retry after a lost new-profile save response reuses the same creation identity',async()=>{
  let attempts=0;const app=fixture({action:name=>name==='payrollExportProfileSave'&&++attempts===1?{ok:false,message:'Svaret blev tabt.'}:undefined});await flush();await app.button('Opret profil').click();await flush();await app.button('Opret profil').click();await flush();
  const writes=app.commands.filter(item=>item.name==='payrollExportProfileSave');assert.equal(writes.length,2);assert.equal(writes[0].payload.creationId,writes[1].payload.creationId);assert.equal(app.saved.length,1);app.view.destroy();
});

test('ordered columns and safe constant values remain data rather than markup or expressions',async()=>{
  const app=fixture();await flush();await app.button('Tilføj kolonne').click();const constant=app.input('Fast værdi i kolonne 6');constant.value='<script>alert(1)</script>';await constant.fire('input');const remove=app.nodes().find(item=>item.attributes['aria-label']==='Fjern kolonne 2');await remove.click();await app.button('Opret profil').click();await flush();const profile=app.commands.find(item=>item.name==='payrollExportProfileSave').payload.profile;assert.equal(profile.columns.length,5);assert.equal(profile.columns.at(-1).value,'<script>alert(1)</script>');assert.equal(profile.columns[1].field,'quantity');app.view.destroy();
});
