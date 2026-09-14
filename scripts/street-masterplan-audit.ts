import { getHeapStatistics } from 'node:v8';
import { BudgetD1 } from '../tests/helpers/d1Budget.ts';
import { seedNetwork, networkOsm } from '../tests/helpers/networkD1.ts';
import { beginAreaTaskPreparation, runAreaTaskPreparation, prepareAreaTasks } from '../worker/areaTaskPreparation.ts';
import { requestDatabase } from '../worker/requestDatabase.ts';

function queryClass(sql:string) {
  const flat=sql.replace(/\s+/g,' ').trim();
  const pragma=/^PRAGMA table_info\(([^)]+)\)/i.exec(flat);if(pragma)return `pragma:${pragma[1]}`;
  const insert=/^INSERT(?: OR \w+)? INTO ([A-Za-z_][\w]*)/i.exec(flat);if(insert)return `insert:${insert[1]}`;
  const update=/^UPDATE ([A-Za-z_][\w]*)/i.exec(flat);if(update)return `update:${update[1]}`;
  const del=/^DELETE FROM ([A-Za-z_][\w]*)/i.exec(flat);if(del)return `delete:${del[1]}`;
  const from=/\bFROM ([A-Za-z_][\w]*)/i.exec(flat);if(from)return `select:${from[1]}`;
  return flat.slice(0,80);
}

