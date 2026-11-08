const test=require('node:test');
const assert=require('node:assert/strict');
const View=require('../src/timekeeping-employee.js');

class Element{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.handlers={};this.attributes={};this.dataset={};this.className='';this.value='';this.hidden=false;this.disabled=false;this.parentElement=null;this.checked=false;this._text='';}
  set innerHTML(value){throw Error('Unsafe HTML: '+value);}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  get isConnected(){return this===this.ownerDocument.body||!!this.parentElement?.isConnected;}
  append(...nodes){for(let n of nodes){if(typeof n==='string'){const item=new Element('#text',this.ownerDocument);item.textContent=n;n=item;}n.parentElement=this;this.children.push(n);}}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  addEventListener(name,handler){(this.handlers[name]??=[]).push(handler);}
  fire(name){const event={target:this,currentTarget:this,preventDefault(){}};for(const fn of this.handlers[name]||[])fn(event);}
  focus(){if(!this.disabled)this.ownerDocument.activeElement=this;}
  click(){if(!this.disabled){this.focus();if(this.type==='checkbox'){this.checked=!this.checked;this.fire('change');}else this.fire('click');}}
}
function document(){const doc={activeElement:null};doc.createElement=tag=>new Element(tag,doc);doc.body=doc.createElement('body');return doc;}
const all=node=>[node,...node.children.flatMap(all)];
const button=(node,label)=>all(node).find(n=>n.tagName==='BUTTON'&&n.textContent===label);
const field=(node,name)=>all(node).find(n=>n.id?.endsWith('-'+name));
const withSection=(options={},doc=document())=>{const node=View.render(doc,{shift,today:shift.date,enabled:true,onAction:async()=>({ok:true}),...options});doc.body.append(node);return {node,doc};};
const shift={id:'shift-person-1',person:'person-1',date:'2026-11-01',site:0,start:'07:00',end:'15:00'};
const entry={id:'entry-1',version:4,shiftId:shift.id,personId:shift.person,date:shift.date,start:'07:05',end:null,breakMinutes:0,status:'running',workedMinutes:120,flags:['late_start'],audit:[]};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('real employee start sends identity and source version, never a client-selected clock time',async()=>{
  const calls=[];const {node}=withSection({onAction:async payload=>{calls.push(payload);return {ok:true};}});
  button(node,'Start vagt').click();await flush();
  assert.deepEqual(calls,[{operation:'start',shiftId:shift.id,personId:shift.person,version:0}]);
  assert.match(node.textContent,/Registreringen er gemt/);
});

test('ordinary preview cannot clock real shifts, while explicit demo preview can test the demo clock',async()=>{
  const calls=[];const preview=withSection({preview:true,entry,onAction:async p=>{calls.push(p);return {ok:true};}}).node;
  assert.equal(button(preview,'Start pause'),undefined);assert.match(preview.textContent,/Forhåndsvisning/);
  const demo=withSection({preview:true,shift:{...shift,demo:true},canDemoEdit:true,onAction:async p=>{calls.push(p);return {ok:true};}}).node;
  button(demo,'Start vagt').click();await flush();assert.equal(calls.length,1);assert.equal(calls[0].demo,true);
  const disabledDemo=withSection({preview:true,shift:{...shift,demo:true},canDemoEdit:false}).node;
  assert.equal(button(disabledDemo,'Start vagt'),undefined);
});

test('a pending pause blocks repeat clicks and failures keep a clear error',async()=>{
  const calls=[];let reject;
  const {node}=withSection({entry,onAction:p=>{calls.push(p);return new Promise(resolve=>{reject=resolve;});}});
  const pause=button(node,'Start pause');pause.click();pause.click();assert.equal(calls.length,1);assert.equal(pause.disabled,true);assert.equal(calls[0].version,4);assert.equal(calls[0].entryId,entry.id);
  reject({ok:false,message:'Registreringen er ændret. Hent den igen.'});await flush();
  assert.match(node.textContent,/Registreringen er ændret/);assert.equal(pause.disabled,false);
});

