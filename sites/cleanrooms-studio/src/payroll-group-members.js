/* Read-only membership summaries. Status reflects effective terms, never historical override flags. */
(() => {
  'use strict';
  const Payroll=globalThis.CleanRoomsPayroll||(typeof require==='function'?require('./payroll-model.js'):null);
  const Groups=globalThis.CleanRoomsPayrollGroups||(typeof require==='function'?require('./payroll-groups-model.js'):null);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  function validDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const [y,m,d]=value.split('-').map(Number),date=new Date(0);date.setUTCHours(12,0,0,0);date.setUTCFullYear(y,m-1,d);
    return y>0&&date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;
  }
  function after(value){const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+1);return date.getUTCFullYear()>9999?null:date.toISOString().slice(0,10);}
  const latest=(items,date)=>items.filter(item=>item.from<=date).at(-1)||null;
  const active=(rule,date)=>rule.from<=date&&(!rule.to||rule.to>=date);
  const basic=rate=>rate?{amountCents:rate.amountCents,type:rate.type,from:rate.from}:null;
  const semantic=rule=>({name:rule.name,type:rule.type,amountCents:rule.amountCents,weekdays:rule.weekdays,start:rule.start,end:rule.end});
  function build({policy,people,date,groupId}={}){
    if(!validDate(date))throw new TypeError('Vælg en gyldig dato for medlemsoversigten.');
    if(!Array.isArray(people)||people.length>5000)throw new TypeError('Medlemsoversigten kræver højst 5000 medarbejdere.');
    if(groupId!==undefined&&(typeof groupId!=='string'||!groupId))throw new TypeError('Vælg et gyldigt løngruppe-id.');
    const normalized=Groups.normalize(policy),groups=new Map(normalized.groups.map(group=>[group.id,group])),ids=new Set(),linksByPerson=new Map();
    for(const link of normalized.links){if(!linksByPerson.has(link.personId))linksByPerson.set(link.personId,[]);linksByPerson.get(link.personId).push(link);}
    const members=people.map(person=>{
      if(!record(person)||typeof person.personId!=='string'||!person.personId.trim()||person.personId!==person.personId.trim()||ids.has(person.personId)||typeof person.name!=='string'||!Object.hasOwn(person,'payroll'))throw new TypeError('Medlemsoversigten kræver entydige medarbejder-id’er og navne.');
      ids.add(person.personId);
      const personal=Payroll.normalize(person.payroll),links=linksByPerson.get(person.personId)||[];
      // The complete policy was validated above. Resolve through the same payroll engine,
      // scoped to this person's references so a large roster does not repeatedly normalize every colleague's links.
      const ownGroups=[...new Set(links.map(link=>link.groupId).filter(Boolean))].map(id=>groups.get(id));
      const resolved=Groups.resolve({policy:{schema:1,groups:ownGroups,links},personId:person.personId,payroll:personal,from:date,to:date});
      function snapshot(day,currentResolved=null){
        const link=latest(links,day),group=link?.groupId?groups.get(link.groupId):null,revision=latest(group?.revisions||[],day);
        const groupRate=latest(revision?.payroll.agreements||[],day),isPersonal=!link?.groupId||link.baseMode==='personal';
        const rate=latest(isPersonal?personal.agreements:revision?.payroll.agreements||[],day);
        const source=currentResolved?.periods?.[0]?.source?.origin||(rate?(isPersonal?'personal':'group'):'missing');
        const base={amountCents:rate?.amountCents??null,type:rate?.type??null,origin:source,from:rate?.from??null,groupAmountCents:groupRate?.amountCents??null,groupType:groupRate?.type??null};
        const exceptions=[],effective=[];
        if(isPersonal&&rate)exceptions.push({kind:'base',id:rate.id,name:'Grundløn',label:'Personlig grundløn',amountCents:rate.amountCents,type:rate.type,groupAmountCents:groupRate?.amountCents??null,groupType:groupRate?.type??null});
        for(const rule of revision?.payroll.supplements||[]){
          const override=link.supplementOverrides.find(item=>item.id===rule.id);
          if(override?.mode==='off'){
            if(active(rule,day))exceptions.push({kind:'supplement-off',id:rule.id,name:rule.name,label:'Fravalgt gruppetillæg',amountCents:null,type:rule.type,groupAmountCents:rule.amountCents,groupType:rule.type,rule:null,groupRule:clone(rule)});
          }else if(override?.mode==='personal'){
            const own=override.supplement,ownActive=active(own,day),groupActive=active(rule,day);
            if(ownActive||groupActive)exceptions.push({kind:'supplement-personal',id:rule.id,name:rule.name,label:ownActive?'Personligt beløb':own.from>day?'Personligt tillæg starter senere':'Personligt tillæg er udløbet',amountCents:ownActive?own.amountCents:null,type:own.type,groupAmountCents:groupActive?rule.amountCents:null,groupType:rule.type,rule:clone(own),groupRule:clone(rule)});
            if(ownActive)effective.push({origin:'personal',...semantic(own)});
          }else if(active(rule,day))effective.push({origin:'group',...semantic(rule)});
        }
        for(const rule of personal.supplements){
          if(!active(rule,day)||link?.excludedPersonalSupplementIds.includes(rule.id))continue;
          exceptions.push({kind:'personal-extra',id:rule.id,name:rule.name,label:'Personligt ekstratillæg',amountCents:rule.amountCents,type:rule.type,groupAmountCents:null,groupType:null,rule:clone(rule),groupRule:null});
          effective.push({origin:'personal-extra',...semantic(rule)});
        }
        const status=source==='missing'?'missing':exceptions.length?'personal':'group';
        return {personId:person.personId,name:person.name,groupId:group?.id||null,groupName:group?.name||null,status,label:status==='missing'?'Grundløn mangler':status==='personal'?'Personlige undtagelser':'Følger gruppen',base,exceptions,followsBase:source==='group',followsSupplements:!exceptions.some(item=>item.kind!=='base'),exceptionCount:exceptions.length,activeFrom:link?.from||null,
          _signature:JSON.stringify({groupId:group?.id||null,base:{amountCents:base.amountCents,type:base.type,origin:base.origin},effective:effective.sort((a,b)=>compare(JSON.stringify(a),JSON.stringify(b)))})};
      }
      const current=snapshot(date,resolved),boundaries=new Set(),add=day=>{if(day&&day>date)boundaries.add(day);};
      const configs=[personal];
      for(const link of links){add(link.from);for(const override of link.supplementOverrides)if(override.supplement)configs.push({agreements:[],supplements:[override.supplement]});}
      for(const id of new Set(links.map(link=>link.groupId).filter(Boolean)))for(const revision of groups.get(id)?.revisions||[]){add(revision.from);configs.push(revision.payroll);}
      for(const config of configs){for(const agreement of config.agreements)add(agreement.from);for(const rule of config.supplements){add(rule.from);if(rule.to)add(after(rule.to));}}
      let upcoming=null;
      for(const future of [...boundaries].sort(compare)){
        const next=snapshot(future);
        if(next._signature===current._signature)continue;
        upcoming={date:future,kind:next.groupId!==current.groupId?'assignment':'terms',groupId:next.groupId,groupName:next.groupName,status:next.status,label:next.label,base:next.base,exceptions:next.exceptions};break;
      }
      delete current._signature;return {...current,upcoming};
    });
    const resultGroups=normalized.groups.map(group=>{
      const groupMembers=members.filter(member=>member.groupId===group.id),revision=latest(group.revisions,date),base=basic(latest(revision?.payroll.agreements||[],date));
      return {id:group.id,name:group.name,archived:group.archived,base,counts:{total:groupMembers.length,group:groupMembers.filter(member=>member.status==='group').length,personal:groupMembers.filter(member=>member.status==='personal').length,missing:groupMembers.filter(member=>member.status==='missing').length,upcoming:groupMembers.filter(member=>member.upcoming).length},members:groupMembers};
    });
    return {date,groups:groupId===undefined?resultGroups:resultGroups.filter(group=>group.id===groupId),members:groupId===undefined?members:members.filter(member=>member.groupId===groupId)};
  }
  const api=Object.freeze({build});globalThis.CleanRoomsPayrollGroupMembers=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
