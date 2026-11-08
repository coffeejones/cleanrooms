#!/usr/bin/env node
/* Compare legacy series-list collection with the catalog-only protocol.
 * Usage: node scripts/benchmark-series-catalog.mjs [20,100]
 *
 * Uses synthetic annual recurrence/publication fixtures from benchmark-fixtures,
 * current migrated local SQLite databases, and actual request/authorization SQL.
 * There are no production requests, credentials, tenant data or source writes.
 * Both variants run current code; the unflagged request is the legacy baseline.
 * Each variant is warmed before measurement. Counts are not latency/capacity
 * estimates, and SQL result bytes do not represent engine rows scanned/billed.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname,resolve } from 'node:path';
import { database,seed,routes,PERIOD,CLOCK } from './benchmark-fixtures.mjs';

const counts=(process.argv[2]||'20,100').split(',').map(Number);
assert.ok(process.argv.length<=3&&counts.length&&counts.every(value=>Number.isInteger(value)&&value>=2&&value<=500),'Usage: node scripts/benchmark-series-catalog.mjs [20,100] (2–500 staff per fixture)');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),OriginalDate=globalThis.Date;
globalThis.Date=class extends OriginalDate{constructor(...values){super(...(values.length?values:[CLOCK]));}static now(){return OriginalDate.parse(CLOCK);}};
try{
  const modules={Store:await import('../lib/studio-store.mjs'),Workspace:await import('../lib/workspace-store.mjs'),PublicationStore:await import('../lib/publication-store.mjs'),Departments:require('../src/department-model.js'),Publication:require('../src/publication-model.js'),Series:require('../src/series-engine.js'),Workflow:require('../src/shift-workflow-model.js'),Checklist:require('../src/checklist-progress.js')};
  for(const staff of counts){
    const db=await database(root);
    try{
      const fixture=await seed(db,modules,staff),api=routes(db,modules.Workspace),calendar={from:PERIOD.from,to:'2026-12-13'};
      for(const catalogOnly of [false,true]){
        const projection={mode:'series-list',calendar,...(catalogOnly?{catalogOnly:true}:{})};
        const collect=async()=>{
          let cursor=null,pages=0,payloadBytes=0,catalogRows=0;const rowKinds={records:0,publication:0,availability:0,absence:0};
          do{
            const page=await api('studio',{query:{projection:projection.mode,selection:JSON.stringify(projection),instructions:'deferred',...(cursor?{cursor}:{})}});
            assert.equal(page.status,200,JSON.stringify(page.body));pages++;assert.ok(pages<=1000);payloadBytes+=page.payloadBytes;
            rowKinds.records+=page.body.records.length;rowKinds.publication+=page.body.publicationRows.length;
            for(const row of page.body.auxRows){if(row.kind==='catalog')catalogRows++;else if(row.kind in rowKinds)rowKinds[row.kind]++;}
            if(catalogOnly){assert.deepEqual(page.body.records,[]);assert.deepEqual(page.body.publicationRows,[]);assert.deepEqual(page.body.planning.versions,{});assert.ok(page.body.auxRows.every(row=>row.kind==='catalog'));}
            cursor=page.body.nextCursor;
          }while(cursor);
          return {pages,payloadBytes,catalogRows,rowKinds};
        };
        await collect();db.reset();const result=await collect();assert.equal(db.stats.writeStatements,0,'Warm reads must not rewrite migrated fixture data.');
        assert.equal(result.catalogRows,fixture.series,'Every recurrence template remains available.');
        console.log(JSON.stringify({protocol:catalogOnly?'catalog-only':'legacy',staff,series:fixture.series,publishedShifts:fixture.publishedShifts,backgroundCalendar:calendar,...result,...db.stats}));
      }
    }finally{await db.close();}
  }
}finally{globalThis.Date=OriginalDate;}
