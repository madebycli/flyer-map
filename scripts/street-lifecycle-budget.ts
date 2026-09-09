import { writeFileSync } from 'node:fs';
import { BudgetD1 } from '../tests/helpers/d1Budget.ts';
import { seedNetwork } from '../tests/helpers/networkD1.ts';
import { prepareAreaTasks } from '../worker/areaTaskPreparation.ts';
import { loadCampaignSnapshot } from '../worker/campaignRepository.ts';
import { handleRxdbPull,handleRxdbPush,handleRxdbCheckpoint } from '../worker/rxdbSync.ts';
const db=new BudgetD1(true,true);seedNetwork(db);
const access={campaignId:'campaign_n',role:'admin' as const,teamId:null,label:null,grantId:'test'};
const records:unknown[]=[];
async function measure(action:string,run:()=>Promise<unknown>){db.resetBudget();const start=performance.now();const result=await run();const record={action,result,elapsedMs:performance.now()-start,...db.report()};records.push(record);console.log(JSON.stringify(record));}
const original=(await loadCampaignSnapshot(db,'campaign_n'))!.areas[0];
db.sqlite.exec('DELETE FROM areas');
await measure('empty-campaign-bootstrap-5-pulls-checkpoint',async()=>{for(const collection of ['campaigns','teams','areas','streetTasks','houseTasks'] as const){const response=await handleRxdbPull(db,'campaign_n',collection,access,{});if(response.status!==200)throw new Error('bootstrap_failed');}return (await handleRxdbCheckpoint(db,'campaign_n',access)).status;});
const geometry=(north:number)=>({type:'Polygon' as const,coordinates:[[[13,51],[13.01,51],[13.01,north],[13,north],[13,51]]]});
await measure('area-create',async()=>{const response=await handleRxdbPush(db,'campaign_n','areas',access,{rows:[{newDocumentState:{...original,geometry:geometry(51.001105)}}]},{schedule:async()=>{}});return response.json();});
const roads=Array.from({length:20},(_,i)=>({type:'way',id:10+i,tags:{highway:'residential',name:`Road ${i}`},geometry:[{lon:13.0001+i*0.00049,lat:51.0001},{lon:13.0001+i*0.00049,lat:51.0099}]}));
const buildings=Array.from({length:1500},(_,i)=>{const x=13.00015+(i%20)*0.00049,y=51.00015+Math.floor(i/20)*0.000019;return {type:'way',id:1000+i,tags:{building:'house','addr:street':`Road ${i%20}`,'addr:housenumber':String(Math.floor(i/20)+1)},geometry:[{lon:x,lat:y},{lon:x+0.00003,lat:y},{lon:x+0.00003,lat:y+0.00003},{lon:x,lat:y}]};});
const options={fetchImpl:async(_url:unknown,init?:RequestInit)=>Response.json({osm3s:{timestamp_osm_base:'2026-09-07T00:00:00Z'},elements:String(init?.body).includes('highway')?roads:buildings})};
await measure('prepare-initial-1000',()=>prepareAreaTasks(db,'campaign_n','area_n',options));
for(const [action,north]of [['expand-500',51.00159],['shrink-500',51.001105]] as const){
 const before=(await loadCampaignSnapshot(db,'campaign_n'))!,area=before.areas[0];
 await measure(action,async()=>{const response=await handleRxdbPush(db,'campaign_n','areas',access,{rows:[{assumedMasterState:area,newDocumentState:{...area,geometry:geometry(north)}}]},{schedule:async()=>{}});const mutation=await response.json();const preparation=await prepareAreaTasks(db,'campaign_n','area_n',options);return {mutation,preparation};});
 const after=(await loadCampaignSnapshot(db,'campaign_n'))!;console.log(JSON.stringify({action,before:before.houseTasks!.length,after:after.houseTasks!.length}));
}
writeFileSync(process.env.D1_BUDGET_OUTPUT??'../d1-lifecycle-budget.json',JSON.stringify(records,null,2)+'\n');db.sqlite.close();
