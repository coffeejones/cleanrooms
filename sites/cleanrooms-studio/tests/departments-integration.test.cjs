const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Departments=require('../src/department-model.js');

const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const boundary=source.indexOf("  staff.forEach(person => { const option");
assert.ok(boundary>0,'The department harness must find the production app setup boundary.');
const plain=value=>JSON.parse(JSON.stringify(value));

class Element {
  constructor() { this.value='';this.hidden=true;this.checked=false;this.disabled=false;this.dataset={};this.children=[];this.isConnected=true;this.style={setProperty(){}}; }
  get options() { return this.children; }
  setAttribute() {}
  removeAttribute() {}
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children=children; }
  focus() {}
  scrollIntoView() {}
}

// Exercise actual filtering, selectors, proposals, capability gates, persistence
// and global conflict checks. Only the surrounding page/editor painting is
// intercepted; renderDepartments still rebuilds the real selector options.
function application({model=true}={}) {
  const controls=new Map(),writes=[],views=[],opened=[],managers=[];
  const control=selector=>{if(!controls.has(selector))controls.set(selector,new Element());return controls.get(selector);};
  const root={querySelector:control,querySelectorAll:()=>[]};
  const context=vm.createContext({
    CleanRoomsData:{...require('../src/studio-data.js'),anchor:'2026-10-26',today:'2026-10-30'},
    CleanRoomsRoster:require('../src/roster-model.js'),
    CleanRoomsPublication:require('../src/publication-model.js'),
    Date,Map,Set,Math,JSON,Number,String,Array,Object,RegExp,
    window:{openai:{setWidgetState:payload=>{writes.push(plain(payload));return Promise.resolve();}}},
    document:{getElementById:()=>root,createElement:()=>new Element(),createTextNode:text=>({textContent:String(text)})},
    CleanRoomsSeries:require('../src/series-engine.js'),CleanRoomsActions:require('../src/schedule-actions.js'),
    CleanRoomsBulk:require('../src/bulk-actions.js'),CleanRoomsChanges:require('../src/plan-changes.js'),
    CleanRoomsCoverage:require('../src/coverage-engine.js'),CleanRoomsStaffing:require('../src/staffing-engine.js'),
    CleanRoomsDemo:require('../src/demo-fixtures.js'),CleanRoomsDescription:require('../src/description-model.js'),
    CleanRoomsChecklist:require('../src/checklist-progress.js'),CleanRoomsEmployeeCalendar:require('../src/employee-calendar.js'),
    ...(model?{CleanRoomsDepartments:Departments}:{}),
    captureView:view=>views.push(plain(view)),captureOpen:shift=>opened.push(plain(shift)),captureManager:id=>managers.push(id)
  });
  vm.runInContext(source.slice(0,boundary)+`
    departmentView={render:captureView,close(){},openManager:captureManager};
    render=()=>{renderDepartments();};closeDemoSheets=()=>{};openEditor=shift=>captureOpen(shift);
    globalThis.departmentTest={state,save,restore,snapshot,syncOrganization,selectedDepartment,visibleSite,
      defaultShiftSite,filteredShifts,shiftsInRange,shiftById,changeDepartment,saveDepartment,canManageDepartments,
      renderDepartments,newShift,proposalError,previewMove,getSites:()=>clone(sites),
      setCloudCaps:(caps,options={})=>{cloudCapabilities=caps;cloudLoaded=options.loaded!==false;
        state.role=options.role||'admin';cloudStatus={state:'saved',conflict:options.conflict===true};}
    };
  })();`,context,{filename:'app.js (departments integration)'});
  const app=context.departmentTest;
  return {...app,control,writes,views,opened,managers,
    at:(day,person)=>app.shiftsInRange(day,day).find(shift=>shift.person===person),
    grant:()=>app.setCloudCaps({manageDepartments:true})
  };
}

