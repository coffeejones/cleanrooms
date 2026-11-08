const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Departments=require('../src/department-model.js');

const clone=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const draft=overrides=>({id:'dep-new',create:true,name:'Ny afdeling',kind:'branch',siteIds:[],...overrides});
const edit=(organization,change)=>{const next=clone(organization);change(next);return next;};

test('fresh defaults preserve the exact three legacy numeric worksites and their department links',()=>{
  const first=Departments.defaultOrganization(),second=Departments.defaultOrganization();
  assert.deepEqual(Departments.validate(first),[]);
  assert.deepEqual(first.sites,[
    {id:'site-nord',name:'Kontor Nord',address:'Nordvej 12 · 8000 Aarhus C',color:'var(--cs-blue)'},
    {id:'site-klinik',name:'Klinikken',address:'Park Allé 8 · 8000 Aarhus C',color:'var(--cs-purple)'},
    {id:'site-havn',name:'Havnegade',address:'Havnegade 24 · 8000 Aarhus C',color:'var(--cs-orange)'}
  ]);
  assert.deepEqual(first.departments.map(department=>[department.name,department.kind,department.siteIds]),[
    ['Kontor Nord','branch',[0]],['Klinikken','customer',[1]],['Havnegade','customer',[2]]
  ]);
  first.sites[0].name='Changed';first.departments[0].siteIds.push(1);
  assert.equal(second.sites[0].name,'Kontor Nord');assert.deepEqual(second.departments[0].siteIds,[0]);
});

test('only an absent legacy organization defaults, while supplied valid values clone without coercion',()=>{
  assert.deepEqual(Departments.normalize(undefined),Departments.defaultOrganization());
  for(const invalid of [null,{},[],42,{version:'1',sites:[],departments:[]}])assert.throws(()=>Departments.normalize(invalid),TypeError);
  const original=freeze(Departments.defaultOrganization()),normalized=Departments.normalize(original);
  assert.deepEqual(normalized,original);assert.notStrictEqual(normalized.sites,original.sites);
  normalized.sites[0].address='Different';normalized.departments[0].siteIds.push(2);
  assert.notEqual(normalized.sites[0].address,original.sites[0].address);assert.deepEqual(original.departments[0].siteIds,[0]);
});

test('names, addresses, version and kinds validate exact types and inclusive limits without silent trimming',()=>{
  const original=Departments.defaultOrganization(),valid=edit(original,next=>{
    next.sites[0].name='Æ'.repeat(120);next.sites[0].address='a'.repeat(500);next.departments[0].name='b'.repeat(120);
  });
  assert.deepEqual(Departments.validate(valid),[]);
  const invalid=[
    next=>{next.version='1';},next=>{next.version=2;},next=>{next.sites=null;},next=>{next.departments=null;},
    next=>{next.sites[0].name=' ';},next=>{next.sites[0].name=' Nord';},next=>{next.sites[0].name='a'.repeat(121);},
    next=>{next.sites[0].address=null;},next=>{next.sites[0].address='a'.repeat(501);},
    next=>{next.departments[0].name='';},next=>{next.departments[0].name='Nord ';},next=>{next.departments[0].name='a'.repeat(121);},
    next=>{next.departments[0].kind='client';},next=>{next.departments[0].id=' padded ';},next=>{next.sites[0].id=12;}
  ];
  for(const change of invalid)assert.ok(Departments.validate(edit(original,change)).length);
  assert.equal(original.sites[0].name,'Kontor Nord');
});

test('colors are an exact CSS-variable allowlist and all identities remain unique',()=>{
  const original=Departments.defaultOrganization();
  for(const color of Departments.COLORS)assert.deepEqual(Departments.validate(edit(original,next=>{next.sites[0].color=color;})),[]);
  for(const color of ['red','#ffffff','url(https://example.com)','var(--cs-blue);color:red','var(--cs-unknown)',null]) {
    assert.ok(Departments.validate(edit(original,next=>{next.sites[0].color=color;})).length);
  }
  assert.ok(Departments.validate(edit(original,next=>{next.sites.push({...next.sites[0]});})).length);
  assert.ok(Departments.validate(edit(original,next=>{next.departments[1].id=next.departments[0].id;})).length);
  assert.ok(Departments.validate(edit(original,next=>{next.departments[0].id=next.sites[0].id;})).length);
});

