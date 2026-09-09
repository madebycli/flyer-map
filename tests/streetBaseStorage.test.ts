import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkD1, seedNetwork, networkOsm } from './helpers/networkD1.ts';
import { prepareAreaTasks, getAreaTaskPreparationState } from '../worker/areaTaskPreparation.ts';
import { loadCampaignSnapshot } from '../worker/campaignRepository.ts';
import { handleRxdbPush, handleRxdbPull } from '../worker/rxdbSync.ts';
import type { AccessContext } from '../worker/access.ts';
const access:AccessContext={campaignId:'campaign_n',role:'admin',teamId:null,label:null,grantId:'test'};
const options={fetchImpl:async()=>networkOsm()};

test('chunk base is canonical for snapshot, bootstrap, compact incremental pull and House work',async()=>{
  const db=new NetworkD1(true);seedNetwork(db);
  assert.equal((await prepareAreaTasks(db,'campaign_n','area_n',options)).outcome,'ready');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM house_tasks').get()!.n,0);
  const snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
  assert.equal(snapshot.houseTasks!.length,3);
  for(const checkpoint of [null,{seq:0}]){
    const response=await handleRxdbPull(db,'campaign_n','houseTasks',access,{checkpoint,batchSize:100});
    assert.equal(response.status,200);assert.equal((await response.json() as any).documents.length,3);
  }
  const house=snapshot.houseTasks![0];
  const response=await handleRxdbPush(db,'campaign_n','houseTasks',access,{rows:[{assumedMasterState:house,newDocumentState:{...house,status:'later'}}]});
  assert.deepEqual((await response.json() as any).rejections,[]);
  assert.equal((await loadCampaignSnapshot(db,'campaign_n'))!.houseTasks!.find(item=>item.id===house.id)!.status,'later');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM house_tasks').get()!.n,0);
  const incremental=await handleRxdbPull(db,'campaign_n','houseTasks',access,{checkpoint:{seq:0},batchSize:100});
  const documents=(await incremental.json() as any).documents;
  assert.equal(documents.length,3);
  assert.equal(documents.find((item:any)=>item.id===house.id).status,'later');
  db.sqlite.close();
});

test('canonical create and geometry edit queue preparation; work survives shrink and re-expansion',async()=>{
  const db=new NetworkD1(true);seedNetwork(db);let scheduled=0;
  assert.equal((await prepareAreaTasks(db,'campaign_n','area_n',options)).outcome,'ready');
  let snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
  const house=snapshot.houseTasks![0];
  await handleRxdbPush(db,'campaign_n','houseTasks',access,{rows:[{assumedMasterState:house,newDocumentState:{...house,status:'later'}}]});
  const original=snapshot.areas[0].geometry;
  for(const geometry of [{type:'Polygon',coordinates:[[[13,51],[13.001,51],[13.001,51.01],[13,51.01],[13,51]]]},original]){
    snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;const area=snapshot.areas[0];
    const edit=await handleRxdbPush(db,'campaign_n','areas',access,{rows:[{assumedMasterState:area,newDocumentState:{...area,geometry}}]},{schedule:async()=>{scheduled++;}});
    assert.deepEqual((await edit.json() as any).rejections,[]);
    assert.equal((await getAreaTaskPreparationState(db,'campaign_n','area_n'))!.status,'pending');
    assert.equal((await prepareAreaTasks(db,'campaign_n','area_n',options)).outcome,'ready');
  }
  assert.equal(scheduled,2);
  assert.equal((await loadCampaignSnapshot(db,'campaign_n'))!.houseTasks!.find(item=>item.id===house.id)!.status,'later');
  snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
  const create={...snapshot.areas[0],id:'area_created'};
  const response=await handleRxdbPush(db,'campaign_n','areas',access,{rows:[{newDocumentState:create}]},{schedule:async()=>{scheduled++;}});
  assert.deepEqual((await response.json() as any).rejections,[]);
  assert.equal((await getAreaTaskPreparationState(db,'campaign_n',create.id))!.status,'pending');
  assert.equal(scheduled,3);
  db.sqlite.close();
});

test('failed compact feed publish rolls base and manifest back together',async()=>{
  const db=new NetworkD1(true);seedNetwork(db);db.failFeed=true;
  assert.equal((await prepareAreaTasks(db,'campaign_n','area_n',options)).outcome,'failed');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM street_base_chunks').get()!.n,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM street_base_areas').get()!.n,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM campaign_sync_changes').get()!.n,0);
  db.sqlite.close();
});

test('manual House parent refers to chunk Street and survives bootstrap and geometry reconciliation',async()=>{
 const db=new NetworkD1(true,true);seedNetwork(db);await prepareAreaTasks(db,'campaign_n','area_n',options);
 let snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
 const street=snapshot.tasks[0];const manual={...snapshot.houseTasks![0],id:'task_manual_house',areaPreparationGeneration:null,parentStreetTaskId:street.id};delete manual.roadPosition;
 const response=await handleRxdbPush(db,'campaign_n','houseTasks',access,{rows:[{newDocumentState:manual}]});
 assert.deepEqual((await response.json() as any).rejections,[]);
 assert.equal((await loadCampaignSnapshot(db,'campaign_n'))!.houseTasks!.find(h=>h.id==='task_manual_house')!.parentStreetTaskId,street.id);
 const bootstrap=await handleRxdbPull(db,'campaign_n','houseTasks',access,{});assert.equal((await bootstrap.json() as any).documents.find((h:any)=>h.id==='task_manual_house').parentStreetTaskId,street.id);
 snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
 const area=snapshot.areas[0],original=area.geometry;
 for(const geometry of [{type:'Polygon',coordinates:[[[13,51],[13.001,51],[13.001,51.01],[13,51.01],[13,51]]]},original]){
  const current=(await loadCampaignSnapshot(db,'campaign_n'))!.areas[0];
  const edit=await handleRxdbPush(db,'campaign_n','areas',access,{rows:[{assumedMasterState:current,newDocumentState:{...current,geometry}}]},{schedule:async()=>{}});
  assert.deepEqual((await edit.json() as any).rejections,[]);assert.equal((await prepareAreaTasks(db,'campaign_n','area_n',options)).outcome,'ready');
 }
 assert.equal((await loadCampaignSnapshot(db,'campaign_n'))!.houseTasks!.find(h=>h.id==='task_manual_house')!.parentStreetTaskId,street.id);
 db.sqlite.close();
});
