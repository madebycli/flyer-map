import assert from 'node:assert/strict';
import test from 'node:test';
import { addressBuildings, postalAddress, type AddressBuilding } from '../worker/streetNetwork/addresses.ts';
const building = (osmId:number, tags:Record<string,string>={}):AddressBuilding => ({osmId,tags:{building:'yes',...tags},geometry:{type:'Polygon',coordinates:[[[13,51],[13.001,51],[13.001,51.001],[13,51.001],[13,51]]]}});
test('only postal addresses create delivery targets, including addresses on garages',()=>{
  for(const kind of ['yes','garage','garages','shed','outbuilding'])assert.equal(addressBuildings([building(1,{building:kind})],[]).length,0);
  assert.equal(addressBuildings(Array.from({length:100},(_,i)=>building(i,{building:'garage'})),[]).length,0);
  assert.equal(addressBuildings([building(1,{'addr:housenumber':' 12a '})],[])[0].address.label,'12a');
  assert.equal(addressBuildings([building(1,{building:'garage','addr:housenumber':'12'})],[]).length,1);
  assert.equal(postalAddress({'addr:housenumber':' '}),null);
});
test('address nodes, boundary ownership, duplicate tiles and direct address precedence are deterministic',()=>{
  const node={osmId:50,point:[13,51] as [number,number],tags:{'addr:street':'Main','addr:housenumber':'1'}};
  assert.equal(addressBuildings([building(2),building(1),building(1)],[node,node]).length,1);
  assert.equal(addressBuildings([building(2),building(1)],[node])[0].osmId,1);
  assert.equal(addressBuildings([building(1,{'addr:housenumber':'2'})],[node])[0].address.number,'2');
  assert.equal(addressBuildings([building(1)],[{...node,point:[14,52]}]).length,0);
});
test('same normalized full address dedupes while bare numbers and distinct addresses remain separate',()=>{
  const tags={'addr:street':' Main ','addr:housenumber':'1'};
  assert.equal(addressBuildings([building(1,tags),building(2,{...tags,'addr:street':'main'})],[]).length,1);
  assert.equal(addressBuildings([building(1,{'addr:housenumber':'1'}),building(2,{'addr:housenumber':'1'})],[]).length,2);
  const nodes=['1','2'].map((number,i)=>({osmId:50+i,point:[13.0005,51.0005] as [number,number],tags:{'addr:street':'Main','addr:housenumber':number}}));
  const result=addressBuildings([building(1)],nodes);
  assert.equal(result.length,2);assert.equal(result[0].identityAddress,null);assert.ok(result[1].identityAddress);
});

