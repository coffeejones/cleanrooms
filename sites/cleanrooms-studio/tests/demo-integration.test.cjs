const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Demo = require('../src/demo-fixtures.js');

const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const boundary=source.indexOf("  staff.forEach(person => { const option");
assert.ok(boundary>0,'The demo integration harness must find the app setup boundary.');
const plain=value=>JSON.parse(JSON.stringify(value));

// Exercise production installation, backup, restore and exit. Rendering and
// sheet painting are isolated so the tests need no browser or production hooks.
function application(){
  const controls=new Map();
  const control=selector=>{
    if(!controls.has(selector))controls.set(selector,{value:'',hidden:true,dataset:{},disabled:false,isConnected:true,children:[],get options(){return this.children;},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},setAttribute(){},removeAttribute(){},focus(){},reportValidity:()=>true});
    return controls.get(selector);
  };
  const root={querySelector:control,querySelectorAll:()=>[]};
  const context=vm.createContext({
    CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-10-26',today:'2026-10-30'},
    CleanRoomsRoster:require('../src/roster-model.js'),
    CleanRoomsPublication:require('../src/publication-model.js'),
    Date,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,window:{},document:{getElementById:()=>root,createElement:()=>control('created-'+controls.size),createTextNode:text=>({textContent:String(text),children:[]})},
    CleanRoomsSeries:require('../src/series-engine.js'),CleanRoomsActions:require('../src/schedule-actions.js'),
    CleanRoomsBulk:require('../src/bulk-actions.js'),CleanRoomsChanges:require('../src/plan-changes.js'),
    CleanRoomsStaffing:require('../src/staffing-engine.js'),CleanRoomsDemo:Demo,CleanRoomsCalendar:{revealDay(){}}
  });
  vm.runInContext(source.slice(0,boundary)+`
    render=()=>{}; save=()=>{}; closeDemoSheets=()=>{};
    globalThis.demoTest={state,installDemoFixture,exitDemo,restore,snapshot,shiftsInRange,weekReview,showDemoPage,
      getUndo:()=>lastUndo,setUndo:value=>lastUndo=clone(value)};
  })();`,context,{filename:'app.js (demo lifecycle integration)'});
  return context.demoTest;
}

function originalWork(app){
  app.state.edits.personal={id:'personal',person:'p0',date:'2026-11-12',site:2,start:'09:00',end:'12:00',note:'Bevar min egen ændring'};
  app.state.deleted=['p2-2026-10-26'];app.state.requests={b:'approved',c:'rejected'};
  app.state.series[0].note='Min oprindelige serie';app.state.series[0].endDate='2027-02-26';
  app.state.weekPlans={'2':{published:true,changes:0,baseline:[plain(app.state.edits.personal)],baselineKind:'published'}};
  Object.assign(app.state,{page:'hours',group:'sites',view:'day',zoom:2,day:4,week:2,pageIndex:1,search:'Emma',site:'1',onlyOpen:true});
  const undo=plain(app.snapshot());undo.edits.personal.note='Den tidligere note';app.setUndo(undo);
  return{state:plain(app.state),undo};
}
const withoutSession=state=>{const result=plain(state);delete result.demoSession;return result;};
const workKeys=['edits','deleted','series','weekPlans','requests'];

test('the normal seed is unchanged and gains the example overlap only after explicit demo entry',()=>{
  const app=application();assert.equal(app.state.demoSession,null);assert.deepEqual(Object.keys(app.state.edits),[]);assert.equal(app.weekReview().overlaps.length,0);
  assert.equal(app.installDemoFixture('overlap'),true);assert.equal(app.weekReview().overlaps.length,1);assert.ok(app.state.edits['demo-overlap-emma']);
});

test('entering each fixture preserves the exact original work, preferences and undo in one backup',()=>{
  for(const scenario of['overview',...Demo.scenarios.map(item=>item.id)]){
    const app=application(),original=originalWork(app);assert.equal(app.installDemoFixture(scenario),true);
    assert.deepEqual(plain(app.state.demoSession.backup),withoutSession(original.state),scenario);
    assert.deepEqual(plain(app.state.demoSession.backupUndo),original.undo,scenario);assert.equal(app.getUndo(),null);
    const fixture=Demo.create(scenario);for(const key of workKeys)assert.deepEqual(plain(app.state[key]),fixture[key],scenario+':'+key);
    assert.equal(app.state.demoSession.scenario,scenario);assert.equal(app.state.page,'schedule');assert.equal(app.state.week,0);
  }
});

test('switching cases starts a fresh deterministic fixture while keeping the first original backup',()=>{
  const app=application(),original=originalWork(app);app.installDemoFixture('hours');
  app.state.edits['demo-change']={id:'demo-change',person:'',date:'2026-10-28',site:0,start:'10:00',end:'11:00',note:''};
  app.state.deleted.push('jonas-plan@2026-10-27');app.state.requests.b='rejected';
  app.installDemoFixture('request');
  for(const key of workKeys)assert.deepEqual(plain(app.state[key]),Demo.create('request')[key]);
  assert.deepEqual(plain(app.state.demoSession.backup),withoutSession(original.state));
  assert.deepEqual(plain(app.state.demoSession.backupUndo),original.undo);assert.equal(app.state.demoSession.backup.demoSession,undefined);
});

