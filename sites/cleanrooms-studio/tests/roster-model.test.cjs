const test=require('node:test');
const assert=require('node:assert/strict');
const Roster=require('../src/roster-model.js');
const Data=require('../src/studio-data.js');
const sites=require('../src/department-model.js').defaultOrganization().sites;
const person=overrides=>({id:'person-anna',name:'Anna Jensen',initials:'AJ',target:30,site:1,role:'Servicemedarbejder',active:true,...overrides});
const freeze=value=>{Object.freeze(value);Object.values(value).forEach(item=>{if(item&&typeof item==='object')freeze(item);});return value;};

test('roster defaults migrate only absence, retain legacy identities, and allow an intentionally empty company',()=>{
  const staff=Roster.normalize(undefined,{sites});assert.equal(staff.length,22);assert.equal(staff[0].id,'p0');assert.ok(staff.every(person=>person.active===true));
  staff[0].name='Changed';assert.notEqual(Data.staff[0].name,'Changed');
  assert.deepEqual(Roster.normalize([],{sites}),[]);
  for(const invalid of [null,{},false])assert.throws(()=>Roster.normalize(invalid,{sites}),TypeError);
});

test('staff validation rejects invalid identities, missing fields, nonfinite hours and unknown worksite indices',()=>{
  assert.deepEqual(Roster.validate([person()],{sites}),[]);
  for(const patch of [{id:'../unsafe'},{id:'person-'},{name:' Anna '},{name:'\nAnna'},{name:'A'.repeat(121)},{initials:''},{target:NaN},{target:Infinity},{target:-1},{target:169},{target:'30'},{site:3},{site:1.5},{role:''},{active:1}])assert.ok(Roster.validate([person(patch)],{sites}).length,JSON.stringify(patch));
  assert.ok(Roster.validate([person(),person()],{sites}).some(message=>message.includes('flere gange')));
  assert.deepEqual(Roster.validate([person({target:0}),person({id:'p21',target:168})],{sites}),[]);
});

test('upsert and archival preserve stable IDs, all other staff and caller data',()=>{
  const input=freeze([person(),person({id:'person-bob',name:'Bob',initials:'B'})]);const before=JSON.stringify(input);
  const archived=Roster.propose(input,{id:'person-anna',active:false},{sites});assert.equal(archived.ok,true);assert.equal(archived.staff.length,2);assert.equal(archived.staff[0].id,'person-anna');assert.equal(archived.staff[0].active,false);assert.equal(archived.staff[1].name,'Bob');
  const added=Roster.propose(archived.staff,{...person({id:'person-camilla',name:'Camilla',initials:'C'}),create:true},{sites});assert.equal(added.ok,true);assert.equal(added.staff.length,3);
  assert.equal(Roster.propose(input,{...person(),create:true},{sites}).ok,false);
  assert.equal(Roster.propose(input,{...person({id:'person-missing'})},{sites}).ok,false);
  assert.equal(JSON.stringify(input),before);
});

test('CSV parser handles BOM, semicolons, escaped quotes and quoted newlines without evaluating content',()=>{
  const csv='\uFEFFNavn;Funktion;Timer\r\n"Anna; Jensen";"Teamleder ""Nord""";30\r\n"To\nlinjer";"=HYPERLINK(""https://example.test"")";20\r\n';
  const result=Roster.parseCSV(csv);assert.equal(result.delimiter,';');assert.deepEqual(result.issues,[]);assert.equal(result.rows.length,3);
  assert.deepEqual(result.rows[1],{row:2,cells:['Anna; Jensen','Teamleder "Nord"','30']});
  assert.deepEqual(result.rows[2],{row:3,cells:['To\nlinjer','=HYPERLINK("https://example.test")','20']});
  assert.equal(Roster.parseCSV('Navn,Timer\n"Jensen, Anna",30').delimiter,',');
  assert.ok(Roster.parseCSV('Navn,Timer\n"Anna,30').issues.length);
  assert.ok(Roster.parseCSV('Navn,Timer\n"Anna"x,30').issues.length);
});