import { NetworkD1,seedNetwork,networkOsm } from './helpers/networkD1.ts';
import { beginAreaTaskPreparation,getAreaTaskPreparationPublicState,runAreaTaskPreparation,prepareAreaTasks } from '../worker/areaTaskPreparation.ts';
import { PreparationRunner,type PreparationAlarmStorage } from '../worker/streetNetwork/runner.ts';
import { loadCampaignSnapshot } from '../worker/campaignRepository.ts';
import { handleRxdbPull,handleRxdbPush } from '../worker/rxdbSync.ts';
class AlarmStorage implements PreparationAlarmStorage {
  values=new Map<string,unknown>(); time:number|null=null;
  async get<T>(key:string){return this.values.get(key) as T|undefined;}
  async put(key:string,value:unknown){this.values.set(key,value);}
  async getAlarm(){return this.time;}
  async setAlarm(time:number){this.time=time;}
  async deleteAlarm(){this.time=null;}
}
test('a durable wake-up resumes a persisted generation after browser and runner restart',async()=>{
  const db=new NetworkD1();seedNetwork(db);const options={fetchImpl:async()=>networkOsm()};
  const start=await beginAreaTaskPreparation(db,'campaign_n','area_n',options);assert.equal(start.outcome,'run');if(start.outcome!=='run')return;
  await runAreaTaskPreparation(db,start.run,options);
  const progress=await getAreaTaskPreparationPublicState(db,'campaign_n','area_n');
  assert.equal(progress.status,'pending');assert.equal(progress.progress?.completedRoadTiles,1);assert.ok(progress.progress!.percent>0);
  const storage=new AlarmStorage();await new PreparationRunner(storage,db,options).schedule('campaign_n');
  assert.ok(storage.time);for(let wake=0;wake<20&&storage.time;wake++)await new PreparationRunner(storage,db,options).alarm();
  const ready=await getAreaTaskPreparationPublicState(db,'campaign_n','area_n');
  assert.equal(ready.status,'ready');assert.equal(ready.progress?.percent,100);assert.equal(storage.time,null);
  assert.equal(db.sqlite.prepare('SELECT generation FROM area_task_preparations').get()!.generation,start.run.generation);
  await new PreparationRunner(storage,db,options).alarm();assert.equal(storage.time,null);
});
test('runtime default fetch works without dependency injection and includes address nodes in the query',async()=>{
  const old=globalThis.fetch;const queries:string[]=[];
  globalThis.fetch=async(_url,init)=>{queries.push(String(init?.body));return networkOsm();};
  try{
    const db=new NetworkD1();seedNetwork(db);
    assert.equal((await prepareAreaTasks(db,'campaign_n','area_n')).outcome,'ready');
    assert.ok(queries.some(query=>decodeURIComponent(query).includes('node["addr:housenumber"]')));
  }finally{globalThis.fetch=old;}
});
test('server area deletion publishes all tombstones and removes preparation metadata atomically',async()=>{
  const db=new NetworkD1();seedNetwork(db);await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async()=>networkOsm()});
  const access={campaignId:'campaign_n',role:'admin' as const,teamId:null,label:null,grantId:'test'};
  const before=(await loadCampaignSnapshot(db,'campaign_n'))!;
  const checkpoint=(await (await handleRxdbPull(db,'campaign_n','areas',access,{})).json()).checkpoint;
  const area=before.areas[0];
  const response=await handleRxdbPush(db,'campaign_n','areas',access,{rows:[{assumedMasterState:area,newDocumentState:{...area,_deleted:true}}]});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{conflicts:[],rejections:[]});
  const after=(await loadCampaignSnapshot(db,'campaign_n'))!;
  assert.equal(after.areas.length,0);assert.equal(after.tasks.length,0);assert.equal(after.houseTasks?.length,0);
  assert.equal(db.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
  for(const table of ['area_task_preparations','street_network_jobs','street_network_staging','street_network_state','house_road_positions'])assert.equal(db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n,0,table);
  for(const collection of ['areas','streetTasks','houseTasks'] as const){
    const pull=await (await handleRxdbPull(db,'campaign_n',collection,access,{checkpoint,batchSize:250})).json();
    assert.ok(pull.documents.length);assert.ok(pull.documents.every((doc:{_deleted:boolean})=>doc._deleted));
  }
});