test('checkout asks for an optional comment without exposing editable times',async()=>{
  const calls=[],{node}=withSection({entry,onAction:async p=>{calls.push(p);return {ok:true};}});
  assert.equal(button(node,'Ret registrering'),undefined);assert.equal(field(node,'start'),undefined);assert.equal(field(node,'end'),undefined);
  button(node,'Afslut vagt').click();assert.equal(calls.length,0);field(node,'comment').value='Jeg glemte at stemple ind, men mødte kl. 07:00.';
  button(node,'Stempl ud og afslut').click();await flush();
  assert.deepEqual(calls,[{operation:'finish',shiftId:shift.id,personId:shift.person,version:4,entryId:entry.id,comment:'Jeg glemte at stemple ind, men mødte kl. 07:00.'}]);
});

test('approved records are locked and employee rendering never exposes payroll fields',()=>{
  const {node}=withSection({entry:{...entry,status:'approved',end:'15:00',comment:'<img src=x onerror=alert(1)>',approvedAt:'2026-11-01T17:00:00Z',approvedBy:{name:'Planlægger'},payroll:{totalCents:987654321,sourceLabel:'SECRET SALARY'}}});
  assert.equal(button(node,'Ret registrering'),undefined);assert.equal(button(node,'Start pause'),undefined);assert.match(node.textContent,/Timerne er godkendt af Planlægger/);assert.match(node.textContent,/<img src=x/);assert.doesNotMatch(node.textContent,/SECRET SALARY|987654321/);
  assert.equal(View.entryFor([{...entry,personId:'foreign'}],shift),null);
});

test('supplementary explanations send only a comment, retain a failed draft, and require text',async()=>{
  const calls=[],{node}=withSection({entry:{...entry,status:'rejected',end:'15:00'},onAction:async p=>{calls.push(p);return {ok:false,message:'Forbindelsen mangler.'};}});
  button(node,'Tilføj kommentar').click();button(node,'Send kommentar').click();assert.equal(calls.length,0);assert.match(node.textContent,/Skriv en kommentar/);
  field(node,'comment').value='Jeg holdt pause kl. 12.';button(node,'Send kommentar').click();await flush();
  assert.deepEqual(calls,[{operation:'comment',shiftId:shift.id,personId:shift.person,version:4,entryId:entry.id,comment:'Jeg holdt pause kl. 12.'}]);
  assert.equal(field(node,'comment').value,'Jeg holdt pause kl. 12.');assert.match(node.textContent,/Forbindelsen mangler/);
  assert.equal(field(node,'breakMinutes'),undefined);assert.equal(field(node,'start'),undefined);
});

test('returned hours show the latest planner reason and manual pause allocation is transparent',()=>{
  const {node}=withSection({entry:{...entry,status:'rejected',end:'15:00',breakMinutes:30,breakAllocation:'end-of-shift',correctionReason:'',audit:[{operation:'reject',reason:'Gammel besked',at:'2026-11-01T13:00:00Z'},{operation:'reject',reason:'Udfyld sluttid og den faktiske pause.',at:'2026-11-01T14:00:00Z'}]}});
  const returned=all(node).find(n=>n.className==='cs-time-employee-returned');assert.match(returned.textContent,/Udfyld sluttid og den faktiske pause/);assert.doesNotMatch(returned.textContent,/Gammel besked/);
  const basis=all(node).find(n=>n.className.includes('cs-time-employee-pause-basis'));assert.match(basis.textContent,/vagtens slutning i beregningen af tillæg/);
  assert.ok(button(node,'Tilføj kommentar'));assert.equal(button(node,'Ret registrering'),undefined);
  const clocked=withSection({entry:{...entry,status:'submitted',end:'15:00',breakMinutes:30,breakAllocation:'clocked'}}).node;
  assert.match(all(clocked).find(n=>n.className.includes('cs-time-employee-pause-basis')).textContent,/faktiske tidspunkt/);
});