test('resetting the same example discards only demo changes and retains the original backup',()=>{
  const app=application(),original=originalWork(app);app.installDemoFixture('overlap');
  app.state.edits['demo-overlap-emma'].end='18:00';app.state.edits.extra={id:'extra',person:'',date:'2026-10-28',site:0,start:'10:00',end:'11:00',note:''};
  app.state.deleted.push('p1-2026-10-26');app.state.series[0].weekdays=[0];app.state.requests.b='approved';app.state.weekPlans['0']={published:true,changes:0};app.setUndo(app.snapshot());
  app.installDemoFixture('overlap');
  for(const key of workKeys)assert.deepEqual(plain(app.state[key]),Demo.create('overlap')[key]);
  assert.deepEqual(plain(app.state.demoSession.backup),withoutSession(original.state));assert.deepEqual(plain(app.state.demoSession.backupUndo),original.undo);assert.equal(app.getUndo(),null);
});

test('exit restores the exact original dataset and preferences plus undo, and clears the session',()=>{
  const app=application(),original=originalWork(app);app.installDemoFixture('overview');
  app.state.edits['demo-overlap-emma'].note='Demo only';app.state.week=10;app.state.zoom=4;app.setUndo(app.snapshot());
  app.exitDemo();assert.deepEqual(plain(app.state),original.state);assert.deepEqual(plain(app.getUndo()),original.undo);assert.equal(app.state.demoSession,null);
  const restored=plain(app.state);app.exitDemo();assert.deepEqual(plain(app.state),restored);
});

test('a serialized demo session retains the original backup and exits correctly after restoration',()=>{
  const app=application(),original=originalWork(app);app.installDemoFixture('request');app.state.edits['demo-request-shift'].note='Forsøg under demo';
  const saved=plain(app.state),resumed=application();resumed.restore({privateContent:{studio:saved}});
  assert.deepEqual(plain(resumed.state.demoSession),saved.demoSession);assert.equal(resumed.state.edits['demo-request-shift'].note,'Forsøg under demo');
  resumed.exitDemo();assert.deepEqual(plain(resumed.state),original.state);assert.deepEqual(plain(resumed.getUndo()),original.undo);assert.equal(resumed.state.demoSession,null);
});

test('malformed persisted demo sessions are rejected instead of becoming an unsafe restore target',()=>{
  const originalApp=application(),original=originalWork(originalApp),backup=withoutSession(original.state);
  const valid={version:1,scenario:'hours',backup,backupUndo:original.undo};
  const invalid=[
    {version:0,scenario:'hours',backup},
    {version:1,scenario:'hours'},
    {version:1,scenario:'hours',backup:{series:[]}},
    {...valid,scenario:'unknown'},
    {...valid,backup:{...backup,series:[{}]}},
    {...valid,backup:{...backup,edits:[]}},
    {...valid,backup:{...backup,edits:{broken:null}}},
    {...valid,backup:{...backup,edits:{broken:{id:'broken',person:'p0',date:'2026-10-28',site:0,start:'07:00',end:'24:00',note:''}}}},
    {...valid,backup:{...backup,edits:{broken:{id:'broken',person:'p0',date:'2026-02-30',site:0,start:'07:00',end:'14:00',note:''}}}},
    {...valid,backup:{...backup,deleted:'bad'}},
    {...valid,backup:{...backup,requests:null}},
    {...valid,backup:{...backup,requests:{b:'unknown'}}},
    {...valid,backup:{...backup,weekPlans:null}},
    {...valid,backup:{...backup,weekPlans:{'2':{published:true,changes:0,baseline:[null],baselineKind:'published'}}}},
    {...valid,backupUndo:42},
    {...valid,backupUndo:[]},
    {...valid,backupUndo:{...original.undo,edits:{broken:null}}},
    {...valid,backup:{...backup,demoSession:{version:1}}}
  ];
  for(const demoSession of invalid){
    const app=application();app.restore({privateContent:{studio:{...plain(original.state),demoSession}}});
    assert.equal(app.state.demoSession,null,JSON.stringify(demoSession));
  }
});

test('unknown example entry leaves the original state and undo untouched',()=>{
  const app=application(),original=originalWork(app);assert.equal(app.installDemoFixture('unknown'),false);assert.deepEqual(plain(app.state),original.state);assert.deepEqual(plain(app.getUndo()),original.undo);
});

test('entering through the examples page remembers the prior work page for exit',()=>{
  const app=application(),original=originalWork(app);app.showDemoPage();assert.equal(app.state.page,'demo');
  app.installDemoFixture('hours');app.exitDemo();
  assert.equal(app.state.page,'hours');
  for(const key of workKeys)assert.deepEqual(plain(app.state[key]),original.state[key]);
  assert.deepEqual(plain(app.getUndo()),original.undo);
});

test('valid serialized demo sessions may preserve legacy week plans without baselines',()=>{
  const app=application(),original=originalWork(app),backup=withoutSession(original.state);
  backup.weekPlans={'40':{published:false,changes:3}};
  const backupUndo={...original.undo,weekPlans:{'40':{published:false,changes:2}}};
  const session={version:1,scenario:'hours',backup,backupUndo};
  app.restore({privateContent:{studio:{...plain(original.state),demoSession:session}}});
  assert.deepEqual(plain(app.state.demoSession),session);
  app.exitDemo();assert.deepEqual(plain(app.state.weekPlans),backup.weekPlans);assert.deepEqual(plain(app.getUndo()),backupUndo);
});
