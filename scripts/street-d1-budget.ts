import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BudgetD1 } from '../tests/helpers/d1Budget.ts';
import { seedNetwork } from '../tests/helpers/networkD1.ts';
const root=process.env.STREET_ENGINE_MODULE_ROOT??process.cwd();
const moduleAt=(path:string)=>import(pathToFileURL(resolve(root,path)).href);
const {prepareAreaTasks}=await moduleAt('worker/areaTaskPreparation.ts');
const {loadCampaignSnapshot}=await moduleAt('worker/campaignRepository.ts');
const {handleRxdbPush}=await moduleAt('worker/rxdbSync.ts');
const {handleNetworkIntent}=await moduleAt('worker/streetNetwork/api.ts');
const access={campaignId:'campaign_n',role:'admin',teamId:null,label:null,grantId:'test'};
const output:{variant:string;measurements:unknown[]}={variant:root,measurements:[]};
for(const count of [400,1000,5000,10000]){
  const db=new BudgetD1(process.env.STREET_BASE_CHUNKS==='1',process.env.STREET_FULL_SCHEMA==='1');seedNetwork(db);
  const roads=Array.from({length:20},(_,i)=>({type:'way',id:10+i,tags:{highway:'residential',name:`Road ${i}`},geometry:[{lon:13.0001+i*0.00049,lat:51.0001},{lon:13.0001+i*0.00049,lat:51.0099}]}));
  const buildings=Array.from({length:count},(_,i)=>{
    const x=13.00015+(i%20)*0.00049,y=51.00015+Math.floor(i/20)*0.000019;
    return {type:'way',id:1000+i,tags:{building:'house','addr:street':`Road ${i%20}`,'addr:housenumber':String(Math.floor(i/20)+1)},geometry:[{lon:x,lat:y},{lon:x+0.00003,lat:y},{lon:x+0.00003,lat:y+0.00003},{lon:x,lat:y}]};
  });
  const options={fetchImpl:async(_url:unknown,init:RequestInit)=>new Response(JSON.stringify({osm3s:{timestamp_osm_base:'2026-09-07T00:00:00Z'},elements:String(init?.body).includes('highway')?roads:buildings}))};
  const capture=(action:string,start:number,status:unknown)=>{
    const report=db.report();const row={action,houses:count,streets:20,elapsedMs:performance.now()-start,status,...report};output.measurements.push(row);
    console.log(JSON.stringify({action,houses:count,status,elapsedMs:row.elapsedMs,statements:report.statements,batches:report.batches,maxBatch:report.maxStatementsPerBatch,rowsWritten:report.tableRowsWritten,indexEstimate:report.estimatedIndexRowsWritten,totalEstimate:report.estimatedTotalRowsWritten,readEstimate:report.estimatedRowsRead}));
  };
  db.resetBudget();let start=performance.now();const preparation=await prepareAreaTasks(db,'campaign_n','area_n',options);capture('preparation',start,preparation.outcome);
  if(preparation.outcome!=='ready')continue;
  let snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
  const house=snapshot.houseTasks[0];
  db.resetBudget();start=performance.now();
  const status=await handleRxdbPush(db,'campaign_n','houseTasks',access,{rows:[{assumedMasterState:house,newDocumentState:{...house,status:'later',updatedAt:new Date().toISOString()}}]});capture('house-status',start,{http:status.status,body:await status.json()});
  snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;const street=snapshot.tasks[0];
  db.resetBudget();start=performance.now();
  const intent={id:'network_budget',areaId:'area_n',generation:street.areaPreparationGeneration,start:{point:street.geometry.coordinates[0],taskId:street.id},end:{point:street.geometry.coordinates.at(-1),taskId:street.id},selectedPath:[street.id],status:'completed'};
  const marking=await handleNetworkIntent(new Request('https://example.test/network',{method:'POST',body:JSON.stringify(intent)}),db,'campaign_n',access);capture('smart-mark',start,marking.status);
  snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;const area=snapshot.areas[0];
  db.resetBudget();start=performance.now();
  const deletion=await handleRxdbPush(db,'campaign_n','areas',access,{rows:[{assumedMasterState:area,newDocumentState:{...area,_deleted:true}}]});capture('delete',start,deletion.status);
  db.sqlite.close();
}
writeFileSync(process.env.D1_BUDGET_OUTPUT??resolve(root,'d1-budget.json'),JSON.stringify(output,null,2)+'\n');
