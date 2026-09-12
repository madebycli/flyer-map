import test from 'node:test';
import assert from 'node:assert/strict';
import { BudgetD1 } from './helpers/d1Budget.ts';
import { seedNetwork } from './helpers/networkD1.ts';
import { beginAreaTaskPreparation } from '../worker/areaTaskPreparation.ts';
import { PreparationRunner, type PreparationAlarmStorage } from '../worker/streetNetwork/runner.ts';
import { loadCampaignSnapshot } from '../worker/campaignRepository.ts';
import { CampaignSyncDurableObject } from '../worker/campaignSyncDurableObject.ts';
import { syncIncrementalGeoJson } from '../src/map/incrementalGeoJson.ts';
import { housesToGeoJson, type RenderHouse } from '../src/map/houseRenderer.ts';

class AlarmStorage implements PreparationAlarmStorage{
  data=new Map<string,unknown>();alarmAt:number|null=null;writes=0;reads=0;
  async get<T>(key:string){this.reads++;return this.data.get(key) as T|undefined;}
  async put(key:string,value:unknown){this.writes++;this.data.set(key,value);}
  async setAlarm(time:number){this.writes++;this.alarmAt=time;}
  async getAlarm(){this.reads++;return this.alarmAt;}
  async deleteAlarm(){this.writes++;this.alarmAt=null;}
}
function source(count:number){
  const roads=Array.from({length:20},(_,i)=>({type:'way',id:10+i,tags:{highway:'residential',name:`Road ${i}`},geometry:[{lon:13.0001+i*0.00049,lat:51.0001},{lon:13.0001+i*0.00049,lat:51.0099}]}));
  const buildings=Array.from({length:count},(_,i)=>{const x=13.00015+(i%20)*0.00049,y=51.00015+Math.floor(i/20)*0.000019;return {type:'way',id:1000+i,tags:{building:'house','addr:street':`Road ${i%20}`,'addr:housenumber':String(Math.floor(i/20)+1)},geometry:[{lon:x,lat:y},{lon:x+0.00003,lat:y},{lon:x+0.00003,lat:y+0.00003},{lon:x,lat:y}]};});
  return async(_url:unknown,init?:RequestInit)=>Response.json({osm3s:{timestamp_osm_base:'2026-09-07T00:00:00Z'},elements:String(init?.body).includes('highway')?roads:buildings});
}

