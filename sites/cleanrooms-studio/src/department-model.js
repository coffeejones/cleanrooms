/* Departments link to append-only worksite indices used by existing shifts. */
(() => {
  'use strict';

  const COLORS=Object.freeze(['var(--cs-blue)','var(--cs-purple)','var(--cs-orange)']);
  const LEGACY_SITE_IDS=Object.freeze(['site-nord','site-klinik','site-havn']);
  const GPS_MIN_RADIUS_METERS=1,GPS_MAX_RADIUS_METERS=1000;
  const GPS_FIELDS=Object.freeze(['enabled','latitude','longitude','radiusMeters']);
  const WORKSITE_INFO_LIMITS=Object.freeze({contactName:120,contactPhone:80,parking:200000,accessInstructions:200000});
  const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  const identifier=value=>typeof value==='string'&&value.length>0&&value===value.trim();
  const name=value=>identifier(value)&&value.length<=120;
  const clone=value=>JSON.parse(JSON.stringify(value));
  function validateWorkHoursBudget(value) {
    if(value==null)return [];
    const roster=globalThis.CleanRoomsRoster||(typeof require==='function'?require('./roster-model.js'):null);
    return roster?.validWorkHoursBudget(value)?[]:['Timebudgettet skal have en gyldig periode og højst to decimaler.'];
  }

  function validateWorksiteInfo(value) {
    if(value==null)return [];
    if(!record(value)||Object.keys(value).some(key=>!Object.hasOwn(WORKSITE_INFO_LIMITS,key)))return ['Arbejdsstedets faste oplysninger er ugyldige.'];
    for(const [key,text]of Object.entries(value))if(typeof text!=='string'||text.length>WORKSITE_INFO_LIMITS[key]||key.startsWith('contact')&&/[\u0000-\u001f\u007f]/.test(text))return ['Arbejdsstedets kontaktoplysninger eller vejledning er ugyldige eller for lange.'];
    return [];
  }
  function normalizeWorksiteInfo(value) {
    const errors=validateWorksiteInfo(value);if(errors.length)throw new TypeError(errors[0]);
    const fields=Object.entries(value||{}).map(([key,text])=>[key,text.trim()]).filter(([,text])=>text);return fields.length?Object.fromEntries(fields):null;
  }

  function defaultGps() {
    return {enabled:false,latitude:null,longitude:null,radiusMeters:150};
  }

  function validateGps(gps) {
    if(gps==null)return [];
    if(!record(gps)||Object.keys(gps).some(key=>key!=='address'&&!GPS_FIELDS.includes(key))||GPS_FIELDS.some(key=>!Object.hasOwn(gps,key))||typeof gps.enabled!=='boolean')
      return ['Arbejdsstedets GPS-indstillinger er ugyldige.'];
    const {latitude,longitude,radiusMeters,address}=gps;
    const hasLocation=Number.isFinite(latitude)&&Math.abs(latitude)<=90&&Number.isFinite(longitude)&&Math.abs(longitude)<=180;
    if(!hasLocation&&(gps.enabled||latitude!==null||longitude!==null))
      return ['Angiv en breddegrad mellem −90 og 90 og en længdegrad mellem −180 og 180.'];
    if(Object.hasOwn(gps,'address')&&(!hasLocation||!identifier(address)||address.length>500))
      return ['GPS-adressen skal være en gyldig adresse på højst 500 tegn.'];
    if(!Number.isInteger(radiusMeters)||radiusMeters<GPS_MIN_RADIUS_METERS||radiusMeters>GPS_MAX_RADIUS_METERS)
      return ['GPS-radius skal være et helt antal meter mellem '+GPS_MIN_RADIUS_METERS+' og '+GPS_MAX_RADIUS_METERS+'.'];
    return [];
  }

  function normalizeGps(gps) {
    const errors=validateGps(gps);
    if(errors.length)throw new TypeError(errors[0]);
    return gps==null?defaultGps():clone(gps);
  }

  function defaultOrganization() {
    return {version:1,sites:[
      {id:'site-nord',name:'Kontor Nord',address:'Nordvej 12 · 8000 Aarhus C',color:COLORS[0]},
      {id:'site-klinik',name:'Klinikken',address:'Park Allé 8 · 8000 Aarhus C',color:COLORS[1]},
      {id:'site-havn',name:'Havnegade',address:'Havnegade 24 · 8000 Aarhus C',color:COLORS[2]}
    ],departments:[
      {id:'dep-nord',name:'Kontor Nord',kind:'branch',siteIds:[0]},
      {id:'dep-klinik',name:'Klinikken',kind:'customer',siteIds:[1]},
      {id:'dep-havn',name:'Havnegade',kind:'customer',siteIds:[2]}
    ]};
  }

  function validate(organization) {
    if (!record(organization)) return ['Organisationen skal være et gyldigt objekt.'];
    const errors=[],ids=new Set();
    if (organization.version!==1) errors.push('Organisationens version skal være 1.');
    if (!Array.isArray(organization.sites)||organization.sites.length===0) errors.push('Organisationen skal indeholde arbejdssteder.');
    else {
      if (organization.sites.length>2000) errors.push('Organisationen må højst have 2000 arbejdssteder.');
      LEGACY_SITE_IDS.forEach((id,index)=>{if(organization.sites[index]?.id!==id)errors.push('De tre oprindelige arbejdssteder skal bevares på deres faste pladser.');});
      organization.sites.forEach(site=>{
        if (!record(site)) { errors.push('Et arbejdssted er ugyldigt.');return; }
        if (!identifier(site.id)) errors.push('Hvert arbejdssted skal have et stabilt id uden ydre mellemrum.');
        else if (ids.has(site.id)) errors.push('Id forekommer flere gange: '+site.id);else ids.add(site.id);
        if (!name(site.name)) errors.push('Arbejdsstedets navn skal være udfyldt uden ydre mellemrum og højst være 120 tegn.');
        if (typeof site.address!=='string'||site.address.length>500) errors.push('Arbejdsstedets adresse skal være tekst på højst 500 tegn.');
        if (!COLORS.includes(site.color)) errors.push('Vælg en af de tilladte farver til arbejdsstedet.');
        errors.push(...validateGps(site.gps));
        errors.push(...validateWorksiteInfo(site.worksiteInfo));
        errors.push(...validateWorkHoursBudget(site.workHoursBudget));
      });
    }
    if (!Array.isArray(organization.departments)) errors.push('Afdelinger skal være en liste.');
    else {
      if (organization.departments.length>1000) errors.push('Organisationen må højst have 1000 afdelinger.');
      organization.departments.forEach(department=>{
        if (!record(department)) { errors.push('En afdeling er ugyldig.');return; }
        if (!identifier(department.id)) errors.push('Hver afdeling skal have et stabilt id uden ydre mellemrum.');
        else if (ids.has(department.id)) errors.push('Id forekommer flere gange: '+department.id);else ids.add(department.id);
        if (!name(department.name)) errors.push('Afdelingens navn skal være udfyldt uden ydre mellemrum og højst være 120 tegn.');
        if (!['branch','customer'].includes(department.kind)) errors.push('Vælg afdeling eller kunde som type.');
        errors.push(...validateWorkHoursBudget(department.workHoursBudget));
        if (!Array.isArray(department.siteIds)) errors.push('Afdelingens arbejdssteder skal være en liste.');
        else {
          if (new Set(department.siteIds).size!==department.siteIds.length) errors.push('Et arbejdssted må kun vælges én gang i samme afdeling.');
          if (department.siteIds.some(index=>!Number.isInteger(index)||index<0||!Array.isArray(organization.sites)||index>=organization.sites.length)) errors.push('Afdelingen henviser til et ugyldigt arbejdssted.');
        }
      });
    }
    return errors;
  }

  function normalize(organization) {
    if (organization===undefined) return defaultOrganization();
    const errors=validate(organization);
    if (errors.length) throw new TypeError(errors.join(' '));
    return clone(organization);
  }

  function propose(organization,draft) {
    const failure=error=>({ok:false,organization:null,department:null,error});
    let next;
    try { next=normalize(organization); } catch (error) { return failure(error.message); }
    if (!record(draft)||!identifier(draft.id)||typeof draft.create!=='boolean') return failure('Vælg et stabilt afdelings-id og om afdelingen skal oprettes eller redigeres.');
    const index=next.departments.findIndex(department=>department.id===draft.id);
    if (draft.create&&index>=0) return failure('Afdelingens id findes allerede.');
    if (!draft.create&&index<0) return failure('Afdelingen findes ikke længere. Åbn oversigten igen.');
    const department={...(index>=0?next.departments[index]:{}),id:draft.id,name:draft.name,kind:draft.kind,siteIds:Array.isArray(draft.siteIds)?[...draft.siteIds]:draft.siteIds};
    if(draft.workHoursBudget!==undefined)department.workHoursBudget=clone(draft.workHoursBudget);
    if (index>=0) next.departments[index]=department;else next.departments.push(department);
    const draftErrors=validate(next);if(draftErrors.length)return failure(draftErrors[0]);
    if (draft.newSite!==undefined) {
      if (!record(draft.newSite)) return failure('Det nye arbejdssted er ugyldigt.');
      const gpsErrors=validateGps(draft.newSite.gps);if(gpsErrors.length)return failure(gpsErrors[0]);
      const siteIndex=next.sites.length;
      next.sites.push({id:draft.newSite.id===undefined?'site-'+draft.id+'-'+siteIndex:draft.newSite.id,
        name:draft.newSite.name,address:draft.newSite.address,color:draft.newSite.color===undefined?COLORS[siteIndex%COLORS.length]:draft.newSite.color,
        ...(draft.newSite.gps!==undefined?{gps:clone(draft.newSite.gps)}:{}),
        ...(draft.newSite.workHoursBudget!==undefined?{workHoursBudget:clone(draft.newSite.workHoursBudget)}:{}),
        ...(draft.newSite.worksiteInfo!==undefined?{worksiteInfo:normalizeWorksiteInfo(draft.newSite.worksiteInfo)}:{})});
      department.siteIds.push(siteIndex);
    }
    const errors=validate(next);if(errors.length)return failure(errors[0]);
    return {ok:true,organization:next,department:clone(department),error:null};
  }

  const api=Object.freeze({COLORS,LEGACY_SITE_IDS,GPS_MIN_RADIUS_METERS,GPS_MAX_RADIUS_METERS,defaultGps,validateGps,normalizeGps,WORKSITE_INFO_LIMITS,validateWorksiteInfo,normalizeWorksiteInfo,validateWorkHoursBudget,defaultOrganization,validate,normalize,propose});
  globalThis.CleanRoomsDepartments=api;
  if (typeof module!=='undefined'&&module.exports) module.exports=api;
})();
