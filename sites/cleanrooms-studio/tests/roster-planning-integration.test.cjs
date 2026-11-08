const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const boundary=source.indexOf("  staff.forEach(person => { const option");
assert.ok(boundary>0,'Find the real app setup boundary without adding production hooks.');
const plain=value=>JSON.parse(JSON.stringify(value));
const person=(id,name,target=30,site=0)=>({id,name,initials:name.split(' ').map(part=>part[0]).join(''),target,site,role:'Servicemedarbejder',active:true});
const anna=person('person-anna','Anna Hansen',30,0),bob=person('person-bob','Bob Jensen',20,1);
const shift=(id,person,date,site,start,end)=>({id,person,date,site,start,end,note:''});

// Exercise the real renderRoster -> model -> view contract with effective Data
// expansion. Only the directory DOM and its existing navigation endpoint are
// captured; no planning, roster or filter logic is reimplemented in the test.
function application(){
  const controls=new Map(),mounts=[],renders=[],navigations=[];
  const doc={};
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.value='';this.hidden=true;this.disabled=false;this.dataset={};this.isConnected=true;}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=[...children];}
    get options(){return this.children;}
    setAttribute(){}
    removeAttribute(){}
    focus(){}
  }
  const control=selector=>{if(!controls.has(selector))controls.set(selector,new Element());return controls.get(selector);};
  const root={querySelector:control,querySelectorAll:()=>[]};
  Object.assign(doc,{getElementById:()=>root,createElement:tag=>new Element(tag),createTextNode:text=>({textContent:String(text)})});
  const context=vm.createContext({
    CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-10-26',today:'2026-10-30'},
    CleanRoomsSeries:require('../src/series-engine.js'),
    CleanRoomsRoster:require('../src/roster-model.js'),
    CleanRoomsRosterPlanning:require('../src/roster-planning.js'),
    CleanRoomsPublication:require('../src/publication-model.js'),
    CleanRoomsActions:require('../src/schedule-actions.js'),
    CleanRoomsBulk:require('../src/bulk-actions.js'),
    CleanRoomsChanges:require('../src/plan-changes.js'),
    CleanRoomsRosterView:{mount:options=>{mounts.push(options);return {render:options=>renders.push(options),destroy(){}};}},
    document:doc,window:{},Date,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,
    __navigate:(...args)=>navigations.push(plain(args))
  });
  vm.runInContext(source.slice(0,boundary)+`
    navigateTo=(...args)=>globalThis.__navigate(...args);
    globalThis.rosterPlanningTest={state,renderRoster,shiftsInRange,
      setup:(people,work={})=>{Object.assign(state,{roster:clone(people),demoSeed:false,series:[],edits:{},deleted:[],role:'admin',page:'people'},clone(work));syncRoster();},
      access:(capabilities,options={})=>{cloudCapabilities={...capabilities};cloudLoaded=options.loaded!==false;cloudStatus={state:'saved',conflict:options.conflict===true};sessionViewer={userId:'fixture-planner',role:options.role||'planner'};}
    };
  })();`,context,{filename:'app.js (roster planning integration)'});
  const app=context.rosterPlanningTest;
  app.access({plan:true,manageUsers:false});
  return {...app,control,mounts,renders,navigations,last:()=>renders.at(-1)};
}

test('the employee overview uses the current week and all sites despite saved future calendar navigation and hidden filters',()=>{
  const app=application();
  app.setup([anna,bob],{week:14,day:5,view:'day',group:'sites',search:'ingen matcher',site:'0',onlyOpen:true,departmentId:'another-department',edits:{
    monday:shift('monday',anna.id,'2026-10-26',0,'07:00','11:00'),
    otherSite:shift('otherSite',anna.id,'2026-10-28',2,'09:00','12:00'),
    bob:shift('bob',bob.id,'2026-10-28',1,'13:00','15:00'),
    next:shift('next',anna.id,'2026-11-02',2,'09:00','13:00')
  }});
  app.control('#cs-search').value='Søgningen skal bevares';const before=plain(app.state);
  app.renderRoster();const options=app.last(),planning=options.planning;
  assert.equal(planning.weekStart,'2026-10-26');assert.equal(planning.weekEnd,'2026-11-01');assert.equal(planning.horizonEnd,'2026-11-26');
  assert.equal(planning.byPerson[anna.id].plannedMinutes,7*60);assert.equal(planning.byPerson[anna.id].shiftCount,2);assert.equal(planning.byPerson[bob.id].plannedMinutes,2*60);
  assert.equal(planning.byPerson[anna.id].nextShift.id,'next');assert.equal(planning.byPerson[anna.id].nextShift.site,2);
  assert.deepEqual(plain(options.staff),[anna,bob]);assert.deepEqual(plain(app.state),before,'Reading planning must not change saved filters, view preferences or work.');
  assert.equal(app.control('#cs-search').value,'Søgningen skal bevares');
  app.renderRoster();assert.equal(app.mounts.length,1,'Keep the mounted directory and its local selection/filter preferences when refreshing planning.');
});

