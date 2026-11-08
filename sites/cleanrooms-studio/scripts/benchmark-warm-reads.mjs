/* Count warm server SQL work against an explicit local Git baseline.
 *
 * Usage (Node >=22.18, run from this repository):
 *   node scripts/benchmark-warm-reads.mjs <baseline-commit> [repository-path]
 * Example:
 *   node scripts/benchmark-warm-reads.mjs a1c4fe05f8e719152114809c425c2ac793ecf1ce
 *
 * Both variants use the CURRENT schema and shared model modules. This isolates
 * changes in lib/; it is not a historical whole-application compatibility test.
 * Each variant has its own synthetic fixture and in-memory SQLite database.
 * No production requests, credentials, tenant data, existing databases, source
 * changes or Git mutations are involved. Temporary module copies are removed.
 * Counts describe logical D1 batch/SQL work, not production latency or capacity.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const [baselineRef,repository=process.cwd(),...extra]=process.argv.slice(2);
if(!baselineRef||extra.length){
  console.error('Usage: node scripts/benchmark-warm-reads.mjs <baseline-commit> [repository-path]');
  process.exit(2);
}
const root=path.resolve(repository);
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
const baseline=git(['rev-parse','--verify','--end-of-options',baselineRef+'^{commit}']).trim();
const Departments=(await import(pathToFileURL(path.join(root,'src/department-model.js')))).default;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cleanrooms-warm-reads-'));

function database(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(file=>file.endsWith('.sql')).sort())
    sqlite.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8'));
  const db={sqlite,batches:[],prepare:sql=>({bind:(...values)=>({sql,values})})};
  db.batch=async statements=>{
    db.batches.push(statements);sqlite.exec('BEGIN IMMEDIATE');
    try{
      const results=statements.map(({sql,values})=>{
        const query=sqlite.prepare(sql);
        return query.columns().length?{results:query.all(...values),meta:{changes:0}}
          :{results:[],meta:{changes:Number(query.run(...values).changes)}};
      });
      sqlite.exec('COMMIT');return results;
    }catch(error){sqlite.exec('ROLLBACK');throw error;}
  };
  return db;
}

async function modules(variant){
  const dir=path.join(temp,variant);fs.mkdirSync(path.join(dir,'lib'),{recursive:true});
  fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');
  fs.symlinkSync(path.join(root,'src'),path.join(dir,'src'));
  if(variant==='baseline'){
    const files=git(['ls-tree','-r','--name-only',baseline,'--','lib']).trim().split('\n').filter(file=>file.endsWith('.mjs'));
    for(const file of files){
      const destination=path.join(dir,file);fs.mkdirSync(path.dirname(destination),{recursive:true});
      fs.writeFileSync(destination,git(['show',baseline+':./'+file]));
    }
  }else fs.cpSync(path.join(root,'lib'),path.join(dir,'lib'),{recursive:true});
  return {Store:await import(pathToFileURL(path.join(dir,'lib/studio-store.mjs'))),Workspace:await import(pathToFileURL(path.join(dir,'lib/workspace-store.mjs')))};
}

const calendar='/api/studio?projection=calendar&from=2026-11-02&to=2026-11-08&instructions=deferred';
const period={from:'2026-11-02',to:'2026-11-08'};
const selection=value=>'/api/studio?'+new URLSearchParams({projection:value.mode,selection:JSON.stringify(value)});
const request=(url,body)=>new Request('https://audit.example'+url,{
  method:body?'POST':'GET',headers:{'oai-authenticated-user-id':'audit-owner','oai-authenticated-user-email':'audit@example.com',
    ...(body?{origin:'https://audit.example','content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
});
async function successful(response){
  const value=await response.json();
  if(response.status!==200)throw new Error('Fixture request failed: '+JSON.stringify(value));
  return value;
}

try{
  for(const variant of ['baseline','current']){
    const {Store,Workspace}=await modules(variant),db=database();
    try{
      const seeded=await Store.writeStudio(db,'audit-owner',0,{storageVersion:1,demoSeed:false,calendarAnchor:'2026-10-26',organization:Departments.defaultOrganization(),series:[],edits:{},deleted:[],weekPlans:{},requests:{},checklistProgress:{},coverageRules:[]});
      if(!seeded.ok)throw new Error('Fixture initialization failed.');
      for(let warm=0;warm<2;warm++)await successful(await Workspace.handleWorkspaceStudioRequest(request(calendar),db));
      for(const [label,url,body,handler] of [
        ['calendar',calendar,null,Workspace.handleWorkspaceStudioRequest],
        ['preferences','/api/accounts',{action:'preferences',preferences:{page:'hours'}},Workspace.handleAccountsRequest],
        ['series-list',selection({mode:'series-list',calendar:period}),null,Workspace.handleWorkspaceStudioRequest],
        ['publication-review',selection({mode:'publication',...period,siteIds:[0],includeDependencies:false,calendar:period}),null,Workspace.handleWorkspaceStudioRequest]
      ]){
        db.batches=[];const response=await handler(request(url,body),db),value=await successful(response),queries=db.batches.flat();
        console.log(JSON.stringify({baseline,variant,label,status:response.status,batches:db.batches.length,statements:queries.length,
          rawLoads:queries.filter(query=>query.sql.includes('FROM studio_state_chunks')).length,responseBytes:Buffer.byteLength(JSON.stringify(value))}));
      }
    }finally{db.sqlite.close();}
  }
}finally{fs.rmSync(temp,{recursive:true,force:true});}
