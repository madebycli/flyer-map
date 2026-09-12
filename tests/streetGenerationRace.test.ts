import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NetworkD1,seedNetwork,networkOsm } from './helpers/networkD1.ts';
import { beginAreaTaskPreparation,prepareAreaTasks,getAreaTaskPreparationState } from '../worker/areaTaskPreparation.ts';
import { runNetworkPreparationStep } from '../worker/streetNetwork/preparation.ts';
import { loadCampaignSnapshot } from '../worker/campaignRepository.ts';
import { handleRxdbPush } from '../worker/rxdbSync.ts';
const access={campaignId:'campaign_n',role:'admin' as const,teamId:null,label:null,grantId:'test'};

test('A/B/C generation race: late A fetch cannot publish or restore obsolete staging after C is ready',async()=>{
 const db=new NetworkD1(true,true);seedNetwork(db);
 const a=await beginAreaTaskPreparation(db,'campaign_n','area_n');assert.equal(a.outcome,'run');if(a.outcome!=='run')return;
 let release!:(r:Response)=>void;let fetched!:()=>void;
 const pending=new Promise<Response>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{fetched=resolve;});
 const oldStep=runNetworkPreparationStep(db,a.run,{fetchImpl:async()=>{fetched();return pending;}});await started;
 const generations=[a.run.generation];
 for(const north of [51.011,51.012]){
  const current=(await loadCampaignSnapshot(db,'campaign_n'))!.areas[0];
  const geometry={type:'Polygon',coordinates:[[[13,51],[13.01,51],[13.01,north],[13,north],[13,51]]]};
  const response=await handleRxdbPush(db,'campaign_n','areas',access,{rows:[{assumedMasterState:current,newDocumentState:{...current,geometry}}]},{schedule:async()=>{}});
  assert.deepEqual((await response.json() as any).rejections,[]);generations.push((await getAreaTaskPreparationState(db,'campaign_n','area_n'))!.generation);
 }
 assert.equal(new Set(generations).size,3);
 assert.equal((await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async()=>networkOsm()})).outcome,'ready');
 const revision=(await loadCampaignSnapshot(db,'campaign_n'))!.revision;
 release(networkOsm());await oldStep;
 const final=(await loadCampaignSnapshot(db,'campaign_n'))!;
 assert.equal(final.revision,revision);assert.equal(final.houseTasks!.length,3);
 assert.ok([...final.tasks,...final.houseTasks!].every(e=>e.areaPreparationGeneration===generations[2]));
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM street_network_staging WHERE generation<>?').get(generations[2])!.n,0);
 db.sqlite.close();
});

test('additive migration preserves a legacy manual House parent while automatic Street rows move to chunks',async()=>{
 const db=new NetworkD1(false,true);seedNetwork(db);
 assert.equal((await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async()=>networkOsm()})).outcome,'ready');
 let snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
 const parent=snapshot.tasks[0];const manual={...snapshot.houseTasks![0],id:'task_manual_legacy',areaPreparationGeneration:null,parentStreetTaskId:parent.id};delete manual.roadPosition;
 const create=await handleRxdbPush(db,'campaign_n','houseTasks',access,{rows:[{newDocumentState:manual}]});assert.deepEqual((await create.json() as any).rejections,[]);
 db.sqlite.exec(readFileSync(new URL('../migrations/0023_street_base_chunks.sql',import.meta.url),'utf8'));
 snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;const area=snapshot.areas[0];
 const edit=await handleRxdbPush(db,'campaign_n','areas',access,{rows:[{assumedMasterState:area,newDocumentState:{...area,geometry:{type:'Polygon',coordinates:[[[13,51],[13.01,51],[13.01,51.011],[13,51.011],[13,51]]]}}}]},{schedule:async()=>{}});
 assert.deepEqual((await edit.json() as any).rejections,[]);
 assert.equal((await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async()=>networkOsm()})).outcome,'ready');
 const final=(await loadCampaignSnapshot(db,'campaign_n'))!;
 assert.equal(final.houseTasks!.find(h=>h.id==='task_manual_legacy')!.parentStreetTaskId,parent.id);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM tasks WHERE area_preparation_generation IS NOT NULL').get()!.n,0);
 db.sqlite.close();
});
