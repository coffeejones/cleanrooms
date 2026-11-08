/* Apply repository migrations only to the portable preview's local D1 binding. */
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {getPlatformProxy} from 'wrangler';
import {configureToolEnvironment} from './tool-environment.mjs';

export async function prepareLocalSchema(){
  const root=process.cwd(),hosting=JSON.parse(await readFile(resolve(root,'.openai/hosting.json'),'utf8'));
  if(!hosting.d1)return;
  configureToolEnvironment(root);
  const directory=resolve(root,'.sites-runtime'),configPath=resolve(directory,'local-schema.wrangler.json');
  await mkdir(directory,{recursive:true});
  await writeFile(configPath,JSON.stringify({name:'cleanrooms-local-schema',compatibility_date:'2026-05-15',d1_databases:[{binding:hosting.d1,database_name:'site-creator-d1',database_id:'00000000-0000-4000-8000-000000000000',remote:false}]}));
  const proxy=await getPlatformProxy({configPath,persist:{path:resolve(root,'.wrangler/state/v3')},remoteBindings:false,envFiles:[]});
  try{
    const db=proxy.env[hosting.d1];
    await db.prepare('CREATE TABLE IF NOT EXISTS _cleanrooms_local_migrations (name TEXT PRIMARY KEY NOT NULL,hash TEXT NOT NULL)').run();
    for(const name of (await readdir(resolve(root,'drizzle'))).filter(file=>file.endsWith('.sql')).sort()){
      const source=await readFile(resolve(root,'drizzle',name),'utf8'),hash=createHash('sha256').update(source).digest('hex'),applied=await db.prepare('SELECT hash FROM _cleanrooms_local_migrations WHERE name = ?').bind(name).first();
      if(applied){if(applied.hash!==hash)throw new Error('Anvendt lokal migration er ændret: '+name);continue;}
      const statements=[];
      for(let sql of source.split('--> statement-breakpoint').map(text=>text.trim()).filter(Boolean)){
        // Older previews predate a migration journal. Existing CREATE and ADD
        // operations are recognized without rewriting or deleting their data.
        const add=sql.match(/^ALTER\s+TABLE\s+[`"]?(\w+)[`"]?\s+ADD(?:\s+COLUMN)?\s+[`"]?(\w+)[`"]?/i);
        if(add){const info=await db.prepare('PRAGMA table_info("'+add[1]+'")').all();if(info.results.some(column=>column.name===add[2]))continue;}
        sql=sql.replace(/^CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i,'CREATE TABLE IF NOT EXISTS ').replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i,(_,unique)=>'CREATE '+(unique||'')+'INDEX IF NOT EXISTS ');
        statements.push(db.prepare(sql));
      }
      statements.push(db.prepare('INSERT INTO _cleanrooms_local_migrations (name,hash) VALUES (?,?)').bind(name,hash));
      await db.batch(statements);
    }
  }finally{await proxy.dispose();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){await prepareLocalSchema();process.stdout.write('Local D1 schema is ready.\n');}