test('10k preparation and canonical delete stay within measured write and invocation budgets',async(t)=>{
  const db=new BudgetD1(true,true);seedNetwork(db);db.resetBudget();
  const start=await beginAreaTaskPreparation(db,'campaign_n','area_n');assert.equal(start.outcome,'run');
  const storage=new AlarmStorage();const instance=new CampaignSyncDurableObject({storage,acceptWebSocket(){},getWebSockets:()=>[]},{DB:db});
  const savedFetch=globalThis.fetch;globalThis.fetch=source(10000) as typeof fetch;t.after(()=>{globalThis.fetch=savedFetch;});
  await instance.fetch(new Request('https://campaign-sync.internal/prepare',{method:'POST',headers:{'x-campaign-sync-internal':'1'},body:JSON.stringify({campaignId:'campaign_n'})}));let invocations=0,maxQueries=0,totalWrites=db.report().estimatedTotalRowsWritten;
  for(;storage.alarmAt!==null&&invocations<100;invocations++){
    storage.alarmAt=null;db.resetBudget();await instance.alarm();
    const report=db.report();maxQueries=Math.max(maxQueries,report.statements);totalWrites+=report.estimatedTotalRowsWritten;
    assert.ok(report.statements<=50,`alarm ${invocations}: ${report.statements} queries`);
  }
  assert.ok(invocations<100);const snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
  assert.equal(snapshot.houseTasks!.length,10000);
  // Baseline is ~130k. A 1k budget leaves measured headroom for chunk/index changes,
  // while rejecting any accidental return to per-House rows or feed entries.
  assert.ok(totalWrites<1000,`preparation estimated writes: ${totalWrites}`);
  const street=snapshot.tasks[0];db.resetBudget();
  const marking=await instance.fetch(new Request('https://campaign-sync.internal/execute',{method:'POST',headers:{'x-campaign-sync-internal':'1'},body:JSON.stringify({campaignId:'campaign_n',access:{campaignId:'campaign_n',role:'admin',teamId:null,label:null,grantId:'test'},operation:'network',input:{id:'budget_mark',areaId:'area_n',generation:street.areaPreparationGeneration,start:{point:street.geometry.coordinates[0],taskId:street.id},end:{point:street.geometry.coordinates.at(-1),taskId:street.id},selectedPath:[street.id],status:'completed'}})}));
  assert.equal(marking.status,200);
  const markBudget=db.report();assert.ok(markBudget.statements<=50);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM domain_event_history WHERE entity_type='house-task'").get()!.n,500);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM domain_events').get()!.n,0);
  const history=db.sqlite.prepare("SELECT entity_id,actor_ref,payload_json,dedupe_key FROM domain_event_history WHERE campaign_id='campaign_n' AND entity_type='house-task'").all();
  assert.equal(new Set(history.map(row=>row.entity_id)).size,500);
  assert.ok(history.every(row=>row.actor_ref==='test'&&JSON.parse(String(row.payload_json)).newStatus==='completed'));
  assert.equal(new Set(history.map(row=>row.dedupe_key)).size,500);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM domain_event_history WHERE campaign_id='other'").get()!.n,0);

  assert.ok(markBudget.estimatedTotalRowsWritten<100,`history marking writes: ${markBudget.estimatedTotalRowsWritten}`);
  t.diagnostic(JSON.stringify({historyEnabledMarkQueries:markBudget.statements,historyEnabledMarkWrites:markBudget.estimatedTotalRowsWritten}));
  const area=snapshot.areas[0];db.resetBudget();
  const response=await instance.fetch(new Request('https://campaign-sync.internal/execute',{method:'POST',headers:{'x-campaign-sync-internal':'1'},body:JSON.stringify({campaignId:'campaign_n',access:{campaignId:'campaign_n',role:'admin',teamId:null,label:null,grantId:'test'},operation:'push',collectionName:'areas',input:{rows:[{assumedMasterState:area,newDocumentState:{...area,_deleted:true}}]}})}));
  assert.equal(response.status,200);assert.deepEqual((await response.json() as any).rejections,[]);
  const deletion=db.report();assert.ok(deletion.statements<=50);assert.ok(deletion.estimatedTotalRowsWritten<500);
  assert.equal(deletion.tables.campaign_sync_changes.insert,1);
  assert.equal((await loadCampaignSnapshot(db,'campaign_n'))!.houseTasks!.length,0);
  t.diagnostic(JSON.stringify({invocations,maxQueries,totalWrites,doStorageReads:storage.reads,doStorageWrites:storage.writes,deleteQueries:deletion.statements,deleteWrites:deletion.estimatedTotalRowsWritten}));
  db.sqlite.close();
});

test('10k MapLibre Houses: one status change transfers properties, clearing uses one removeAll',()=>{
  const houses:RenderHouse[]=Array.from({length:10000},(_,i)=>({id:`house_${i}`,campaignId:'c',areaId:'a',taskType:'house',label:String(i),geometry:{type:'Polygon',coordinates:[[[13,51],[13.001,51],[13.001,51.001],[13,51]]]},status:'open',completedAt:null,parentStreetTaskId:null,createdAt:'2026-09-09',updatedAt:'2026-09-09',color:'#111',completedColor:'#222'}));
  const full:unknown[]=[],diffs:any[]=[];const source={setData:(value:unknown)=>full.push(value),updateData:(value:unknown)=>diffs.push(value)};
  const version=(house:RenderHouse)=>house.updatedAt+house.status;
  syncIncrementalGeoJson(source,houses,version,housesToGeoJson);
  const updated=houses.map((house,i)=>i===123?{...house,status:'completed' as const}:house);
  syncIncrementalGeoJson(source,updated,version,housesToGeoJson);
  assert.equal(full.length,1);assert.equal(diffs.length,1);assert.equal(diffs[0].update.length,1);
  assert.equal(diffs[0].update[0].newGeometry,undefined);assert.ok(JSON.stringify(diffs[0]).length<200);
  syncIncrementalGeoJson(source,updated,version,housesToGeoJson);assert.equal(diffs.length,1);
  syncIncrementalGeoJson(source,[],version,housesToGeoJson);assert.deepEqual(diffs[1],{removeAll:true});
});