import { MissionRxdbSync } from '../src/data/rxdbMissionSync.ts';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { handleRxdbCheckpoint } from '../worker/rxdbSync.ts';
import type { CampaignSnapshot } from '../src/domain/campaign.ts';
test('offline Area delete with 100 Streets and 1000 Houses converges in two replicas without child pushes or conflict storms',async()=>{
  const db=new NetworkD1();seedNetwork(db);await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async()=>networkOsm()});
  for(let i=1;i<100;i++)db.sqlite.prepare("INSERT INTO tasks SELECT 'extra_street_'||?,campaign_id,area_id,task_type,label,geometry_json,status,completed_at,created_at,updated_at,source_json,area_preparation_generation FROM tasks LIMIT 1").run(i);
  for(let i=3;i<1000;i++)db.sqlite.prepare("INSERT INTO house_tasks SELECT 'extra_house_'||?,campaign_id,area_id,parent_street_task_id,label,geometry_json,source_json,status,completed_at,created_at,updated_at,area_preparation_generation FROM house_tasks LIMIT 1").run(i);
  const access={campaignId:'campaign_n',role:'admin' as const,teamId:null,label:null,grantId:'test'};
  const snapshots:Record<string,CampaignSnapshot>={};const issues:unknown[]=[];const pushed:string[]=[];const frames:number[]=[];
  let offline=false,deleted=false;
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{setTimeout:globalThis.setTimeout.bind(globalThis),clearTimeout:globalThis.clearTimeout.bind(globalThis),setInterval:globalThis.setInterval.bind(globalThis),clearInterval:globalThis.clearInterval.bind(globalThis),addEventListener(){},removeEventListener(){}}});
  const clients=['a','b'].map(name=>new MissionRxdbSync({campaignId:'campaign_n',teamScopeId:'team_n',actorScopeId:`delete_${name}`,storage:getRxStorageMemory(),multiInstance:false,
    fetchImpl:async(input,init)=>{
      if(offline)throw new TypeError('offline');
      const path=new URL(String(input),'https://example.test').pathname;
      const body=typeof init?.body==='string'?JSON.parse(init.body):{};
      if(path.endsWith('/checkpoint'))return handleRxdbCheckpoint(db,'campaign_n',access);
      const collection=path.split('/').at(-1) as 'streetTasks';
      if(path.includes('/pull/')){
        if(deleted&&name==='b'&&String(collection)==='areas')await new Promise(resolve=>setTimeout(resolve,150));
        return handleRxdbPull(db,'campaign_n',collection,access,body);
      }
      if(path.includes('/push/')){pushed.push(collection);return handleRxdbPush(db,'campaign_n',collection,access,body);}
      return new Response(null,{status:404});
    },onSnapshot:snapshot=>{snapshots[name]=snapshot;if(name==='b'&&deleted)frames.push(snapshot.houseTasks?.length??0);},onIssue:issue=>{if(!offline)issues.push(issue);}}));
  const wait=async(predicate:()=>boolean)=>{const end=Date.now()+12000;while(!predicate()){if(Date.now()>end)throw new Error('delete_convergence_timeout');await new Promise(resolve=>setTimeout(resolve,20));}};
  try{
    await Promise.all(clients.map(client=>client.start()));await wait(()=>snapshots.a?.houseTasks?.length===1000&&snapshots.b?.houseTasks?.length===1000);
    offline=true;const area=snapshots.a.areas[0];
    await clients[0].applyMutation({id:'mutation_delete_offline',campaignId:'campaign_n',baseRevision:snapshots.a.revision,createdAt:new Date().toISOString(),type:'area.delete',payload:{areaId:area.id,expectedUpdatedAt:area.updatedAt}} as never);
    await wait(()=>snapshots.a.areas.length===0&&snapshots.a.houseTasks?.length===0);
    offline=false;clients[0].refresh();await wait(()=>db.sqlite.prepare('SELECT COUNT(*) n FROM areas').get()!.n===0);
    deleted=true;clients[1].refresh();await wait(()=>snapshots.b.areas.length===0&&snapshots.b.houseTasks?.length===0);
    await Promise.all(clients.map(client=>client.refreshAndWait()));
    assert.ok(pushed.every(collection=>collection==='areas'),JSON.stringify(pushed));
    assert.deepEqual(issues,[]);assert.ok(frames.every(count=>count===0||count===1000),JSON.stringify(frames));
    assert.equal(db.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
    assert.equal((await loadCampaignSnapshot(db,'campaign_n'))!.houseTasks?.length,0);
  }finally{await Promise.all(clients.map(client=>client.destroy()));if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else delete (globalThis as {window?:unknown}).window;}
});