test('department filters affect schedule only and All restores the complete plan and worksite selector',()=>{
  const app=application(),all=plain(app.filteredShifts());
  assert.ok(all.some(shift=>shift.site===0)&&all.some(shift=>shift.site===1)&&all.some(shift=>shift.site===2));
  Object.assign(app.state,{search:'Emma',site:'2',onlyOpen:true,pageIndex:2});
  assert.equal(app.changeDepartment('dep-nord'),true);
  assert.equal(app.selectedDepartment().id,'dep-nord');assert.equal(app.state.site,'all');
  assert.equal(app.state.search,'');assert.equal(app.state.onlyOpen,false);assert.equal(app.state.pageIndex,0);
  assert.deepEqual(plain(app.filteredShifts()),all.filter(shift=>shift.site===0));
  assert.deepEqual(app.control('#cs-site-filter').children.map(option=>option.value),['all','0']);
  assert.equal(app.visibleSite(1),false);
  for(const page of ['people','hours','leave','series','demo']) {
    app.state.page=page;app.renderDepartments();
    assert.equal(app.control('#cs-department-switcher').hidden,true);
    assert.deepEqual(plain(app.filteredShifts()),all);
  }
  app.state.page='schedule';assert.equal(app.changeDepartment('all'),true);
  assert.equal(app.selectedDepartment(),null);assert.deepEqual(plain(app.filteredShifts()),all);
  assert.deepEqual(app.control('#cs-site-filter').children.map(option=>option.value),['all','0','1','2']);
});

test('unknown selections are unchanged while restored filters keep a valid selected department',()=>{
  const app=application();app.changeDepartment('dep-havn');
  const before=plain(app.state),writes=app.writes.length;
  assert.equal(app.changeDepartment('missing'),false);assert.deepEqual(plain(app.state),before);assert.equal(app.writes.length,writes);
  const restored=application();restored.restore({privateContent:{studio:before}});restored.renderDepartments();
  assert.equal(restored.selectedDepartment().id,'dep-havn');assert.ok(restored.filteredShifts().every(shift=>shift.site===2));
  restored.restore({privateContent:{studio:{...before,departmentId:'missing'}}});assert.equal(restored.state.departmentId,'all');
  restored.restore({privateContent:{studio:{...before,departmentId:'dep-havn',site:'1'}}});restored.renderDepartments();
  assert.equal(restored.state.site,'all','A saved site from another department must not leave an invisible selected option.');
});

test('a saved worksite-day page resumes in the calendar at the same date and worksite without changing the plan',()=>{
  const app=application(),before=plain(app.snapshot());
  app.restore({privateContent:{studio:{...plain(app.state),page:'worksite',view:'day',departmentId:'dep-havn',site:'2',search:'Emma',onlyOpen:true,worksiteDate:'2026-11-04',worksiteSite:1}}});
  assert.equal(app.state.page,'schedule');assert.equal(app.state.view,'week');
  assert.equal(app.state.week,1);assert.equal(app.state.day,2);
  assert.equal(app.state.departmentId,'all');assert.equal(app.state.site,'1');
  assert.equal(app.state.search,'');assert.equal(app.state.onlyOpen,false);
  assert.deepEqual(plain(app.snapshot()),before);
  assert.ok(app.filteredShifts().length>0);assert.ok(app.filteredShifts().every(shift=>shift.site===1&&shift.date>='2026-11-02'&&shift.date<='2026-11-08'));
});

test('obsolete worksite preferences with an invalid date or missing site fall back to an accessible calendar',()=>{
  const app=application();
  app.restore({privateContent:{studio:{...plain(app.state),page:'worksite',week:3,worksiteDate:'2026-02-30',worksiteSite:1999}}});
  assert.equal(app.state.page,'schedule');assert.equal(app.state.view,'week');
  assert.equal(app.state.week,3);assert.equal(app.state.site,'all');
  assert.equal(app.state.departmentId,'all');assert.ok(app.filteredShifts().length>0);
});

test('new shifts use the selected department first worksite and empty departments never fall back to site0',async()=>{
  const app=application();app.grant();
  const result=await app.saveDepartment({name:'Delt område',kind:'branch',siteIds:[2,0]});assert.equal(result.ok,true);
  assert.equal(app.defaultShiftSite(),2);app.newShift();assert.equal(app.opened.at(-1).site,2);
  app.state.site='0';assert.equal(app.defaultShiftSite(),0);app.newShift();assert.equal(app.opened.at(-1).site,0);
  const empty=await app.saveDepartment({name:'Kunde uden adresse',kind:'customer',siteIds:[]});assert.equal(empty.ok,true);
  assert.equal(app.defaultShiftSite(),undefined);assert.equal(app.filteredShifts().length,0);
  assert.deepEqual(app.control('#cs-site-filter').children.map(option=>option.value),['all']);
  const opened=app.opened.length;app.newShift();assert.equal(app.opened.length,opened);assert.equal(app.managers.at(-1),empty.department.id);
  app.changeDepartment('all');assert.equal(app.defaultShiftSite(),0);assert.ok(app.filteredShifts().length>0);
});

