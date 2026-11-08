const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Roles=require('../src/role-model.js');

test('catalog exposes exactly the eight enforced permissions and independent consumer copies',()=>{
  assert.deepEqual(Roles.PERMISSION_KEYS,['plan','departments.manage','users.manage','roles.manage','payroll.view','payroll.manage','payroll.groups.manage','chat.manage']);
  const first=Roles.catalog(),second=Roles.catalog();
  assert.deepEqual(first.map(item=>item.id),Roles.PERMISSION_KEYS);
  assert.deepEqual(first[1].requires,['plan']);
  assert.deepEqual(first[4].requires,['plan']);assert.deepEqual(first[5].requires,['plan','payroll.view']);
  assert.deepEqual(first[6].requires,['plan','payroll.view','payroll.manage']);assert.deepEqual(first[7].requires,[]);
  assert.ok(first.every(item=>item.label&&item.description));
  first[1].requires.push('users.manage');first[0].label='Changed';
  assert.deepEqual(second[1].requires,['plan']);assert.notEqual(second[0].label,'Changed');
});

test('permission lists require known unique exact keys and department management requires planning',()=>{
  for(const value of [[],['plan'],['plan','departments.manage'],['users.manage'],['roles.manage'],['users.manage','roles.manage'],['chat.manage'],['plan','chat.manage'],['plan','payroll.view'],['plan','payroll.view','payroll.manage']])assert.deepEqual(Roles.validatePermissions(value),[]);
  for(const value of [null,{},'plan',['unknown'],['Plan'],['plan','plan'],[['plan']],['departments.manage'],['users.manage','departments.manage'],['payroll.view'],['payroll.manage'],['plan','payroll.manage']]) {
    assert.ok(Roles.validatePermissions(value).length);assert.throws(()=>Roles.normalizePermissions(value),TypeError);
  }
});

test('canonical permission order never mutates frozen caller arrays',()=>{
  const input=Object.freeze(['chat.manage','payroll.groups.manage','payroll.manage','roles.manage','departments.manage','users.manage','payroll.view','plan']);
  assert.deepEqual(Roles.normalizePermissions(input),Roles.PERMISSION_KEYS);
  assert.deepEqual(input,['chat.manage','payroll.groups.manage','payroll.manage','roles.manage','departments.manage','users.manage','payroll.view','plan']);
});

test('grant attenuation never manufactures permissions from account or role management',()=>{
  assert.equal(Roles.canGrant(['users.manage'],[]),true);
  assert.equal(Roles.canGrant(['users.manage'],['users.manage']),true);
  assert.equal(Roles.canGrant(['users.manage'],['plan']),false);
  assert.equal(Roles.canGrant(['roles.manage'],['users.manage']),false);
  assert.equal(Roles.canGrant(['roles.manage'],['chat.manage']),false);
  assert.equal(Roles.canGrant(['chat.manage'],['chat.manage']),true);
  assert.equal(Roles.canGrant(['chat.manage'],['plan']),false);
  assert.equal(Roles.canGrant(['plan','users.manage','roles.manage'],['plan','payroll.view']),false);
  assert.equal(Roles.canGrant(Roles.PERMISSION_KEYS,['plan','departments.manage','roles.manage']),true);
  assert.equal(Roles.canGrant(['unknown'],[]),false);
  assert.equal(Roles.canGrant(Roles.PERMISSION_KEYS,['unknown']),false);
});

test('legacy display roles derive from effective permissions without granting authority',()=>{
  assert.deepEqual(Roles.legacy([]),{role:'employee',manageDepartments:false});
  assert.deepEqual(Roles.legacy(['users.manage']),{role:'employee',manageDepartments:false});
  assert.deepEqual(Roles.legacy(['roles.manage']),{role:'employee',manageDepartments:false});
  assert.deepEqual(Roles.legacy(['chat.manage']),{role:'employee',manageDepartments:false});
  assert.deepEqual(Roles.legacy(['plan','users.manage']),{role:'planner',manageDepartments:false});
  assert.deepEqual(Roles.legacy(['plan','departments.manage']),{role:'planner',manageDepartments:true});
  assert.deepEqual(Roles.legacy(Roles.PERMISSION_KEYS),{role:'admin',manageDepartments:true});
});

test('named roles require exact nonempty bounded names and valid permission sets',()=>{
  assert.deepEqual(Roles.validate({name:'Æ'.repeat(120),permissions:[]}),[]);
  for(const name of ['',null,' padded','padded ','bad\nname','a'.repeat(121)])assert.ok(Roles.validate({name,permissions:[]}).length);
  assert.ok(Roles.validate({name:'Manager',permissions:['users.manage','departments.manage']}).length);
});

test('the same frozen model is available in browsers without a module loader',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../src/role-model.js'),'utf8'),context);
  assert.equal(context.CleanRoomsRoles.catalog().length,8);assert.equal(context.CleanRoomsRoles.canGrant(['plan'],['plan']),true);
  assert.equal(globalThis.CleanRoomsRoles,Roles);assert.ok(Object.isFrozen(Roles));assert.ok(Object.isFrozen(Roles.PERMISSION_KEYS));
});