test('department references use unique actual numeric indices, allow shared sites and explicit empty departments',()=>{
  const original=Departments.defaultOrganization();
  for(const siteIds of [['0'],[-1],[1.5],[NaN],[Infinity],[3],[0,0],null]) {
    const candidate=Departments.defaultOrganization();candidate.departments[0].siteIds=siteIds;
    assert.ok(Departments.validate(candidate).length);
  }
  assert.deepEqual(Departments.validate(edit(original,next=>{next.departments[0].siteIds=[0,1,2];})),[]);
  assert.deepEqual(Departments.validate(edit(original,next=>{next.departments[0].siteIds=[];})),[]);
  assert.deepEqual(Departments.validate(edit(original,next=>{next.departments=[];})),[]);
});

test('removing or reordering legacy worksite indices is invalid',()=>{
  const original=Departments.defaultOrganization();
  for(const change of [next=>next.sites.reverse(),next=>next.sites.shift(),next=>next.sites.pop(),next=>{next.sites=[];}]) {
    assert.ok(Departments.validate(edit(original,change)).length);
  }
  const renamed=edit(original,next=>{next.sites[0].name='Kontor Nord – ny adresse';next.sites[0].address='Ny vej 5';});
  assert.deepEqual(Departments.validate(renamed),[],'Stable IDs, rather than display text, identify legacy positions.');
});

test('creating departments can link existing worksites or intentionally contain no worksites',()=>{
  const original=freeze(Departments.defaultOrganization()),before=JSON.stringify(original);
  const linked=Departments.propose(original,freeze(draft({siteIds:[2,0]})));
  assert.equal(linked.ok,true);assert.equal(linked.error,null);
  assert.deepEqual(linked.organization.sites,original.sites);assert.deepEqual(linked.department.siteIds,[2,0]);
  assert.deepEqual(linked.organization.departments.slice(0,3),original.departments);
  const empty=Departments.propose(original,draft({id:'empty-customer',name:'Kunde uden adresse',kind:'customer'}));
  assert.equal(empty.ok,true);assert.deepEqual(empty.department.siteIds,[]);
  assert.equal(JSON.stringify(original),before);
});

test('a new worksite appends without changing old indices or links and is linked automatically once',()=>{
  const original=freeze(Departments.defaultOrganization()),input=freeze(draft({siteIds:[1],newSite:{name:'Ny klinik',address:'Ågade 10'}}));
  const before=JSON.stringify([original,input]),result=Departments.propose(original,input);
  assert.equal(result.ok,true);assert.equal(result.organization.sites.length,4);
  assert.deepEqual(result.organization.sites.slice(0,3),original.sites);
  assert.deepEqual(result.organization.departments.slice(0,3),original.departments);
  assert.deepEqual(result.department.siteIds,[1,3]);
  assert.deepEqual(result.organization.sites[3],{id:'site-dep-new-3',name:'Ny klinik',address:'Ågade 10',color:'var(--cs-blue)'});
  assert.deepEqual(Departments.propose(original,input),result,'Pure proposals produce stable IDs from the same caller state.');
  assert.equal(JSON.stringify([original,input]),before);
});

test('editing changes only its department, retains identity and other links, and can append another worksite',()=>{
  const original=freeze(Departments.defaultOrganization()),input=freeze(draft({id:'dep-klinik',create:false,name:'Klinikken Øst',kind:'branch',siteIds:[1],newSite:{id:'site-east',name:'Østfløjen',address:'',color:'var(--cs-orange)'}}));
  const result=Departments.propose(original,input);assert.equal(result.ok,true);
  assert.deepEqual(result.department,{id:'dep-klinik',name:'Klinikken Øst',kind:'branch',siteIds:[1,3]});
  assert.deepEqual(result.organization.departments[0],original.departments[0]);assert.deepEqual(result.organization.departments[2],original.departments[2]);
  assert.deepEqual(result.organization.sites.slice(0,3),original.sites);
  const renamed=Departments.propose(result.organization,draft({id:'dep-klinik',create:false,name:'Nyt navn',kind:'customer',siteIds:[]}));
  assert.equal(renamed.ok,true);assert.equal(renamed.department.id,'dep-klinik');
  assert.equal(renamed.organization.sites.length,4);assert.deepEqual(renamed.department.siteIds,[]);
  result.department.siteIds.push(0);assert.deepEqual(result.organization.departments[1].siteIds,[1,3]);
});