test('appending a worksite and restoring the organization preserves every original numeric reference',async()=>{
  const app=application(),originalSites=app.getSites(),originalSeries=plain(app.state.series);app.grant();
  const result=await app.saveDepartment({name:'Ny kunde',kind:'customer',siteIds:[1],newSite:{name:'Nyt arbejdssted',address:'Ågade 5'}});
  assert.equal(result.ok,true);assert.deepEqual(plain(result.department.siteIds),[1,3]);
  assert.deepEqual(app.getSites().slice(0,3).map(({id,...site})=>site),originalSites);
  assert.deepEqual(plain(app.state.series),originalSeries);
  assert.deepEqual(app.control('#cs-edit-site').children.map(option=>option.value),['0','1','2','3']);
  app.state.edits['new-site-shift']={id:'new-site-shift',person:'p0',date:'2026-10-28',site:3,start:'09:00',end:'11:00',note:'Ny adresse'};
  await app.save();const payload=app.writes.at(-1),restored=application();restored.restore(payload);restored.renderDepartments();
  assert.equal(restored.getSites().length,4);assert.equal(restored.getSites()[3].name,'Nyt arbejdssted');
  assert.equal(restored.shiftById('new-site-shift').site,3);assert.equal(restored.at('2026-10-27','p0').site,0);
  assert.equal(restored.at('2026-10-27','p1').site,1);assert.equal(restored.at('2026-10-27','p2').site,2);
  assert.equal(restored.selectedDepartment().id,result.department.id);
  assert.ok(restored.filteredShifts().some(shift=>shift.id==='new-site-shift'));
});

test('management requires server capabilities, admin role and completed cloud loading rather than client flags',async()=>{
  const app=application(),initial=plain(app.state);
  app.restore({privateContent:{studio:{...initial,role:'admin',canManageDepartments:true,manageDepartments:true,
    capabilities:{manageDepartments:true},cloudCapabilities:{manageDepartments:true}}}});
  assert.equal(app.canManageDepartments(),false);
  let result=await app.saveDepartment({name:'Forbidden',kind:'branch',siteIds:[]});assert.equal(result.ok,false);
  assert.deepEqual(plain(app.state.organization),initial.organization);
  for(const [caps,options] of [[{manageDepartments:'true'},{}],[{manageDepartments:false},{}],[{manageDepartments:true},{loaded:false}],[{manageDepartments:true},{role:'employee'}]]) {
    app.setCloudCaps(caps,options);assert.equal(app.canManageDepartments(),false);
    result=await app.saveDepartment({name:'Forbidden',kind:'branch',siteIds:[]});assert.equal(result.ok,false);
  }
  app.setCloudCaps({manageDepartments:true},{conflict:true});assert.equal(app.canManageDepartments(),true);
  assert.equal((await app.saveDepartment({name:'Conflict',kind:'branch',siteIds:[]})).ok,false);
  app.grant();assert.equal(app.canManageDepartments(),true);
  assert.equal((await app.saveDepartment({name:'Allowed',kind:'branch',siteIds:[]})).ok,true);
});

test('hidden other-department assignments still block direct proposals and moves across all worksites',()=>{
  const app=application(),source=app.at('2026-10-27','p0'),target='2026-10-28';
  app.state.edits.hidden={id:'hidden',person:'p0',date:target,site:2,start:'14:00',end:'16:00',note:''};
  app.changeDepartment('dep-nord');
  assert.ok(!app.filteredShifts().some(shift=>shift.id==='hidden'));
  const before=plain(app.snapshot()),proposal=app.previewMove(source,target);
  assert.equal(proposal.allowed,false);assert.match(proposal.reason,/14:00–16:00/);
  assert.match(app.proposalError([{...source,date:target}],app.snapshot()),/Overlap/);
  assert.deepEqual(plain(app.snapshot()),before);
});

test('legacy contexts without the optional department model retain global planning and reject management safely',async()=>{
  const app=application({model:false});
  assert.equal(app.state.organization,null);assert.equal(app.selectedDepartment(),null);
  assert.ok(app.filteredShifts().some(shift=>shift.site===2));assert.equal(app.defaultShiftSite(),0);
  assert.equal(app.changeDepartment('missing'),false);assert.equal(app.changeDepartment('all'),true);
  app.grant();assert.equal((await app.saveDepartment({name:'Unavailable',kind:'branch',siteIds:[]})).ok,false);
  assert.equal(app.state.organization,null);
});
