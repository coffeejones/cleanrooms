/* Staff records are durable identities; archiving never removes their history. */
(() => {
  'use strict';
  const Data=globalThis.CleanRoomsData||(typeof require==='function'?require('./studio-data.js'):null);
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const clone=value=>JSON.parse(JSON.stringify(value));
  const clean=(value,maximum)=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=maximum&&!/[\u0000-\u001f\u007f]/.test(value);
  const identifier=value=>typeof value==='string'&&value.length<=120&&/^(?:p\d+|person-[A-Za-z0-9][A-Za-z0-9_-]*)$/.test(value);
  const initials=name=>String(name||'').trim().split(/\s+/).filter(Boolean).slice(0,3).map(part=>Array.from(part)[0]).join('').toLocaleUpperCase('da-DK');
  const normalized=value=>String(value).trim().toLocaleLowerCase('da-DK');
  const defaultEmployeeTarget=37;
  const workHoursBudgetLimit=4_000_000;
  function validWorkHoursBudget(value) {
    if(!record(value)||Object.keys(value).length!==2||!['week','month'].includes(value.period))return false;
    const {hours}=value;
    return Number.isFinite(hours)&&hours>=0&&hours<=workHoursBudgetLimit&&Math.round(hours*100)/100===hours;
  }
  function validate(staff,{sites}={}) {
    if(!Array.isArray(staff))return ['Medarbejderlisten skal være en liste.'];
    const errors=[],ids=new Set();
    if(staff.length>5000)errors.push('Der må højst være 5000 medarbejdere.');
    if(!Array.isArray(sites)||!sites.length)errors.push('Medarbejderlisten kræver mindst ét gyldigt arbejdssted.');
    staff.forEach((person,index)=>{
      const label='Medarbejder '+(index+1)+': ';
      if(!record(person)){errors.push(label+'Oplysningerne er ugyldige.');return;}
      if(!identifier(person.id))errors.push(label+'Vælg et stabilt medarbejder-id.');
      else if(ids.has(person.id))errors.push(label+'Medarbejder-id forekommer flere gange: '+person.id);else ids.add(person.id);
      if(!clean(person.name,120))errors.push(label+'Navnet skal være udfyldt uden ydre mellemrum og højst være 120 tegn.');
      if(!clean(person.initials,8))errors.push(label+'Initialer skal være udfyldt uden ydre mellemrum og højst være 8 tegn.');
      if(typeof person.target!=='number'||!Number.isFinite(person.target)||person.target<0||person.target>168)errors.push(label+'Ugentlige timer skal være et tal fra 0 til 168.');
      if(!Number.isInteger(person.site)||person.site<0||!Array.isArray(sites)||person.site>=sites.length||!record(sites[person.site]))errors.push(label+'Vælg et eksisterende arbejdssted.');
      if(!clean(person.role,120))errors.push(label+'Funktionen skal være udfyldt uden ydre mellemrum og højst være 120 tegn.');
      if(typeof person.active!=='boolean')errors.push(label+'Aktiv skal være ja eller nej.');
    });
    return errors;
  }
  function normalize(staff,options) {
    const value=staff===undefined?Data.staff.map(person=>({...person,active:person.active!==false})):staff;
    const errors=validate(value,options);if(errors.length)throw new TypeError(errors.join(' '));
    return clone(value);
  }
  function propose(staff,draft,options) {
    const failure=error=>({ok:false,staff:null,person:null,error});
    let next;try{next=normalize(staff,options);}catch(error){return failure(error.message);}
    if(!record(draft)||!identifier(draft.id))return failure('Vælg et stabilt medarbejder-id.');
    const index=next.findIndex(person=>person.id===draft.id);
    if(draft.create===true&&index>=0)return failure('Medarbejderens id findes allerede.');
    if(draft.create!==true&&index<0)return failure('Medarbejderen findes ikke længere. Åbn listen igen.');
    const {create,...fields}=draft;
    const person={...(index>=0?next[index]:{}),...fields};
    if(index<0)next.push(person);else next[index]=person;
    const errors=validate(next,options);if(errors.length)return failure(errors[0]);
    return {ok:true,staff:next,person:clone(person),error:null};
  }
  function delimiterFor(text) {
    const counts={',':0,';':0};let quoted=false;
    for(let index=0;index<text.length;index++){
      const char=text[index];if(char==='"'){if(quoted&&text[index+1]==='"')index++;else quoted=!quoted;}
      else if(!quoted&&(char==='\n'||char==='\r'))break;
      else if(!quoted&&Object.hasOwn(counts,char))counts[char]++;
    }
    return counts[';']>counts[',']?';':',';
  }
  function parseCSV(text) {
    if(typeof text!=='string')return {delimiter:',',rows:[],issues:[{row:1,field:'',code:'format',message:'CSV-filen skal være tekst.'}]};
    const limitIssue=(row,message)=>({row,field:'',code:'limit',message});
    const maxBytes=5*1024*1024,maxRows=5001,maxColumns=32,maxIssues=100;
    // Apply the same byte bound to pasted text as to an uploaded file, before
    // retaining rows or diagnostics. Invalid input must not amplify into MB of errors.
    if(text.length>maxBytes||new TextEncoder().encode(text).byteLength>maxBytes)return {delimiter:',',rows:[],issues:[limitIssue(1,'CSV-filen må højst være 5 MB.')]};
    text=text.replace(/^\uFEFF/,'');
    const delimiter=delimiterFor(text),rows=[],issues=[];let cells=[],value='',state='plain',line=1,startLine=1;
    const issue=message=>issues.push({row:startLine,field:'',code:'quote',message:'Række '+startLine+': '+message});
    const cell=()=>{cells.push(value);value='';state='plain';};
    const row=()=>{cell();if(cells.some(item=>item.trim()!==''))rows.push({row:startLine,cells});cells=[];startLine=line+1;};
    for(let index=0;index<text.length;index++){
      if(rows.length>=maxRows||cells.length>=maxColumns||issues.length>=maxIssues)return {delimiter,rows:[],issues:[...issues.slice(0,maxIssues-1),limitIssue(startLine,'Importen er for stor eller har for mange fejl. Brug højst 5000 medarbejdere og 32 kolonner.') ]};
      const char=text[index];
      if(state==='quoted'){
        if(char==='"'){if(text[index+1]==='"'){value+='"';index++;}else state='closed';}
        else{value+=char;if(char==='\n')line++;else if(char==='\r'&&text[index+1]!=='\n')line++;}
        continue;
      }
      if(char===delimiter){cell();continue;}
      if(char==='\n'||char==='\r'){
        row();if(char==='\r'&&text[index+1]==='\n')index++;line++;startLine=line;continue;
      }
      if(state==='closed'||state==='invalid-closed'){
        if(state==='closed'&&char!==' '&&char!=='\t'){issue('Der må kun stå et skilletegn efter et afsluttende citationstegn.');state='invalid-closed';}
        continue;
      }
      if(char==='"'){
        if(value.trim()===''){value='';state='quoted';}
        else issue('Et citationstegn skal stå omkring hele feltet.');
      }else value+=char;
    }
    if(state==='quoted')issues.push({row:startLine,field:'',code:'quote',message:'Række '+startLine+': Et felt mangler sit afsluttende citationstegn.'});
    if(value!==''||cells.length||state==='closed')row();
    return {delimiter,rows,issues};
  }
  const HEADERS=new Map([
    ['id','id'],['medarbejder-id','id'],['medarbejder id','id'],['name','name'],['navn','name'],
    ['initials','initials'],['initialer','initials'],['target','target'],['timer','target'],['ugentlige timer','target'],
    ['site','site'],['arbejdssted','site'],['role','role'],['funktion','role'],['active','active'],['aktiv','active']
  ]);
  function newId(){return 'person-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));}
  function previewCSV(text,{staff=[],sites,idForRow=()=>newId()}={}) {
    const failure=(issues,rows=[])=>({ok:false,staff:null,rows,issues,error:issues[0]?.message||'CSV-filen kunne ikke importeres.'});
    let next;try{next=normalize(staff,{sites});}catch(error){return failure([{row:0,field:'',code:'roster',message:error.message}]);}
    const parsed=parseCSV(text),issues=[...parsed.issues],rows=[];
    if(!parsed.rows.length)return failure([{row:1,field:'',code:'empty',message:'CSV-filen er tom. Tilføj en overskrift og mindst én medarbejder.'}]);
    const header=parsed.rows[0],columns=header.cells.map(item=>HEADERS.get(normalized(item))),seenColumns=new Set();
    columns.forEach((key,index)=>{if(!key)issues.push({row:header.row,field:'',code:'header',message:'Ukendt kolonne: '+header.cells[index]});else if(seenColumns.has(key))issues.push({row:header.row,field:key,code:'header',message:'Kolonnen forekommer flere gange: '+header.cells[index]});else seenColumns.add(key);});
    if(!columns.includes('name'))issues.push({row:header.row,field:'name',code:'header',message:'CSV-filen skal have kolonnen Navn.'});
    if(parsed.rows.length<2)issues.push({row:header.row+1,field:'',code:'empty',message:'CSV-filen indeholder ingen medarbejdere.'});
    if(issues.length)return failure(issues);
    const seenIds=new Set(),seenNames=new Set();
    for(const entry of parsed.rows.slice(1)){
      if(issues.length>=100)break;
      if(entry.cells.length!==columns.length){issues.push({row:entry.row,field:'',code:'columns',message:'Række '+entry.row+': Antallet af felter passer ikke til overskriften.'});continue;}
      const raw=Object.fromEntries(columns.map((key,index)=>[key,entry.cells[index].trim()]));
      const previous=raw.id?next.find(person=>person.id===raw.id):null;
      const person={...(previous||{}),id:raw.id||idForRow(entry.row,raw),name:raw.name,initials:raw.initials||initials(raw.name),target:previous?.target??defaultEmployeeTarget,site:previous?.site??0,role:raw.role||previous?.role||'Servicemedarbejder',active:previous?.active??true};
      const report=(field,code,message)=>issues.push({row:entry.row,field,code,message:'Række '+entry.row+': '+message});
      if(seenIds.has(person.id))report('id','duplicate','Medarbejder-id forekommer flere gange.');seenIds.add(person.id);
      const nameKey=normalized(person.name);
      if(!raw.id&&(seenNames.has(nameKey)||next.some(item=>normalized(item.name)===nameKey)))report('name','duplicate','Navnet findes allerede. Brug medarbejder-id for at opdatere en eksisterende medarbejder.');seenNames.add(nameKey);
      if(raw.target!==undefined&&raw.target!==''){
        if(!/^\d+(?:[.,]\d+)?$/.test(raw.target))report('target','number','Ugentlige timer skal være et tal fra 0 til 168.');
        else person.target=Number(raw.target.replace(',','.'));
      }
      if(raw.site!==undefined&&raw.site!==''){
        if(/^\d+$/.test(raw.site))person.site=Number(raw.site);
        else{
          const matches=sites.map((site,index)=>({site,index})).filter(({site})=>normalized(site.name)===normalized(raw.site)||site.id===raw.site);
          if(matches.length===1)person.site=matches[0].index;else report('site','site','Arbejdsstedet findes ikke eller er tvetydigt.');
        }
      }
      if(raw.active!==undefined&&raw.active!==''){
        const active=normalized(raw.active);if(['ja','true','1','aktiv'].includes(active))person.active=true;
        else if(['nej','false','0','arkiveret'].includes(active))person.active=false;
        else report('active','boolean','Aktiv skal være ja eller nej.');
      }
      const errors=validate([person],{sites});errors.forEach(message=>report('', 'validation',message.replace(/^Medarbejder 1: /,'')));
      rows.push({row:entry.row,person:clone(person)});
      if(!errors.length){const index=next.findIndex(item=>item.id===person.id);if(index<0)next.push(person);else next[index]=person;}
    }
    if(next.length>5000)issues.push({row:0,field:'',code:'limit',message:'Der må højst være 5000 medarbejdere.'});
    return issues.length?failure(issues.slice(0,100),rows):{ok:true,staff:next,rows,issues:[],error:null};
  }
  const api=Object.freeze({validate,normalize,propose,parseCSV,previewCSV,initials,newId,defaultEmployeeTarget,workHoursBudgetLimit,validWorkHoursBudget});
  globalThis.CleanRoomsRoster=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
