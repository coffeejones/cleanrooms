/* Private, dated pay policy compilation. Raw personal agreements are never rewritten. */
(() => {
  'use strict';
  const Payroll=globalThis.CleanRoomsPayroll||(typeof require==='function'?require('./payroll-model.js'):null);
  const DAY=86400000,record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const clone=value=>Array.isArray(value)?value.map(clone):record(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  const text=(value,max=160)=>typeof value==='string'&&value.length>0&&value===value.trim()&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
  const keys=(value,expected)=>Object.keys(value).every(key=>expected.includes(key))&&expected.every(key=>Object.hasOwn(value,key));
  function parse(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const [year,month,day]=value.split('-').map(Number),date=new Date(0);if(year<1||month<1||month>12||day<1||day>31)return null;
    date.setUTCHours(12,0,0,0);date.setUTCFullYear(year,month-1,day);
    return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date:null;
  }
  function addDays(value,count){const date=parse(value);date.setUTCDate(date.getUTCDate()+count);return date.getUTCFullYear()<1||date.getUTCFullYear()>9999?null:date.toISOString().slice(0,10);}
  function requireDate(value){if(!parse(value))throw new TypeError('Vælg en gyldig dato i formatet ÅÅÅÅ-MM-DD.');}
  const blank=()=>({schema:1,groups:[],links:[]});
  function validate(policy){
    if(policy==null)return [];
    if(!record(policy))return ['Løngrupper skal være et objekt.'];
    const errors=[],groups=new Map();
    if(!keys(policy,['schema','groups','links'])||policy.schema!==1)errors.push('Løngrupper skal have version 1 og præcis grupper og tilknytninger.');
    if(!Array.isArray(policy.groups)||policy.groups.length>200)errors.push('Der må højst være 200 løngrupper.');
    if(!Array.isArray(policy.links)||policy.links.length>20000)errors.push('Der må højst være 20000 daterede tilknytninger.');
    if(Array.isArray(policy.groups))policy.groups.forEach((group,index)=>{
      const label='Løngruppe '+(index+1)+': ';
      if(!record(group)){errors.push(label+'Oplysningerne er ugyldige.');return;}
      if(!keys(group,['id','name','archived','revisions']))errors.push(label+'Gruppen skal indeholde præcis id, navn, arkivstatus og versioner.');
      if(!text(group.id)||groups.has(group.id))errors.push(label+'Vælg et entydigt gruppe-id.');else groups.set(group.id,group);
      if(!text(group.name,120))errors.push(label+'Navnet skal være udfyldt og højst være 120 tegn uden ydre mellemrum.');
      if(typeof group.archived!=='boolean')errors.push(label+'Arkivstatus skal være ja eller nej.');
      if(!Array.isArray(group.revisions)||!group.revisions.length||group.revisions.length>500){errors.push(label+'Gruppen skal have 1 til 500 daterede versioner.');return;}
      const ids=new Set(),dates=new Set();
      group.revisions.forEach(revision=>{
        if(!record(revision)){errors.push(label+'En version er ugyldig.');return;}
        if(!keys(revision,['id','from','payroll']))errors.push(label+'En version skal indeholde præcis id, startdato og lønopsætning.');
        if(!text(revision.id)||ids.has(revision.id))errors.push(label+'Hver version skal have et entydigt id.');else ids.add(revision.id);
        if(!parse(revision.from)||dates.has(revision.from))errors.push(label+'Hver version skal have en gyldig, entydig startdato.');else dates.add(revision.from);
        const configErrors=record(revision.payroll)?Payroll.validate(revision.payroll):['Lønopsætningen mangler.'];
        configErrors.forEach(message=>errors.push(label+message));
        if(!configErrors.length&&!revision.payroll.agreements.some(agreement=>agreement.from<=revision.from))errors.push(label+'Versionen skal have en grundløn, der gælder senest på versionens startdato.');
      });
    });
    const snapshots=new Set();
    if(Array.isArray(policy.links))policy.links.forEach((link,index)=>{
      const label='Tilknytning '+(index+1)+': ';
      if(!record(link)){errors.push(label+'Oplysningerne er ugyldige.');return;}
      if(!keys(link,['personId','from','groupId','baseMode','excludedPersonalSupplementIds','supplementOverrides']))errors.push(label+'Tilknytningen skal indeholde præcis medarbejder, startdato, gruppe, grundløn og tillægsvalg.');
      const identity=JSON.stringify([link.personId,link.from]);
      if(!text(link.personId)||!parse(link.from)||snapshots.has(identity))errors.push(label+'Vælg et medarbejder-id og en gyldig dato uden dobbelte tilknytninger samme dag.');else snapshots.add(identity);
      const group=groups.get(link.groupId);
      if(link.groupId!==null&&(!text(link.groupId)||!group))errors.push(label+'Løngruppen findes ikke.');
      if(!['group','personal'].includes(link.baseMode)||link.groupId===null&&link.baseMode!=='personal')errors.push(label+'Vælg personlig grundløn uden gruppe eller en gyldig grundløn fra gruppen.');
      if(!Array.isArray(link.excludedPersonalSupplementIds)||link.excludedPersonalSupplementIds.length>1000||link.excludedPersonalSupplementIds.some(id=>!text(id))||new Set(link.excludedPersonalSupplementIds).size!==link.excludedPersonalSupplementIds.length)errors.push(label+'Fravalg af personlige tillæg skal være en entydig liste med højst 1000 id’er.');
      if(!Array.isArray(link.supplementOverrides)||link.supplementOverrides.length>1000){errors.push(label+'Der må højst være 1000 individuelle tillægsvalg.');return;}
      const known=new Set((Array.isArray(group?.revisions)?group.revisions:[]).flatMap(revision=>Array.isArray(revision?.payroll?.supplements)?revision.payroll.supplements.map(supplement=>supplement?.id):[])),ids=new Set();
      if(link.groupId===null&&link.supplementOverrides.length)errors.push(label+'Individuelle gruppevalg kræver en løngruppe.');
      for(const override of link.supplementOverrides){
        if(!record(override)||!keys(override,['id','mode','supplement'])){errors.push(label+'Et individuelt tillægsvalg er ugyldigt.');continue;}
        if(!text(override.id)||!known.has(override.id)||ids.has(override.id))errors.push(label+'Tillægsvalget skal pege på et entydigt, kendt gruppetillæg.');else ids.add(override.id);
        if(override.mode==='off'){if(override.supplement!==null)errors.push(label+'Et fravalgt gruppetillæg må ikke have en erstatning.');}
        else if(override.mode==='personal'){
          if(!record(override.supplement))errors.push(label+'En personlig erstatning skal have et gyldigt tillæg.');
          else Payroll.validate({currency:'DKK',agreements:[],supplements:[override.supplement]}).forEach(message=>errors.push(label+message));
        }else errors.push(label+'Vælg fravalg eller personlig erstatning af gruppetillæg.');
      }
    });
    return errors;
  }
  function normalize(policy){
    if(policy==null)return blank();const errors=validate(policy);if(errors.length)throw new TypeError(errors.join(' '));
    return {schema:1,groups:policy.groups.map(group=>({...clone(group),revisions:group.revisions.map(revision=>({...clone(revision),payroll:Payroll.normalize(revision.payroll)})).sort((a,b)=>compare(a.from,b.from)||compare(a.id,b.id))})).sort((a,b)=>compare(a.id,b.id)),
      links:policy.links.map(link=>({...clone(link),excludedPersonalSupplementIds:[...link.excludedPersonalSupplementIds].sort(compare),supplementOverrides:link.supplementOverrides.map(override=>({...clone(override),supplement:override.supplement===null?null:Payroll.normalize({currency:'DKK',agreements:[],supplements:[override.supplement]}).supplements[0]})).sort((a,b)=>compare(a.id,b.id))})).sort((a,b)=>compare(a.personId,b.personId)||compare(a.from,b.from))};
  }
  function context(policy,personId,payroll){return {policy,personId,payroll,links:policy.links.filter(link=>link.personId===personId),groups:new Map(policy.groups.map(group=>[group.id,group]))};}
  function latest(items,date){let current=null;for(const item of items){if(item.from>date)break;current=item;}return current;}
  const linkAt=(ctx,date)=>latest(ctx.links,date);
  function groupAt(ctx,id,date){const group=ctx.groups.get(id);return group?{id:group.id,name:group.name,archived:group.archived,revision:latest(group.revisions,date)}:null;}
  function linkFor(policy,personId,date){requireDate(date);if(!text(personId))throw new TypeError('Vælg et gyldigt medarbejder-id.');return clone(linkAt(context(normalize(policy),personId,null),date));}
  function groupFor(policy,groupId,date){requireDate(date);if(!text(groupId))throw new TypeError('Vælg et gyldigt gruppe-id.');return clone(groupAt(context(normalize(policy),'',null),groupId,date));}
  const source=(origin,group,raw,extra={})=>({origin,groupId:group?.id||null,groupName:group?.name||null,sourceId:raw?.id||null,...(group?.revision?{revisionId:group.revision.id}:{}),...extra});
  function selected(ctx,date){
    const link=linkAt(ctx,date),group=link?.groupId?groupAt(ctx,link.groupId,date):null,personalBase=!link?.groupId||link.baseMode==='personal';
    const agreement=latest(personalBase?ctx.payroll.agreements:group?.revision?.payroll.agreements||[],date);
    const baseSource=agreement?source(personalBase?'personal':'group',personalBase?null:group,agreement):source('missing',personalBase?null:group,null);
    const supplements=ctx.payroll.supplements.filter(supplement=>!link?.excludedPersonalSupplementIds.includes(supplement.id)).map(supplement=>({supplement,source:source('personal',null,supplement)}));
    for(const supplement of group?.revision?.payroll.supplements||[]){
      const override=link.supplementOverrides.find(item=>item.id===supplement.id);if(override?.mode==='off')continue;
      supplements.push(override?.mode==='personal'?{supplement:override.supplement,source:source('personal',group,override.supplement,{override:true,targetId:supplement.id})}:{supplement,source:source('group',group,supplement)});
    }
    return {link,group,personalBase,agreement,baseSource,supplements};
  }
  function boundaries(ctx,from,to){
    const dates=new Set([from]),add=value=>{if(value&&value>=from&&(!to||value<=to))dates.add(value);};
    const configs=[ctx.payroll],groupIds=new Set(ctx.links.map(link=>link.groupId).filter(Boolean));
    for(const link of ctx.links){add(link.from);for(const override of link.supplementOverrides)if(override.supplement)configs.push({agreements:[],supplements:[override.supplement]});}
    for(const id of groupIds)for(const revision of ctx.groups.get(id)?.revisions||[]){add(revision.from);configs.push(revision.payroll);}
    for(const config of configs){for(const agreement of config.agreements)add(agreement.from);for(const supplement of config.supplements){add(supplement.from);if(supplement.to)add(addDays(supplement.to,1));}}
    return [...dates].sort(compare);
  }
  function fingerprint(value){return JSON.stringify(value);}
  function shortId(prefix,value,index){let hash=2166136261;for(const char of fingerprint(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return prefix+'-'+(hash>>>0).toString(36)+'-'+index.toString(36);}
  function resolve({policy,personId,payroll,from,to}={}){
    requireDate(from);requireDate(to);if(from>to||(parse(to)-parse(from))/DAY>=366)throw new RangeError('Lønperioden skal være på 1 til 366 dage.');
    if(!text(personId))throw new TypeError('Vælg et gyldigt medarbejder-id.');
    const ctx=context(normalize(policy),personId,Payroll.normalize(payroll)),firstAnchor=addDays(from,-1)||from,dates=boundaries(ctx,firstAnchor,to),runs=[],supplementRuns=[],periods=[],missingBasePeriods=[];
    for(let index=0;index<dates.length;index++){
      const start=dates[index],end=index+1<dates.length?addDays(dates[index+1],-1):to,chosen=selected(ctx,start),actualFrom=start<from?from:start;
      if(actualFrom<=end){
        const base=chosen.agreement?{type:chosen.agreement.type,amountCents:chosen.agreement.amountCents}:null;
        const info={from:actualFrom,to:end,link:clone(chosen.link),group:clone(chosen.group),personalBase:chosen.personalBase,base:clone(base),source:clone(chosen.baseSource)};periods.push(info);
        const identity=fingerprint({base,source:chosen.baseSource}),last=runs.at(-1);
        if(last&&last.identity===identity&&addDays(last.to,1)===actualFrom)last.to=end;else runs.push({from:actualFrom,to:end,base,source:chosen.baseSource,identity});
      }
      for(const item of chosen.supplements){
        const original=item.supplement,overnight=original.type==='hourly'&&original.start!==null&&original.end<original.start;
        const lower=start<from&&!overnight?from:start,activeFrom=original.from>lower?original.from:lower,activeTo=original.to&&original.to<end?original.to:end;
        if(activeFrom>activeTo||activeTo<from&&!overnight)continue;
        const content={...clone(original)};delete content.id;delete content.from;delete content.to;
        const identity=fingerprint({content,source:item.source}),previous=supplementRuns.findLast(run=>run.identity===identity);
        if(previous&&addDays(previous.to,1)===activeFrom)previous.to=activeTo;else supplementRuns.push({from:activeFrom,to:activeTo,content,source:item.source,identity});
      }
    }
    const compiled={currency:'DKK',agreements:[],supplements:[]},sources={agreements:{},supplements:{}};
    for(const run of runs){
      if(!run.base){const previous=missingBasePeriods.at(-1);if(previous&&addDays(previous.to,1)===run.from)previous.to=run.to;else missingBasePeriods.push({from:run.from,to:run.to});if(!compiled.agreements.length)continue;}
      const id=shortId('pgb',{from:run.from,to:run.to,base:run.base,source:run.source},compiled.agreements.length);
      compiled.agreements.push({id,from:run.from,type:run.base?.type||'hourly',amountCents:run.base?.amountCents||0});sources.agreements[id]=clone(run.source);
    }
    supplementRuns.sort((a,b)=>compare(a.from,b.from)||compare(a.identity,b.identity));
    for(const run of supplementRuns){const id=shortId('pgs',{from:run.from,to:run.to,content:run.content,source:run.source},compiled.supplements.length);compiled.supplements.push({id,...clone(run.content),from:run.from,to:run.to});sources.supplements[id]=clone(run.source);}
    const current=selected(ctx,to),group=clone(current.group),currentLink=clone(current.link);
    return {from,to,payroll:Payroll.normalize(compiled),sources,periods,missingBasePeriods,currentLink,currentGroup:group,group,personalBase:current.personalBase};
  }
  function terms(ctx,date){
    const chosen=selected(ctx,date),previous=addDays(date,-1);
    const active=(supplement,day)=>supplement.from<=day&&(supplement.to===null||supplement.to>=day);
    const supplements=chosen.supplements.filter(({supplement})=>active(supplement,date)).map(item=>({...clone(item.supplement),...clone(item.source)}));
    if(previous){
      const seen=new Set(supplements.map(item=>supplementSignature([item]))),previousWeekday=(parse(previous).getUTCDay()+6)%7;
      for(const item of selected(ctx,previous).supplements){
        const supplement=item.supplement;if(supplement.type!=='hourly'||supplement.start===null||supplement.end>=supplement.start||!active(supplement,previous)||!supplement.weekdays.includes(previousWeekday))continue;
        const value={...clone(supplement),...clone(item.source)},identity=supplementSignature([value]);
        if(!seen.has(identity)){seen.add(identity);supplements.push({...value,carryFrom:previous});}
      }
    }
    supplements.sort((a,b)=>compare(fingerprint(a),fingerprint(b)));
    return {groupId:chosen.group?.id||null,groupName:chosen.group?.name||null,baseMode:chosen.personalBase?'personal':'group',personalBase:chosen.personalBase,base:chosen.agreement?{type:chosen.agreement.type,amountCents:chosen.agreement.amountCents}:null,agreement:clone(chosen.agreement),supplements,missingBase:!chosen.agreement};
  }
  function supplementSignature(items){return fingerprint(items.map(item=>{const value={...item};delete value.revisionId;return value;}).sort((a,b)=>compare(fingerprint(a),fingerprint(b))));}
  function preview({before,after,people,date}={}){
    requireDate(date);if(!Array.isArray(people)||people.length>5000)throw new TypeError('Lønforhåndsvisningen kræver højst 5000 medarbejdere.');
    const prior=normalize(before),next=normalize(after),ids=new Set(),rows=[];
    for(const person of people){
      if(!record(person)||!text(person.personId)||ids.has(person.personId)||person.version!==undefined&&(!Number.isSafeInteger(person.version)||person.version<0))throw new TypeError('Forhåndsvisningen kræver entydige medarbejder-id’er og gyldige versioner.');ids.add(person.personId);
      const personal=Payroll.normalize(person.payroll),oldContext=context(prior,person.personId,personal),newContext=context(next,person.personId,personal),dates=[...new Set([...boundaries(oldContext,date),...boundaries(newContext,date)])].sort(compare);
      let first=null,baseChanged=false,supplementsChanged=false,groupChanged=false,kept=false,missingBase=false;
      for(const day of dates){
        const oldTerms=terms(oldContext,day),newTerms=terms(newContext,day),base=fingerprint(oldTerms.base)!==fingerprint(newTerms.base),supplements=supplementSignature(oldTerms.supplements)!==supplementSignature(newTerms.supplements),group=oldTerms.groupId!==newTerms.groupId||oldTerms.groupName!==newTerms.groupName||oldTerms.baseMode!==newTerms.baseMode;
        baseChanged=baseChanged||base;supplementsChanged=supplementsChanged||supplements;groupChanged=groupChanged||group;missingBase=missingBase||newTerms.missingBase;
        kept=kept||Boolean((oldTerms.groupId||newTerms.groupId)&&oldTerms.personalBase&&newTerms.personalBase&&oldTerms.base&&!base);
        if(!first&&(base||supplements||group))first={date:day,before:oldTerms,after:newTerms};
      }
      const changed=baseChanged||supplementsChanged||groupChanged;
      rows.push({personId:person.personId,name:typeof person.name==='string'?person.name:person.personId,version:person.version||0,changed,baseChanged,supplementsChanged,groupChanged,personalPreserved:kept&&!baseChanged,missingBase,effectiveFrom:first?.date||null,before:first?.before||terms(oldContext,date),after:first?.after||terms(newContext,date)});
    }
    const affected=rows.filter(row=>row.changed),unchanged=rows.filter(row=>!row.changed),personalPreserved=rows.filter(row=>row.personalPreserved);
    return {date,rows,affected,unchanged,personalPreserved,counts:{total:rows.length,affected:affected.length,unchanged:unchanged.length,personalPreserved:personalPreserved.length,missingBase:rows.filter(row=>row.missingBase).length}};
  }
  const api=Object.freeze({normalize,validate,linkFor,groupFor,resolve,preview});globalThis.CleanRoomsPayrollGroups=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
