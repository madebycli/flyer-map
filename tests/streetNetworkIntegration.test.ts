import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { NetworkD1,seedNetwork,networkOsm } from './helpers/networkD1.ts';
import { prepareAreaTasks,beginAreaTaskPreparation,runAreaTaskPreparation } from '../worker/areaTaskPreparation.ts';
import { loadCampaignSnapshot } from '../worker/campaignRepository.ts';
import { handleNetworkIntent } from '../worker/streetNetwork/api.ts';
import { handleCampaignMutation } from '../worker/mutationHandler.ts';
import { handleRxdbPull, handleRxdbPush, handleRxdbCheckpoint } from '../worker/rxdbSync.ts';
import { MissionRxdbSync } from '../src/data/rxdbMissionSync.ts';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import type { CampaignSnapshot } from '../src/domain/campaign.ts';
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

test('fresh RxDB bootstrap carries topology and House measures, not just task status',async()=>{
  const db=await prepared();
  const roads=await handleRxdbPull(db,'campaign_n','streetTasks',access,{batchSize:100});
  const houses=await handleRxdbPull(db,'campaign_n','houseTasks',access,{batchSize:100});
  assert.ok((await roads.json()).documents[0].network.length>0);
  assert.ok((await houses.json()).documents[0].roadPosition.measure>0);
});

test('two real RxDB replicas converge through offline House edit, network commit and reconnect',async()=>{
  const db=await prepared();let offline=false;
  const snapshots:Record<string,CampaignSnapshot>={};
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{setTimeout:globalThis.setTimeout.bind(globalThis),clearTimeout:globalThis.clearTimeout.bind(globalThis),setInterval:globalThis.setInterval.bind(globalThis),clearInterval:globalThis.clearInterval.bind(globalThis),addEventListener(){},removeEventListener(){}}});
  const clients=['a','b'].map(name=>new MissionRxdbSync({campaignId:'campaign_n',teamScopeId:'team_n',actorScopeId:`test_${name}`,storage:getRxStorageMemory(),multiInstance:false,
    fetchImpl:async(input,init)=>{
      if(name==='b'&&offline)throw new TypeError('offline');
      const path=new URL(String(input),'https://example.test').pathname;
      const body=typeof init?.body==='string'?JSON.parse(init.body):{};
      if(path.endsWith('/checkpoint'))return handleRxdbCheckpoint(db,'campaign_n',access);
      const collection=path.split('/').at(-1) as 'streetTasks';
      if(path.includes('/pull/'))return handleRxdbPull(db,'campaign_n',collection,access,body);
      if(path.includes('/push/'))return handleRxdbPush(db,'campaign_n',collection,access,body);
      return new Response(null,{status:404});
    },onSnapshot:snapshot=>{snapshots[name]=snapshot;},onIssue:()=>{}}));
  const wait=async(predicate:()=>boolean)=>{const deadline=Date.now()+8000;while(!predicate()){if(Date.now()>deadline)throw new Error('replica_convergence_timeout');await new Promise(resolve=>setTimeout(resolve,20));}};
  try{
    await Promise.all(clients.map(client=>client.start()));
    await wait(()=>Boolean(snapshots.a?.tasks[0]?.network&&snapshots.b?.houseTasks?.[0]?.roadPosition));
    offline=true;
    const outside=snapshots.b.houseTasks!.find(house=>house.label.endsWith('2'))!;
    await clients[1].applyMutation({id:'mutation_offline_house',campaignId:'campaign_n',baseRevision:snapshots.b.revision,createdAt:new Date().toISOString(),type:'house.set-status',payload:{taskId:outside.id,status:'later',completedAt:null,expectedUpdatedAt:outside.updatedAt}} as never);
    const intent=await intentFor(db);assert.equal((await handleNetworkIntent(request(intent),db,'campaign_n',access)).status,200);
    await clients[0].refreshAndWait();await wait(()=>snapshots.a.houseTasks!.filter(house=>house.status==='completed').length===2);
    offline=false;clients[1].refresh();
    await wait(()=>snapshots.b.houseTasks!.filter(house=>house.status==='completed').length===2);
    // RxDB retries the pending local write; the canonical street action did not touch it.
    await wait(()=>snapshots.b.houseTasks!.find(house=>house.id===outside.id)?.status==='later');
    const deadline=Date.now()+8000;
    while((await loadCampaignSnapshot(db,'campaign_n'))!.houseTasks!.find(house=>house.id===outside.id)!.status!=='later'){
      if(Date.now()>deadline)throw new Error('pending_house_push_timeout');clients[1].refresh();await new Promise(resolve=>setTimeout(resolve,50));
    }
    await clients[0].refreshAndWait();await wait(()=>snapshots.a.houseTasks!.find(house=>house.id===outside.id)?.status==='later');
    assert.deepEqual(snapshots.a.tasks[0].network,snapshots.b.tasks[0].network);
  }finally{await Promise.all(clients.map(client=>client.destroy()));if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else delete (globalThis as {window?:unknown}).window;}
});