test('stale IDs, malformed drafts and invalid appended sites fail atomically without repairing caller input',()=>{
  const original=freeze(Departments.defaultOrganization()),before=JSON.stringify(original);
  const invalid=[null,draft({id:'dep-nord'}),draft({id:'unknown',create:false}),draft({create:undefined}),draft({name:' padded '}),
    draft({siteIds:[3],newSite:{name:'New',address:''}}),draft({siteIds:[0,0]}),draft({newSite:null}),
    draft({newSite:{name:'',address:''}}),draft({newSite:{id:'site-nord',name:'Duplicate',address:''}}),
    draft({newSite:{name:'New',address:'a'.repeat(501)}}),draft({newSite:{name:'New',address:'',color:'url(x)'}})
  ];
  for(const candidate of invalid) {
    freeze(candidate);const result=Departments.propose(original,candidate);
    assert.equal(result.ok,false);assert.ok(result.error);assert.equal(result.organization,null);assert.equal(result.department,null);
  }
  assert.equal(JSON.stringify(original),before);
  assert.equal(Departments.propose(null,draft()).ok,false);
});

test('organization size caps permit their exact boundary and reject overflow through proposals',()=>{
  const original=Departments.defaultOrganization();
  for(let index=3;index<2000;index++)original.sites.push({id:'site-extra-'+index,name:'Sted '+index,address:'',color:Departments.COLORS[index%3]});
  for(let index=3;index<1000;index++)original.departments.push({id:'dep-extra-'+index,name:'Afdeling '+index,kind:'branch',siteIds:[]});
  assert.deepEqual(Departments.validate(original),[]);
  assert.equal(Departments.propose(original,draft()).ok,false);
  assert.equal(Departments.propose(original,draft({id:'dep-nord',create:false,siteIds:[0],newSite:{name:'Overflow',address:''}})).ok,false);
  assert.equal(original.sites.length,2000);assert.equal(original.departments.length,1000);
});

test('browser and CommonJS exports expose the same frozen pure API',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../src/department-model.js'),'utf8'),context);
  assert.equal(context.CleanRoomsDepartments.defaultOrganization().sites.length,3);
  assert.equal(context.CleanRoomsDepartments.validate(context.CleanRoomsDepartments.defaultOrganization()).length,0);
  assert.equal(globalThis.CleanRoomsDepartments,Departments);assert.ok(Object.isFrozen(Departments));
  assert.ok(Object.isFrozen(Departments.COLORS));assert.ok(Object.isFrozen(Departments.LEGACY_SITE_IDS));
});
test('workplace GPS is optional and validates paired coordinates and meter boundaries',()=>{
 const gps={enabled:true,latitude:0,longitude:0,radiusMeters:1};
 assert.deepEqual(Departments.normalizeGps(),{enabled:false,latitude:null,longitude:null,radiusMeters:150});
 assert.deepEqual(Departments.normalizeGps(null),Departments.defaultGps());
 assert.deepEqual(Departments.normalizeGps(gps),gps);
 assert.deepEqual(Departments.validateGps({...gps,latitude:-90,longitude:180,radiusMeters:1000}),[]);
 for(const invalid of [
  {...gps,latitude:null,longitude:null},{...gps,enabled:false,longitude:null},{...gps,longitude:180.001},
  {...gps,radiusMeters:1001},{...gps,radiusMeters:1.5},{...gps,enabled:'true'},{...gps,extra:true}
 ])assert.ok(Departments.validateGps(invalid).length);
 const draft={id:'dep-east',create:true,name:'Øst',kind:'branch',siteIds:[],newSite:{name:'Øst',address:'Østvej 1',gps}};
 const proposal=Departments.propose(Departments.defaultOrganization(),draft);
 assert.equal(proposal.ok,true);
 assert.deepEqual(proposal.organization.sites[3].gps,gps);
 assert.notEqual(proposal.organization.sites[3].gps,gps);
});
