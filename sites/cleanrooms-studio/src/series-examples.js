/* Explicit, append-only demo agreements. Existing work is never refreshed or replaced. */
(() => {
  'use strict';
  const Engine=globalThis.CleanRoomsSeries||(typeof require==='function'?require('./series-engine.js'):null);
  const Lifecycle=globalThis.CleanRoomsSeriesLifecycle||(typeof require==='function'?require('./series-lifecycle.js'):null);
  const Data=globalThis.CleanRoomsData||(typeof require==='function'?require('./studio-data.js'):null);
  const Description=globalThis.CleanRoomsDescription||(typeof require==='function'?require('./description-model.js'):null);
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const clone=value=>Array.isArray(value)?value.map(clone):record(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
  const valid=value=>typeof value==='string'&&Engine.occurrenceAnchor('date@'+value,'date')===value;
  const date=value=>new Date(value+'T12:00:00Z');
  const add=(value,days)=>{const result=date(value);result.setUTCDate(result.getUTCDate()+days);const iso=result.toISOString();if(!/^\d{4}-\d{2}-\d{2}T/.test(iso))throw new RangeError('Eksemplernes datoer ligger uden for kalenderen.');return iso.slice(0,10);};
  const monday=value=>add(value,-((date(value).getUTCDay()+6)%7));
  function instructions(title,tasks){
    const first='Eksempel: '+title;
    if(!Description)return {note:[first,...tasks].join('\n')};
    const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:first}]},{type:'taskList',content:tasks.map(text=>({type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text}]}]}))}]};
    return {note:Description.text(doc),noteRich:Description.encode(doc)};
  }
  function create({today}={}){
    if(!valid(today))throw new TypeError('Vælg en gyldig dagsdato i formatet ÅÅÅÅ-MM-DD.');
    const anchor=monday(today),upcoming=add(anchor,14);
    const make=(id,groupId,person,site,startDate,endDate,weekdays,start,end,description,dayTimes)=>({id,groupId,person,site,startDate,endDate,weekdays,start,end,...description,...(dayTimes?{dayTimes}:{} )});
    const series=[
      make('demo-series-varied-1','demo-series-varied','p3',1,anchor,Engine.addMonths(anchor,2),[0,2,4],'16:00','19:00',instructions('Mikkels varierede eftermiddage i Klinikken. Tiderne er forskellige mandag, onsdag og fredag.',['Rengør kontaktflader og fællesrum','Fyld sæbe og papir op','Kontrollér lokalerne, og lås efter dig']),{'0':{start:'16:00',end:'19:00'},'2':{start:'17:00',end:'20:00'},'4':{start:'15:00',end:'18:00'}}),
      make('demo-series-periods-past','demo-series-periods','p2',0,add(anchor,-21),add(anchor,-1),[1,3],'18:00','20:00',instructions('Saras tidligere periode på Kontor Nord.',['Rengør skriveborde og mødelokaler','Tøm affald, og kontrollér alarmen'])),
      make('demo-series-periods-current','demo-series-periods','p2',0,anchor,add(anchor,27),[1,3],'18:00','20:00',instructions('Saras nuværende periode på Kontor Nord. Den efterfølgende periode skifter både tid og arbejdssted.',['Rengør køkken og kontaktflader','Kontrollér rengøringsmidler og udstyr','Lås, og slå alarmen til'])),
      make('demo-series-periods-future','demo-series-periods','p2',2,add(anchor,28),add(anchor,83),[1,3],'19:00','21:00',instructions('Saras kommende periode på Havnegade. Tirsdag og torsdag flyttes fra kl. 18–20 til kl. 19–21.',['Rengør fællesarealer og indgang','Tøm affald og fyld sæbe op','Kontrollér, at alle døre er låst'])),
      make('demo-series-expiring-1','demo-series-expiring','p5',2,add(anchor,-14),add(today,12),[0,2,4],'16:00','18:00',instructions('Olivers aftale på Havnegade udløber snart. Prøv Forlæng for at tilføje en ny periode.',['Rengør fællesrum og kontaktflader','Notér manglende materialer','Kontrollér lokalerne før lukning'])),
      make('demo-series-upcoming-1','demo-series-upcoming','p10',1,upcoming,Engine.addMonths(upcoming,2),[1,4],'16:00','19:00',instructions('Almas kommende opstart i Klinikken. Denne aftale er endnu ikke begyndt.',['Rengør behandlingsrum efter aftale','Fyld sæbe og papir op','Kontrollér, at udstyr er sat på plads'])),
      make('demo-series-ended-1','demo-series-ended','p7',0,add(anchor,-28),add(anchor,-1),[1,3],'15:00','17:00',instructions('Noahs afsluttede aftale på Kontor Nord. Brug den til at se historik eller oprette en selvstændig kopi.',['Rengør mødelokaler og kontaktflader','Tøm affald, og lås lokalerne']))
    ];
    const errors=Lifecycle.validate(series);if(errors.length)throw new RangeError(errors.join(' '));
    const titles={'demo-series-varied':'Varierende tider – Mikkel','demo-series-periods':'Tre perioder – Sara','demo-series-expiring':'Udløber snart – Oliver','demo-series-upcoming':'Kommende opstart – Alma','demo-series-ended':'Afsluttet aftale – Noah'};
    return {series,groups:Object.entries(titles).map(([id,title])=>({id,title,phaseIds:series.filter(phase=>phase.groupId===id).map(phase=>phase.id)}))};
  }
  function appendPlan(data,{today,staff,siteCount=3,blockedDates=[]}={}){
    if(!record(data)||data.series!==undefined&&!Array.isArray(data.series))throw new TypeError('Vagtplanens serier er ugyldige.');
    if(!Number.isInteger(siteCount)||siteCount<0)throw new TypeError('Antallet af arbejdssteder skal være et ikke-negativt helt tal.');
    const roster=staff===undefined?Data.staffFor(data):staff;
    if(!Array.isArray(roster)||roster.some(person=>!record(person)||typeof person.id!=='string')||new Set(roster.map(person=>person.id)).size!==roster.length)throw new TypeError('Medarbejderlisten er ugyldig.');
    if(!Array.isArray(blockedDates)||blockedDates.some(item=>!record(item)||typeof item.person!=='string'||!valid(item.date)))throw new TypeError('Listen over godkendt fravær er ugyldig.');
    const examples=create({today}),series=clone(data.series||[]),added=[],existing=[],skipped=[],ranges=[];
    const edits=record(data.edits)?data.edits:{},deleted=Array.isArray(data.deleted)?data.deleted:[],rosterById=new Map(roster.map(person=>[person.id,person]));
    for(const group of examples.groups){
      const phaseIds=new Set(group.phaseIds),recognized=id=>typeof id==='string'&&([...phaseIds].some(phase=>id===phase||id.startsWith(phase+'@'))||id===group.id);
      const present=series.some(phase=>phase&&((phase.groupId||phase.id)===group.id||phaseIds.has(phase.id)))
        ||Object.entries(edits).some(([id,shift])=>recognized(id)||phaseIds.has(shift?.seriesId)||shift?.groupId===group.id)
        ||deleted.some(recognized);
      if(present){existing.push(group.id);continue;}
      const candidates=examples.series.filter(phase=>phase.groupId===group.id),skip=(code,reason)=>skipped.push({id:group.id,code,reason});
      const missing=candidates.find(phase=>!rosterById.has(phase.person)||rosterById.get(phase.person).active===false);
      if(missing){const person=rosterById.get(missing.person);skip('person',person?(person.name||missing.person)+' er arkiveret.':'Medarbejderen '+missing.person+' findes ikke.');continue;}
      if(candidates.some(phase=>phase.site>=siteCount)){skip('site','Et arbejdssted i eksemplet findes ikke i denne virksomhed.');continue;}
      const proposed=candidates.flatMap(Engine.enumerate),internal=Engine.conflicts(proposed,proposed);
      if(internal.length){skip('overlap','Eksemplets egne vagter overlapper den '+internal[0].shift.date+'.');continue;}
      const absent=proposed.find(shift=>blockedDates.some(item=>item.person===shift.person&&item.date===shift.date));
      if(absent){skip('leave',(rosterById.get(absent.person)?.name||absent.person)+' har godkendt fravær den '+absent.date+'.');continue;}
      try{
        const errors=Lifecycle.validate([...series,...candidates]);if(errors.length){skip('invalid',errors[0]);continue;}
        const schedule=new Map(),current={...data,series};
        for(const first of new Set(proposed.map(shift=>monday(shift.date)))){
          for(const shift of Data.shiftsInRange(first,add(first,6),current)){
            const errors=Engine.validate({id:shift.id,person:shift.person||'unassigned',site:shift.site,startDate:shift.date,endDate:shift.date,weekdays:[0],start:shift.start,end:shift.end,noteRich:shift.noteRich});
            if(errors.length)throw new TypeError('Den eksisterende plan indeholder en ugyldig vagt.');schedule.set(shift.id,shift);
          }
        }
        const conflicts=Engine.conflicts(proposed,[...schedule.values()]);
        if(conflicts.length){const shift=conflicts[0].shift;skip('overlap',(rosterById.get(shift.person)?.name||shift.person)+' har allerede en overlappende vagt den '+shift.date+' kl. '+shift.start+'–'+shift.end+'.');continue;}
      }catch(error){skip('invalid',error?.message||'Den eksisterende plan kunne ikke kontrolleres.');continue;}
      series.push(...clone(candidates));added.push(group.id);candidates.forEach(phase=>ranges.push([phase.startDate,phase.endDate]));
    }
    return {series,added,existing,skipped,ranges,changed:added.length>0};
  }
  const api=Object.freeze({create,appendPlan});globalThis.CleanRoomsSeriesExamples=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