test('ongoing and paused shifts do not present zero final hours or premature missing-checkout warnings',()=>{
  for(const status of ['running','paused']){
    const {node}=withSection({entry:{...entry,status,end:null,workedMinutes:0,flags:['missing_end','late_start']}});
    const workMetric=all(node).find(n=>n.tagName==='DT'&&n.textContent==='Arbejdstid').parentElement;
    assert.match(workMetric.textContent,/Beregnes ved afslutning/);assert.doesNotMatch(workMetric.textContent,/0 t/);
    const warnings=all(node).find(n=>n.className==='cs-time-employee-flags');assert.doesNotMatch(warnings.textContent,/Mangler udstempling/);assert.match(warnings.textContent,/Sen start/);
  }
  const rejected=withSection({entry:{...entry,status:'rejected',end:null,workedMinutes:0,flags:['missing_end']}}).node;
  assert.match(all(rejected).find(n=>n.className==='cs-time-employee-flags').textContent,/Mangler udstempling/);
});

test('a planned unpaid break explains net work without inserting an actual break or sending a fabricated value',async()=>{
  const calls=[],{node}=withSection({shift:{...shift,plannedBreakMinutes:30},onAction:async value=>{calls.push(value);return {ok:true};}});
  const metric=label=>all(node).find(item=>item.tagName==='DT'&&item.textContent===label).parentElement.textContent;
  assert.match(metric('Planlagt arbejdstid'),/7 t 30 min/);assert.match(metric('Planlagt pause'),/30 min · ulønnet/);assert.match(metric('Registreret pause'),/—/);
  assert.match(node.textContent,/Registrér den pause, du faktisk holder/);assert.equal(button(node,'Registrér tid manuelt'),undefined);assert.equal(field(node,'breakMinutes'),undefined);
  button(node,'Start vagt').click();await flush();assert.deepEqual(calls,[{operation:'start',shiftId:shift.id,personId:shift.person,version:0}]);
});

test('agreed longer breaks are not warned about and approved planned facts retain their captured agreement',()=>{
  const agreed=withSection({shift:{...shift,plannedBreakMinutes:75},entry:{...entry,status:'submitted',end:'15:00',breakMinutes:75,workedMinutes:405,flags:['long_break']}}).node;
  assert.equal(all(agreed).find(item=>item.className==='cs-time-employee-flags'),undefined);
  const approved=withSection({shift:{...shift,plannedBreakMinutes:60},entry:{...entry,status:'approved',end:'15:00',plannedStart:'07:00',plannedEnd:'15:00',plannedBreakMinutes:30,breakMinutes:30,workedMinutes:450}}).node;
  const metric=label=>all(approved).find(item=>item.tagName==='DT'&&item.textContent===label).parentElement.textContent;
  assert.match(metric('Planlagt arbejdstid'),/7 t 30 min/);assert.match(metric('Planlagt pause'),/30 min · ulønnet/);
});

test('checkout accepts no comment and old shifts direct the employee to the planner',async()=>{
  const calls=[],{node}=withSection({entry,onAction:async value=>{calls.push(value);return {ok:true};}});button(node,'Afslut vagt').click();button(node,'Stempl ud og afslut').click();await flush();assert.equal(calls[0].operation,'finish');assert.equal(calls[0].comment,'');
  const old=withSection({today:'2026-11-03'}).node;assert.equal(button(old,'Start vagt'),undefined);assert.equal(button(old,'Registrér tid manuelt'),undefined);assert.match(old.textContent,/Kontakt planlæggeren/);
});

test('a failed checkout survives the application rerender without leaving comment controls disabled',async()=>{
 const doc=document();let latest;
 const options={entry,onAction:async()=>{doc.body.children=[];latest.node.parentElement=null;latest=withSection(options,doc);return {ok:false,message:'Forbindelsen er afbrudt.'};}};
 latest=withSection(options,doc);button(latest.node,'Afslut vagt').click();field(latest.node,'comment').value='Jeg mødte kl. 07.';field(latest.node,'comment').fire('input');button(latest.node,'Stempl ud og afslut').click();await flush();
 assert.equal(button(latest.node,'Stempl ud og afslut').disabled,false);assert.equal(field(latest.node,'comment').value,'Jeg mødte kl. 07.');assert.match(latest.node.textContent,/Forbindelsen er afbrudt/);
});