test('weekly hours and next shifts follow actual reassignment, moved occurrences and tombstones rather than series anchors',()=>{
  const app=application(),series={id:'cleaning-pattern',person:anna.id,site:0,startDate:'2026-10-26',endDate:'2026-11-15',weekdays:[1,3],start:'07:00',end:'15:00',note:'Skabelon'};
  const moved={...shift(series.id+'@2026-10-27',bob.id,'2026-11-02',2,'10:00','14:00'),seriesId:series.id,note:'Flyttet og omfordelt'};
  const reassigned={...shift(series.id+'@2026-10-29',bob.id,'2026-10-29',1,'08:00','12:00'),seriesId:series.id};
  app.setup([anna,{...bob,active:false}],{series:[series],deleted:[series.id+'@2026-11-03','removed-once'],edits:{
    [moved.id]:moved,[reassigned.id]:reassigned,
    extra:shift('extra',anna.id,'2026-10-28',2,'16:00','18:00'),
    'removed-once':shift('removed-once',anna.id,'2026-10-30',0,'06:00','07:00')
  }});
  const before=plain(app.state);app.renderRoster();const planning=app.last().planning;
  assert.equal(planning.byPerson[anna.id].plannedMinutes,2*60);assert.equal(planning.byPerson[anna.id].shiftCount,1);
  assert.equal(planning.byPerson[bob.id].plannedMinutes,4*60);assert.equal(planning.byPerson[bob.id].shiftCount,1,'Archived identities still retain their actual planned work.');
  assert.deepEqual(plain(planning.byPerson[bob.id].nextShift),moved);
  assert.equal(planning.byPerson[anna.id].nextShift.id,series.id+'@2026-11-05');assert.equal(planning.byPerson[anna.id].nextShift.date,'2026-11-05');
  assert.ok(!planning.byPerson[anna.id].upcoming.some(item=>item.id===series.id+'@2026-11-03'));
  assert.deepEqual(plain(app.state),before);
});

test('the directory plan action forwards the actual shift date and stable person identity without changing directory preferences',()=>{
  const app=application(),next=shift('future-shift',anna.id,'2026-11-03',2,'09:00','12:00');
  app.setup([anna,bob],{week:20,search:'Anna',site:'1',edits:{[next.id]:next}});app.renderRoster();const before=plain(app.state);
  app.mounts[0].onShowPlan(anna,app.last().planning.byPerson[anna.id].nextShift);
  app.mounts[0].onShowPlan(bob,null);
  assert.deepEqual(app.navigations,[['2026-11-03',anna.id],['2026-10-30',bob.id]]);
  assert.deepEqual(plain(app.state),before,'The view callback supplies navigation inputs; it does not mutate roster or directory data itself.');
});

test('directory edit availability comes from the existing trusted capability gate rather than a job title or legacy role',()=>{
  const app=application();app.setup([{...anna,role:'Administrator'}]);
  app.access({plan:true,manageUsers:false},{role:'admin'});app.renderRoster();assert.equal(app.last().canEdit,false);
  app.access({plan:true,manageUsers:true},{role:'planner'});app.renderRoster();assert.equal(app.last().canEdit,true);
  app.access({plan:true,manageUsers:true},{conflict:true});app.renderRoster();assert.equal(app.last().canEdit,false);
  app.access({plan:true,manageUsers:true},{loaded:false});app.renderRoster();assert.equal(app.last().canEdit,false);
  assert.equal(app.last().planning.byPerson[anna.id].targetMinutes,30*60,'Read-only planning facts remain available without inventing access roles.');
});

test('invalid planning data leaves the employee directory usable without showing invented zero totals',()=>{
  const app=application();app.setup([anna],{edits:{bad:shift('bad',anna.id,'2026-10-28',0,'12:00','08:00')}});
  assert.doesNotThrow(()=>app.renderRoster());assert.equal(app.last().planning,null);assert.match(app.last().planningError,/Ugens plan kunne ikke beregnes/);assert.deepEqual(plain(app.last().staff),[anna]);
});
