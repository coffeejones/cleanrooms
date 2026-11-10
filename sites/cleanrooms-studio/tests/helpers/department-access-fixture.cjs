/* Real-handler fixture shared by cross-department integration tests. */
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const testDir=path.resolve(__dirname,'..'),requireTest=createRequire(path.join(testDir,'workspace-access.test.cjs'));
const source=fs.readFileSync(path.join(testDir,'workspace-access.test.cjs'),'utf8');
const F=new Function('require','__dirname',source.slice(0,source.indexOf("test('"))+'\nreturn {database,owner,studio,json,accounts,route,bootstrap,join};')(requireTest,testDir);
const Time=require('../../src/timekeeping-model.js'),Publication=require('../../src/publication-model.js');
async function createDepartmentAccessFixture(t,{roleId='admin',departmentIds=['dep-nord'],studio:given}={}){
 const db=F.database();t?.after?.(()=>db.sqlite.close());const owner=F.owner,scopedPlanner={id:'department-manager',email:'manager@example.test'},allowedPerson={id:'p0',name:'Allowed Freja',initials:'AF',site:0,target:37,role:'Service',active:true},foreignPerson={id:'p1',name:'FOREIGN SECRET MARTIN',initials:'FM',site:1,target:37,role:'Service',active:true},third={id:'p2',name:'FOREIGN SECRET LIV',initials:'FL',site:2,target:37,role:'Service',active:true};
 const date=Time.addDays(Time.localNow().date,-1),from=Time.addDays(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7)),range={from,to:Time.addDays(from,6)},shift=(id,person)=>({id,person:person.id,date,site:person.site,start:'07:00',end:'08:00',plannedBreakMinutes:0,note:'Instructions '+person.name}),allowedShift=shift('department-allowed-shift',allowedPerson),foreignShift=shift('department-foreign-shift',foreignPerson);
 const initial=given??Publication.publish(F.studio({demoSeed:false,roster:[allowedPerson,foreignPerson,third],edits:{[allowedShift.id]:allowedShift,[foreignShift.id]:foreignShift}}),{...range,siteIds:[0,1,2],includeDependencies:true,actor:{userId:owner.id,name:'Owner'},at:new Date().toISOString()}).studio;
 const bootstrap=await F.bootstrap(db,owner,initial);await F.join(db,scopedPlanner,{roleId,accessScope:{mode:'departments',departmentIds}});
 return {db,sqlite:db.sqlite,owner,scopedPlanner,allowedPerson,foreignPerson,allowedShift,foreignShift,date,range,workspaceId:bootstrap.workspace.id,bootstrap,
  account:async(action,payload={},user=owner)=>F.json(await F.accounts(db,{action,...payload},user)),
  plan:async(method='GET',body,user=owner,url='/api/studio')=>F.json(await (url==='/api/studio'?F.route(db,method,body,user):WorkspaceRoute(url,method,body,user))),
  close:()=>db.sqlite.close()};
 function WorkspaceRoute(url,method,body,user){const Workspace=require('../../lib/workspace-store.mjs');return Workspace.handleWorkspaceStudioRequest(new Request('https://cleanrooms.example'+url,{method,headers:{'oai-authenticated-user-id':user.id,'oai-authenticated-user-email':user.email,...(method!=='GET'?{origin:'https://cleanrooms.example','content-type':'application/json'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),db);}
}
module.exports={createDepartmentAccessFixture};
