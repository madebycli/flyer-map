import { getHeapStatistics } from 'node:v8';
import { BudgetD1 } from '../tests/helpers/d1Budget.ts';
import { seedNetwork, networkOsm } from '../tests/helpers/networkD1.ts';
import { beginAreaTaskPreparation, runAreaTaskPreparation, prepareAreaTasks } from '../worker/areaTaskPreparation.ts';
import { handleRxdbPush } from '../worker/rxdbSync.ts';
import { requestDatabase } from '../worker/requestDatabase.ts';

// Synthetic, offline audit only. Never uses a network provider or remote D1.
for (const count of [0,399,1000,5000,10000,20000]) {
  const db=new BudgetD1(true,true);seedNetwork(db);
  const tileCount=count>10000?2:1;
  if(tileCount===2)db.sqlite.prepare('UPDATE areas SET geometry_json=?').run(JSON.stringify({type:'Polygon',coordinates:[[[13,51],[13.02,51],[13.02,51.01],[13,51.01],[13,51]]]}));
  let edgeReads=0,edgeBytes=0,requests=0,sourceBytes=0,maxStatements=0,totalStatements=0,returnedRows=0,estimatedReads=0,writes=0,steps=0;
  const originalPrepare=db.prepare.bind(db);
  db.prepare=(query:string)=>{
    const statement=originalPrepare(query),all=statement.all.bind(statement);
    statement.all=async<T>()=>{const result=await all<T>();if(query.includes('FROM street_network_staging')&&statement.values.includes('edges')){edgeReads++;edgeBytes+=result.results.reduce((n,row)=>n+Buffer.byteLength(String((row as any).payload_json)),0);}return result;};return statement;
  };
  const fetchImpl=async(_input:unknown,init?:RequestInit)=>{
    requests++;const query=new URLSearchParams(String(init?.body)).get('data')!;
    const tile=query.includes('(51,13.01,')?1:0,base=13+tile*0.01;
    const roads=Array.from({length:20},(_,i)=>({type:'way',id:tile*100+10+i,tags:{highway:'residential',name:`Road ${tile}-${i}`},geometry:[{lon:base+0.0001+i*0.00049,lat:51.0001},{lon:base+0.0001+i*0.00049,lat:51.0099}]}));
    const buildings=Array.from({length:Math.min(10000,count-tile*10000)},(_,i)=>{const x=base+0.00015+(i%20)*0.00049,y=51.00015+Math.floor(i/20)*0.000019;return {type:'way',id:1000+tile*10000+i,tags:{building:'house','addr:street':`Road ${tile}-${i%20}`,'addr:housenumber':String(Math.floor(i/20)+1)},geometry:[{lon:x,lat:y},{lon:x+0.00003,lat:y},{lon:x+0.00003,lat:y+0.00003},{lon:x,lat:y}]};});
    const text=JSON.stringify({osm3s:{timestamp_osm_base:'2026-09-07T00:00:00Z'},elements:query.includes('highway')?roads:buildings});sourceBytes+=Buffer.byteLength(text);return new Response(text);
  };
  db.resetBudget();const started=await beginAreaTaskPreparation(requestDatabase(db,50),'campaign_n','area_n');
  if(started.outcome!=='run')throw new Error('audit_start_failed');
  let result:any;const start=performance.now(),cpu=process.cpuUsage();let heap=getHeapStatistics().used_heap_size;
  do {db.resetBudget();result=await runAreaTaskPreparation(requestDatabase(db,50),started.run,{fetchImpl});const report=db.report();maxStatements=Math.max(maxStatements,report.statements);totalStatements+=report.statements;returnedRows+=report.returnedRows;estimatedReads+=report.estimatedRowsRead;writes+=report.estimatedTotalRowsWritten;heap=Math.max(heap,getHeapStatistics().used_heap_size);steps++;}while(result.outcome==='pending'&&steps<200);
  const used=process.cpuUsage(cpu),job=db.sqlite.prepare('SELECT phase,cursor,error_code,metrics_json FROM street_network_jobs').get() as any;
  console.log(JSON.stringify({scenario:'scale',houses:count,tiles:tileCount,result,phase:job.phase,cursor:job.cursor,errorCode:job.error_code,steps,maxStatements,totalStatements,returnedRows,estimatedReads,writes,requests,sourceBytes,edgeReads,edgeBytes,wallMs:Math.round(performance.now()-start),nodeCpuMs:(used.user+used.system)/1000,sampledProcessHeapBytes:heap,note:'SQLite estimates and process observations, excludes begin, not Worker CPU or Cloudflare billing; phase loop, not DO alarm overhead'}));db.sqlite.close();
}
for(const shape of ['all-open','null-node','empty']){
  const db=new BudgetD1(true,true);seedNetwork(db);
  const result=await prepareAreaTasks(db,'campaign_n','area_n',{now:()=>new Date(Date.now()+60000),fetchImpl:async(_input,init)=>{
    if(!new URLSearchParams(String(init?.body)).get('data')!.includes('building'))return networkOsm();
    return Response.json({elements:shape==='empty'?[]:[{type:'way',id:999,tags:{building:'house','addr:housenumber':'1'},geometry:shape==='null-node'?[null,null,null,null]:[{lon:13.001,lat:51.001},{lon:13.002,lat:51.002}]}]});
  }});
  console.log(JSON.stringify({scenario:shape,result,job:db.sqlite.prepare('SELECT phase,cursor,error_code,metrics_json FROM street_network_jobs').get()}));db.sqlite.close();
}