test('concurrent identical network intents commit once and produce one history trail',async()=>{
  const db=await prepared();
  for(const file of ['0006_fc1_field_groups.sql','0007_field_sessions_events.sql'])db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const intent=await intentFor(db),revision=(await loadCampaignSnapshot(db,'campaign_n'))!.revision;
  const responses=await Promise.all([handleNetworkIntent(request(intent),db,'campaign_n',access),handleNetworkIntent(request(intent),db,'campaign_n',access)]);
  assert.deepEqual(responses.map(response=>response.status),[200,200]);
  assert.equal((await loadCampaignSnapshot(db,'campaign_n'))!.revision,revision+1);
  const events=db.sqlite.prepare('SELECT entity_type,event_type,payload_json,actor_ref FROM domain_events ORDER BY entity_type').all();
  assert.equal(events.length,3);
  assert.equal(events.filter(event=>event.entity_type==='house-task'&&event.event_type==='task.status.changed').length,2);
  assert.ok(events.every(event=>event.actor_ref==='test'));
  assert.equal(events.find(event=>event.entity_type==='street-task')!.event_type,'street.coverage.changed');
});
test('full resumable pipeline publishes 1000 and 5000 houses with bounded tile requests and measured SQL batches',async(t)=>{
  for(const count of [1000,5000]){
    const db=new NetworkD1();seedNetwork(db);
    const roads=Array.from({length:20},(_,i)=>({type:'way',id:10+i,tags:{highway:'residential',name:`Road ${i}`},geometry:[{lon:13.0001+i*0.00049,lat:51.0001},{lon:13.0001+i*0.00049,lat:51.0099}]}));
    const buildings=Array.from({length:count},(_,i)=>{
      const x=13.00015+(i%20)*0.00049,y=51.00015+Math.floor(i/20)*0.000038;
      return {type:'way',id:1000+i,tags:{building:'house','addr:street':`Road ${i%20}`,'addr:housenumber':String(Math.floor(i/20)+1)},geometry:[{lon:x,lat:y},{lon:x+0.00001,lat:y},{lon:x+0.00001,lat:y+0.00001},{lon:x,lat:y}]};
    });
    let requests=0;const start=performance.now();
    const result=await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async(_url,init)=>{
      requests++;const query=String(init?.body);const elements=query.includes('highway')?roads:buildings;
      return new Response(JSON.stringify({osm3s:{timestamp_osm_base:'2026-09-07T00:00:00Z'},elements}));
    }});
    assert.equal(result.outcome,'ready',JSON.stringify(result));
    const snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
    assert.equal(snapshot.houseTasks!.length,count);
    assert.equal(snapshot.houseTasks!.filter(house=>house.parentStreetTaskId).length,count);
    assert.equal(snapshot.tasks.length,20);assert.equal(requests,2);assert.ok(Math.max(...db.batchSizes)<50,'fixture stays below the Free D1 query budget');
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM campaign_sync_changes WHERE collection_name='houseTasks'").get()!.n,count);
    assert.equal(db.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
    t.diagnostic(JSON.stringify({pipelineHouses:count,roads:20,requests,totalMs:performance.now()-start,maxBatchStatements:Math.max(...db.batchSizes),metrics:JSON.parse(db.sqlite.prepare('SELECT metrics_json FROM street_network_jobs').get()!.metrics_json as string)}));
  }
});