// Synthetic, offline audit only. Never uses a network provider or remote D1.
for (const count of [0,399,1000,5000,10000,20000]) {
  const db=new BudgetD1(true,true);seedNetwork(db);
  const tileCount=count>10000?2:1;
  const queryBudget=50;
  if(tileCount===2)db.sqlite.prepare('UPDATE areas SET geometry_json=?').run(JSON.stringify({type:'Polygon',coordinates:[[[13,51],[13.02,51],[13.02,51.01],[13,51.01],[13,51]]]}));
  let fullEdgeReads=0,fullEdgeBytes=0,indexedEdgeReads=0,indexedEdgeBytes=0,requests=0,sourceBytes=0,maxStatements=0,maxStatementPhase='unknown',totalStatements=0,returnedRows=0,estimatedReads=0,writes=0,steps=0,activePhase='outside';
  const maxStatementsByPhase:Record<string,number>={};
  const queryClassesByPhase:Record<string,Record<string,number>>={};
  const originalObserve=db.observe.bind(db);
  db.observe=(query:string,values:unknown[])=>{
    const phase=queryClassesByPhase[activePhase]??={};const key=queryClass(query);phase[key]=(phase[key]??0)+1;queryClassesByPhase[activePhase]=phase;
    originalObserve(query,values);
  };
  const originalPrepare=db.prepare.bind(db);
  db.prepare=(query:string)=>{
    const statement=originalPrepare(query),all=statement.all.bind(statement);
    statement.all=async<T>()=>{const result=await all<T>();if(query.includes('FROM street_network_staging')){const bytes=result.results.reduce((n,row)=>n+Buffer.byteLength(String((row as any).payload_json??'')),0);if(statement.values.includes('edges')){fullEdgeReads++;fullEdgeBytes+=bytes;}if(statement.values.includes('edge-label-buckets')){indexedEdgeReads++;indexedEdgeBytes+=bytes;}}return result;};return statement;
  };
  const fetchImpl=async(_input:unknown,init?:RequestInit)=>{
    requests++;const query=new URLSearchParams(String(init?.body)).get('data')!;
    const tile=query.includes('(51,13.01,')?1:0,base=13+tile*0.01;
    const roads=Array.from({length:20},(_,i)=>({type:'way',id:tile*100+10+i,tags:{highway:'residential',name:`Road ${tile}-${i}`},geometry:[{lon:base+0.0001+i*0.00049,lat:51.0001},{lon:base+0.0001+i*0.00049,lat:51.0099}]}));
    const buildings=Array.from({length:Math.min(10000,count-tile*10000)},(_,i)=>{const x=base+0.00015+(i%20)*0.00049,y=51.00015+Math.floor(i/20)*0.000019;return {type:'way',id:1000+tile*10000+i,tags:{building:'house','addr:street':`Road ${tile}-${i%20}`,'addr:housenumber':String(Math.floor(i/20)+1)},geometry:[{lon:x,lat:y},{lon:x+0.00003,lat:y},{lon:x+0.00003,lat:y+0.00003},{lon:x,lat:y}]};});
    const text=JSON.stringify({osm3s:{timestamp_osm_base:'2026-09-07T00:00:00Z'},elements:query.includes('highway')?roads:buildings});sourceBytes+=Buffer.byteLength(text);return new Response(text);
  };
  db.resetBudget();const started=await beginAreaTaskPreparation(requestDatabase(db,queryBudget),'campaign_n','area_n');
  if(started.outcome!=='run')throw new Error('audit_start_failed');
  let result:any;const start=performance.now(),cpu=process.cpuUsage();let heap=getHeapStatistics().used_heap_size;
  do {
    const beforeJob=db.sqlite.prepare('SELECT phase FROM street_network_jobs').get() as {phase?:string}|undefined;
    const phase=beforeJob?.phase??'start';activePhase=phase;
    db.resetBudget();result=await runAreaTaskPreparation(requestDatabase(db,queryBudget),started.run,{fetchImpl});const report=db.report();
    maxStatementsByPhase[phase]=Math.max(maxStatementsByPhase[phase]??0,report.statements);
    if(report.statements>maxStatements){maxStatements=report.statements;maxStatementPhase=phase;}
    totalStatements+=report.statements;returnedRows+=report.returnedRows;estimatedReads+=report.estimatedRowsRead;writes+=report.estimatedTotalRowsWritten;heap=Math.max(heap,getHeapStatistics().used_heap_size);steps++;
  }while(result.outcome==='pending'&&steps<300);
  activePhase='outside';
  const used=process.cpuUsage(cpu),job=db.sqlite.prepare('SELECT phase,cursor,error_code,metrics_json FROM street_network_jobs').get() as any;
  console.log(JSON.stringify({scenario:'scale',houses:count,tiles:tileCount,queryBudget,result,phase:job.phase,cursor:job.cursor,errorCode:job.error_code,steps,maxStatements,maxStatementPhase,maxStatementsByPhase,...(count===20000?{maxPhaseQueryClasses:queryClassesByPhase[maxStatementPhase]}:{}),totalStatements,returnedRows,estimatedReads,writes,requests,sourceBytes,edgeReads:fullEdgeReads,edgeBytes:fullEdgeBytes,fullEdgeReads,fullEdgeBytes,indexedEdgeReads,indexedEdgeBytes,wallMs:Math.round(performance.now()-start),nodeCpuMs:(used.user+used.system)/1000,sampledProcessHeapBytes:heap,note:'SQLite estimates and process observations, excludes begin, not Worker CPU or Cloudflare billing; fullEdge* is complete staged edge payload, indexedEdge* is bounded label-bucket payload'}));db.sqlite.close();
}
for(const shape of ['all-open','null-node','empty']){
  const db=new BudgetD1(true,true);seedNetwork(db);
  const result=await prepareAreaTasks(db,'campaign_n','area_n',{now:()=>new Date(Date.now()+60000),fetchImpl:async(_input,init)=>{
    if(!new URLSearchParams(String(init?.body)).get('data')!.includes('building'))return networkOsm();
    return Response.json({elements:shape==='empty'?[]:[{type:'way',id:999,tags:{building:'house','addr:housenumber':'1'},geometry:shape==='null-node'?[null,null,null,null]:[{lon:13.001,lat:51.001},{lon:13.002,lat:51.002}]}]});
  }});
  console.log(JSON.stringify({scenario:shape,result,job:db.sqlite.prepare('SELECT phase,cursor,error_code,metrics_json FROM street_network_jobs').get()}));db.sqlite.close();
}
