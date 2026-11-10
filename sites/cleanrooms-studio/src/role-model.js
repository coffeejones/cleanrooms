/* The UI and server share only permissions that the backend actually enforces. */
(() => {
  'use strict';
  const PERMISSION_KEYS=Object.freeze(['plan','departments.manage','users.manage','roles.manage','payroll.view','payroll.manage','payroll.groups.manage','chat.manage']);
  const CATALOG=Object.freeze([
    Object.freeze({id:'plan',label:'Planlæg vagter',description:'Se og redigér vagtplanen i de afdelinger, du har adgang til.',requires:Object.freeze([])}),
    Object.freeze({id:'departments.manage',label:'Administrér afdelinger',description:'Opret og redigér afdelinger og arbejdssteder.',requires:Object.freeze(['plan'])}),
    Object.freeze({id:'users.manage',label:'Administrér konti',description:'Invitér brugere og administrér kontoadgang inden for dine egne rettigheder.',requires:Object.freeze([])}),
    Object.freeze({id:'roles.manage',label:'Administrér roller',description:'Opret og redigér roller inden for dine egne rettigheder.',requires:Object.freeze([])}),
    Object.freeze({id:'payroll.view',label:'Se løn og tillæg',description:'Se medarbejdernes lønaftaler og planlagte løn.',requires:Object.freeze(['plan'])}),
    Object.freeze({id:'payroll.manage',label:'Administrér løn og tillæg',description:'Opret og redigér medarbejdernes lønaftaler og tillæg.',requires:Object.freeze(['plan','payroll.view'])}),
    Object.freeze({id:'payroll.groups.manage',label:'Administrér løngrupper',description:'Administrér fælles løngrupper og tilknytninger med virkning for flere medarbejdere.',requires:Object.freeze(['plan','payroll.view','payroll.manage'])}),
    Object.freeze({id:'chat.manage',label:'Administrer chatrum',description:'Se de afdelingsrum, du har adgang til, opret og rediger rum og fastgør beskeder.',requires:Object.freeze([])})
  ]);
  function validatePermissions(value) {
    if(!Array.isArray(value))return ['Rettigheder skal være en liste.'];
    const errors=[];
    if(value.some(key=>typeof key!=='string'||!PERMISSION_KEYS.includes(key)))errors.push('Rollen indeholder en ukendt rettighed.');
    if(new Set(value).size!==value.length)errors.push('En rettighed må kun vælges én gang.');
    if(value.includes('departments.manage')&&!value.includes('plan'))errors.push('Administration af afdelinger kræver adgang til vagtplanen.');
    if(value.includes('payroll.view')&&!value.includes('plan'))errors.push('Adgang til løn kræver adgang til vagtplanen.');
    if(value.includes('payroll.manage')&&(!value.includes('plan')||!value.includes('payroll.view')))errors.push('Administration af løn kræver adgang til vagtplanen og læseadgang til løn.');
    if(value.includes('payroll.groups.manage')&&(!value.includes('plan')||!value.includes('payroll.view')||!value.includes('payroll.manage')))errors.push('Administration af løngrupper kræver adgang til vagtplanen samt læse- og skriveadgang til løn.');
    return errors;
  }
  function normalizePermissions(value) {
    const errors=validatePermissions(value);if(errors.length)throw new TypeError(errors.join(' '));
    return PERMISSION_KEYS.filter(key=>value.includes(key));
  }
  function validate(value) {
    if(!value||typeof value!=='object'||Array.isArray(value))return ['Rollen er ugyldig.'];
    const errors=validatePermissions(value.permissions);
    if(typeof value.name!=='string'||!value.name||value.name!==value.name.trim()||value.name.length>120||/[\u0000-\u001f\u007f]/.test(value.name))errors.unshift('Rollens navn skal være udfyldt uden ydre mellemrum og højst være 120 tegn.');
    return errors;
  }
  function canGrant(actor,target) {return !validatePermissions(actor).length&&!validatePermissions(target).length&&target.every(key=>actor.includes(key));}
  function legacy(value) {
    const permissions=normalizePermissions(value);
    return {role:PERMISSION_KEYS.every(key=>permissions.includes(key))?'admin':permissions.includes('plan')?'planner':'employee',manageDepartments:permissions.includes('departments.manage')};
  }
  const api=Object.freeze({PERMISSION_KEYS,catalog:()=>CATALOG.map(item=>({...item,requires:[...item.requires]})),validatePermissions,normalizePermissions,validate,canGrant,legacy});
  globalThis.CleanRoomsRoles=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