test('independent RxDB clients converge after mutual status writes and reject a stale offline child after Area deletion',async()=>{
  const db=new NetworkD1(true,true);seedNetwork(db);
  await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async()=>networkOsm()});
  const access={campaignId:'campaign_n',role:'admin' as const,teamId:null,label:null,grantId:'test'};
  const snapshots:Record<string,CampaignSnapshot>={};const issues:{name:string;kind:string;code:string}[]=[];const pushed:string[]=[];const offline:Record<string,boolean>={a:false,b:false};
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{setTimeout:globalThis.setTimeout.bind(globalThis),clearTimeout:globalThis.clearTimeout.bind(globalThis),setInterval:globalThis.setInterval.bind(globalThis),clearInterval:globalThis.clearInterval.bind(globalThis),addEventListener(){},removeEventListener(){}}});
  const clients=['a','b'].map(name=>new MissionRxdbSync({campaignId:'campaign_n',teamScopeId:'team_n',actorScopeId:'independent_'+name,storage:getRxStorageMemory(),multiInstance:false,
    fetchImpl:async(input,init)=>{
      if(offline[name])throw new TypeError('offline');
      const path=new URL(String(input),'https://example.test').pathname;
      const body=typeof init?.body==='string'?JSON.parse(init.body):{};
      if(path.endsWith('/checkpoint'))return handleRxdbCheckpoint(db,'campaign_n',access);
      const collection=path.split('/').at(-1) as 'areas';
      if(path.includes('/pull/'))return handleRxdbPull(db,'campaign_n',collection,access,body);
      if(path.includes('/push/')){pushed.push(`${name}:${collection}`);return handleRxdbPush(db,'campaign_n',collection,access,body);}
      return new Response(null,{status:404});
    },
    onSnapshot:snapshot=>{snapshots[name]=snapshot;},
    onIssue:issue=>{if(offline[name]&&issue.kind==='network')return;issues.push({name,kind:issue.kind,code:issue.code});},
  }));
  const wait=async(predicate:()=>boolean|Promise<boolean>,label='state')=>{const end=Date.now()+15000;while(!(await predicate())){if(Date.now()>end){const state=await loadCampaignSnapshot(db,'campaign_n');throw new Error(`independent_client_convergence_timeout:${label}:${JSON.stringify({issues,pushed,areas:state?.areas.length,house:state?.houseTasks?.map(h=>({id:h.id,label:h.label,status:h.status,gen:h.areaPreparationGeneration}))})}`);}await new Promise(resolve=>setTimeout(resolve,20));}};
  try{
    await Promise.all(clients.map(client=>client.start()));
    await wait(()=>snapshots.a?.houseTasks?.length===3&&snapshots.b?.houseTasks?.length===3);
    const aHouse=snapshots.a.houseTasks![0];
    await clients[0].applyMutation({id:'mutation_independent_a_status',campaignId:'campaign_n',baseRevision:snapshots.a.revision,createdAt:new Date().toISOString(),type:'house.set-status',payload:{taskId:aHouse.id,status:'later',completedAt:null}} as never);
    await wait(async()=>Boolean((await loadCampaignSnapshot(db,'campaign_n'))?.houseTasks?.find(h=>h.id===aHouse.id)?.status==='later'),'server-status');
    await clients[1].refresh();await wait(()=>snapshots.b.houseTasks?.find(h=>h.id===aHouse.id)?.status==='later');
    const bHouse=snapshots.b.houseTasks!.find(h=>h.id!==aHouse.id)!;
    await clients[1].applyMutation({id:'mutation_independent_b_status',campaignId:'campaign_n',baseRevision:snapshots.b.revision,createdAt:new Date().toISOString(),type:'house.set-status',payload:{taskId:bHouse.id,status:'later',completedAt:null}} as never);
    await wait(async()=>Boolean((await loadCampaignSnapshot(db,'campaign_n'))?.houseTasks?.find(h=>h.id===bHouse.id)?.status==='later'),'server-status-b');
    await clients[0].refresh();await wait(()=>snapshots.a.houseTasks?.find(h=>h.id===bHouse.id)?.status==='later');

    const area=snapshots.a.areas[0];const staleHouse=snapshots.b.houseTasks!.find(h=>h.id===bHouse.id)!;
    offline.b=true;
    await clients[0].applyMutation({id:'mutation_independent_a_delete',campaignId:'campaign_n',baseRevision:snapshots.a.revision,createdAt:new Date().toISOString(),type:'area.delete',payload:{areaId:area.id,expectedUpdatedAt:area.updatedAt}} as never);
    await wait(()=>db.sqlite.prepare('SELECT COUNT(*) n FROM areas WHERE id=?').get(area.id)?.n===0);
    await wait(()=>snapshots.a.areas.length===0&&snapshots.a.houseTasks?.length===0);
    await clients[1].applyMutation({id:'mutation_independent_b_stale_child',campaignId:'campaign_n',baseRevision:snapshots.b.revision,createdAt:new Date().toISOString(),type:'house.set-status',payload:{taskId:staleHouse.id,status:'completed',completedAt:new Date().toISOString()}} as never);
    offline.b=false;clients[1].refresh();await wait(()=>snapshots.b.areas.length===0&&snapshots.b.houseTasks?.length===0);
    await clients[1].refreshAndWait();
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM areas WHERE id=?').get(area.id)?.n,0);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM house_tasks WHERE area_id=?').get(area.id)?.n,0);
    assert.ok(pushed.includes('a:houseTasks')&&pushed.includes('b:houseTasks'),JSON.stringify(pushed));
    assert.ok(pushed.includes('a:areas'),JSON.stringify(pushed));
    assert.equal(issues.filter(issue=>issue.kind==='network').length,0,JSON.stringify(issues));
    assert.ok(issues.some(issue=>issue.kind==='rejected'&&['target_deleted','house_position_server_owned'].includes(issue.code)),JSON.stringify(issues));
  }finally{
    await Promise.all(clients.map(client=>client.destroy()));
    if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else delete (globalThis as {window?:unknown}).window;
    db.sqlite.close();
  }
});
