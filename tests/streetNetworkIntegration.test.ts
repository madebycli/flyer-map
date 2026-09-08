import assert from 'node:assert/strict';
import test from 'node:test';
import { NetworkD1,seedNetwork,networkOsm } from './helpers/networkD1.ts';
import { prepareAreaTasks,beginAreaTaskPreparation,runAreaTaskPreparation } from '../worker/areaTaskPreparation.ts';
import { loadCampaignSnapshot } from '../worker/campaignRepository.ts';
import { handleNetworkIntent } from '../worker/streetNetwork/api.ts';
import { handleCampaignMutation } from '../worker/mutationHandler.ts';
const options={fetchImpl:async()=>networkOsm()};
const access={campaignId:'campaign_n',role:'admin' as const,teamId:null,label:null,grantId:'test'};
async function prepared(){const db=new NetworkD1();seedNetwork(db);const result=await prepareAreaTasks(db,'campaign_n','area_n',options);assert.equal(result.outcome,'ready');return db;}
async function intentFor(db:NetworkD1){const snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;const task=snapshot.tasks[0];return {id:'network_test',areaId:'area_n',generation:task.areaPreparationGeneration!,start:{point:[13.0015,51.005],taskId:task.id},end:{point:[13.006,51.005],taskId:task.id},selectedPath:[task.id],status:'completed'};}
const request=(input:unknown)=>new Request('https://example.test/api/campaigns/campaign_n/network',{method:'POST',body:JSON.stringify(input)});
test('resumable generation is invisible until complete; D1, metadata and feed agree',async()=>{
  const db=new NetworkD1();seedNetwork(db);const begun=await beginAreaTaskPreparation(db,'campaign_n','area_n',options);assert.equal(begun.outcome,'run');if(begun.outcome!=='run')return;
  assert.equal((await runAreaTaskPreparation(db,begun.run,options)).outcome,'pending');
  assert.equal((await loadCampaignSnapshot(db,'campaign_n'))!.tasks.length,0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM campaign_sync_changes').get()!.n,0);
  const ready=await prepareAreaTasks(db,'campaign_n','area_n',options);assert.equal(ready.outcome,'ready');
  const snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
  assert.equal(snapshot.tasks.length,1);assert.equal(snapshot.houseTasks!.length,3);
  assert.equal(snapshot.houseTasks!.filter(h=>h.parentStreetTaskId===snapshot.tasks[0].id).length,3);
  assert.ok(snapshot.tasks[0].network);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM campaign_sync_changes WHERE collection_name='houseTasks'").get()!.n,3);
  assert.equal((await prepareAreaTasks(db,'campaign_n','area_n',options)).outcome,'no-op');
});
test('canonical A/B mutation changes only associated houses; replay has no writes; old full-status writer denied',async()=>{
  const db=await prepared();const intent=await intentFor(db);
  const result=await handleNetworkIntent(request(intent),db,'campaign_n',access);assert.equal(result.status,200,await result.clone().text());
  const snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
  assert.deepEqual(snapshot.houseTasks!.sort((a,b)=>a.label.localeCompare(b.label)).map(h=>h.status),['completed','completed','open']);
  assert.equal(snapshot.tasks[0].status,'open');assert.equal(snapshot.tasks[0].network!.coverage.length,1);
  const replay=await handleNetworkIntent(request(intent),db,'campaign_n',access);assert.equal(replay.status,200);assert.equal((await replay.json()).code,'already_applied');
  assert.equal((await loadCampaignSnapshot(db,'campaign_n'))!.revision,snapshot.revision);
  const old=await handleCampaignMutation(request({mutation:{id:'mutation_old',campaignId:'campaign_n',baseRevision:snapshot.revision,createdAt:new Date().toISOString(),type:'task.set-status',payload:{taskId:snapshot.tasks[0].id,status:'completed',completedAt:new Date().toISOString(),expectedUpdatedAt:snapshot.tasks[0].updatedAt}}}),db,'campaign_n',access);
  assert.equal(old.status,409);
});
test('feed fault rolls back coverage and houses; stale generation and forged path rejected',async()=>{
  const db=await prepared();const intent=await intentFor(db);const before=await loadCampaignSnapshot(db,'campaign_n');
  db.failFeed=true;await assert.rejects(handleNetworkIntent(request(intent),db,'campaign_n',access),/injected_feed_failure/);db.failFeed=false;
  assert.deepEqual(await loadCampaignSnapshot(db,'campaign_n'),before);
  assert.equal((await handleNetworkIntent(request({...intent,generation:'old'}),db,'campaign_n',access)).status,409);
  assert.equal((await handleNetworkIntent(request({...intent,selectedPath:['forged']}),db,'campaign_n',access)).status,409);
  assert.equal((await handleNetworkIntent(request(intent),db,'campaign_n',{...access,role:'team-editor',teamId:'other'})).status,403);
});
test('partial upstream response retains recoverable job and publishes no entities',async()=>{
  const db=new NetworkD1();seedNetwork(db);
  const result=await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async()=>new Response(JSON.stringify({remark:'runtime error: timeout',elements:[]}))});
  assert.equal(result.outcome,'failed');assert.equal((await loadCampaignSnapshot(db,'campaign_n'))!.tasks.length,0);
  assert.equal(db.sqlite.prepare('SELECT error_code FROM street_network_jobs').get()!.error_code,'overpass_partial_failure');
});