test('pasted CSV enforces byte, row and column limits before retaining unbounded input or diagnostics',()=>{
  for(const input of ['Navn\n'+'ø'.repeat(3*1024*1024),'Navn\n'+'Anna\n'.repeat(5001),Array(34).fill('Navn').join(';')+'\nAnna']){
    const result=Roster.parseCSV(input);assert.ok(result.issues.some(issue=>issue.code==='limit'));assert.ok(result.issues.length<=100);assert.ok(result.rows.length<=5001);
  }
  const malformed=Roster.parseCSV('Navn\n"Anna"'+'x'.repeat(100000));assert.equal(malformed.issues.length,1);assert.ok(JSON.stringify(malformed.issues).length<1000);
  const manyQuotes=Roster.parseCSV('Navn\nAnna'+'"'.repeat(100000));assert.ok(manyQuotes.issues.length<=100);assert.ok(JSON.stringify(manyQuotes.issues).length<20000);
});

test('CSV preview merges explicit IDs, resolves names and stable worksite IDs, handles Danish decimal hours, and stays immutable',()=>{
  const input=freeze([person(),person({id:'person-bob',name:'Bob',initials:'B'})]);const before=JSON.stringify(input);
  const csv='ID;Navn;Initialer;Timer;Arbejdssted;Funktion;Aktiv\nperson-anna;Anna Jensen;AJ;32,5;site-nord;Teamleder;nej\n;Camilla Sørensen;;20;Havnegade;Servicemedarbejder;ja';
  const result=Roster.previewCSV(csv,{staff:input,sites,idForRow:row=>'person-row-'+row});assert.equal(result.ok,true,result.error);assert.equal(result.staff.length,3);assert.equal(result.rows[1].person.id,'person-row-3');
  assert.deepEqual(result.staff[0],person({target:32.5,site:0,role:'Teamleder',active:false}));assert.equal(result.staff[1].id,'person-bob');assert.equal(result.staff[2].initials,'CS');assert.equal(result.staff[2].site,2);assert.equal(JSON.stringify(input),before);
});

test('CSV duplicate IDs and ambiguous existing names block the whole preview; no partial result is saveable',()=>{
  const options={staff:[person()],sites,idForRow:row=>'person-row-'+row};
  for(const csv of ['Navn\nAnna Jensen','ID,Navn\nperson-new,New\nperson-new,Other','Navn\nNew Person\nNew Person']){
    const result=Roster.previewCSV(csv,options);assert.equal(result.ok,false);assert.equal(result.staff,null);assert.ok(result.issues.some(issue=>issue.code==='duplicate'));
  }
  assert.equal(Roster.previewCSV('ID,Navn\nperson-anna,Anna Jensen',options).ok,true);
});

test('CSV malformed columns, bad values and unknown headers produce actionable row errors',()=>{
  for(const csv of ['','Navn','Email\na@example.test','Navn,Navn\nA,B','Navn,Timer\nAnna,20,extra','Navn,Timer\nAnna,Infinity','Navn,Arbejdssted\nAnna,Missing','Navn,Aktiv\nAnna,maybe']){
    const result=Roster.previewCSV(csv,{staff:[],sites,idForRow:row=>'person-row-'+row});assert.equal(result.ok,false,csv);assert.equal(result.staff,null);assert.ok(result.error);assert.ok(result.issues.every(issue=>Number.isInteger(issue.row)));
  }
});

test('formula-looking names and markup stay literal text, never executable import instructions',()=>{
  const name='=HYPERLINK("https://example.test")';const escaped=name.replaceAll('"','""');
  const result=Roster.previewCSV('Navn,Funktion\n"'+escaped+'",<img src=x onerror=alert(1)>',{staff:[],sites,idForRow:()=> 'person-literal'});
  assert.equal(result.ok,true,result.error);assert.equal(result.staff[0].name,name);assert.equal(result.staff[0].role,'<img src=x onerror=alert(1)>');
});
