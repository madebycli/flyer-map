import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAreaTasks, getAreaTaskPreparationPublicState } from '../worker/areaTaskPreparation.ts';
import { NetworkD1, seedNetwork, networkOsm } from './helpers/networkD1.ts';
import { safeSourceEndpoint, safeContentType } from '../worker/streetNetwork/sourceDiagnostics.ts';
import { preparationFailureMessage } from '../src/domain/preparationDiagnostics.ts';

test('a tile with only malformed buildings cannot publish a successful empty generation',async(t)=>{
  const db=new NetworkD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);
  const result=await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async(_url,init)=>new URLSearchParams(String(init?.body)).get('data')!.includes('building')?Response.json({elements:[{type:'way',id:999,tags:{building:'house','addr:housenumber':'1'},geometry:[{lon:13,lat:51},{lon:13.001,lat:51.001}]}]}):networkOsm()});
  assert.equal(result.outcome,'failed');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM street_base_areas').get()!.n,0);
  const job=db.sqlite.prepare('SELECT phase,cursor,error_code FROM street_network_jobs').get()!;
  assert.equal(job.phase,'buildings');assert.equal(job.cursor,0);assert.equal(job.error_code,'osm_normalization_no_trustworthy_buildings');
});

test('null OSM geometry nodes are a data-quality failure, not a retried transport failure',async(t)=>{
  const db=new NetworkD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);let buildingRequests=0;
  const result=await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async(_url,init)=>{
    if(!new URLSearchParams(String(init?.body)).get('data')!.includes('building'))return networkOsm();
    buildingRequests++;return Response.json({elements:[{type:'way',id:999,tags:{building:'yes'},geometry:[null,null,null,null]}]});
  }});
  assert.equal(result.outcome,'failed');assert.equal(buildingRequests,1);
  const state=await getAreaTaskPreparationPublicState(db,'campaign_n','area_n');
  assert.equal(state.status,'failed');assert.equal(state.progress?.phase,'buildings');
});

test('mixed Building quality survives cache reuse and exposes bounded samples through public status',async(t)=>{
  const db=new NetworkD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);let calls=0;
  const fetchImpl=async(_url:unknown,init?:RequestInit)=>{
    calls++;const payload=await networkOsm().json() as any;
    if(new URLSearchParams(String(init?.body)).get('data')!.includes('building'))payload.elements.push(...Array.from({length:15},(_,i)=>({type:'way',id:900+i,tags:{building:'yes'},geometry:[null,null]})));
    return Response.json(payload);
  };
  const first=await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl});assert.equal(first.outcome,'ready');
  const firstState=await getAreaTaskPreparationPublicState(db,'campaign_n','area_n');
  assert.equal(firstState.quality?.receivedBuildings,18);assert.equal(firstState.quality?.acceptedBuildings,3);
  assert.equal(firstState.quality?.rejectedBuildings,15);assert.equal(firstState.quality?.samples.length,10);
  assert.deepEqual(firstState.quality?.samples[0],{osmId:900,tile:0,reason:'invalid_coordinate'});
  assert.equal(firstState.houseCount,3);
  // A fresh generation reuses the same verified source version, including its
  // quality warning. No remote request or discarded quality metadata.
  db.sqlite.prepare("UPDATE areas SET geometry_json=?").run(JSON.stringify({type:'Polygon',coordinates:[[[13,51],[13.0099,51],[13.0099,51.01],[13,51.01],[13,51]]]}));
  const second=await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl});assert.equal(second.outcome,'ready');assert.equal(calls,2);
  const secondState=await getAreaTaskPreparationPublicState(db,'campaign_n','area_n');
  assert.deepEqual(secondState.quality,firstState.quality);
});

test('a valid empty Building response is explicitly distinct from discarded Building data',async(t)=>{
  const db=new NetworkD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);
  const result=await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async(_url,init)=>new URLSearchParams(String(init?.body)).get('data')!.includes('building')?Response.json({elements:[]}):networkOsm()});
  assert.equal(result.outcome,'ready');
  const state=await getAreaTaskPreparationPublicState(db,'campaign_n','area_n');
  assert.equal(state.houseCount,0);assert.equal(state.quality?.emptyBuildingTiles,1);assert.equal(state.quality?.rejectedBuildings,0);
});

for(const sample of [
  {name:'html',body:'<html>provider error secret-token</html>',type:'text/html',responseType:'html',remark:null},
  {name:'empty',body:'',type:'application/json',responseType:'empty',remark:null},
  {name:'truncated',body:'{"elements":[',type:'application/json',responseType:'invalid_json',remark:null},
  {name:'remark',body:'{"elements":[],"remark":"runtime error: timeout secret-token"}',type:'application/json',responseType:'json',remark:'timeout'},
  {name:'null',body:'null',type:'application/json',responseType:'json',remark:null},
])test(`source diagnosis preserves safe ${sample.name} response metadata without raw content`,async(t)=>{
  const db=new NetworkD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);
  const result=await prepareAreaTasks(db,'campaign_n','area_n',{upstreamUrl:'https://user:password@example.test/secret-token?key=secret-token',fetchImpl:async(_url,init)=>new URLSearchParams(String(init?.body)).get('data')!.includes('building')?new Response(sample.body,{headers:{'content-type':sample.type,'content-length':String(Buffer.byteLength(sample.body))}}):networkOsm()});
  assert.equal(result.outcome,'failed');const row=db.sqlite.prepare('SELECT metrics_json FROM street_network_jobs').get()!;
  const metrics=JSON.parse(String(row.metrics_json));const detail=metrics.lastError.sourceAttempts[0];
  assert.equal(metrics.lastError.phase,'buildings');assert.equal(metrics.lastError.cursor,0);
  assert.equal(detail.status,200);assert.equal(detail.responseType,sample.responseType);assert.equal(detail.remark,sample.remark);
  assert.equal(detail.bytes,Buffer.byteLength(sample.body));assert.equal(detail.contentLength,detail.bytes);assert.equal(detail.contentType,sample.type);
  assert.equal(detail.endpoint,'configured-upstream');assert.equal(detail.aborted,false);assert.ok(detail.elapsedMs>=0);
  assert.ok(!String(row.metrics_json).includes('secret-token'));assert.ok(!String(row.metrics_json).includes('password'));
  const state=await getAreaTaskPreparationPublicState(db,'campaign_n','area_n');
  assert.equal(state.failure?.code,'overpass_partial_failure');assert.equal(state.failure?.cursor,0);
  assert.ok(!JSON.stringify(state).includes('sourceAttempts'),'public state exposes a small failure contract');
});

test('429 attempts are bounded and retain rate-limit metadata at the failed Building cursor',async(t)=>{
  const db=new NetworkD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);let now=Date.now(),requests=0;
  const result=await prepareAreaTasks(db,'campaign_n','area_n',{now:()=>new Date(now+=5000),upstreamUrl:'https://example.test/provider',fetchImpl:async(_url,init)=>{
    if(!new URLSearchParams(String(init?.body)).get('data')!.includes('building'))return networkOsm();
    requests++;return new Response('not consumed',{status:429,headers:{'retry-after':'30'}});
  }});
  assert.equal(result.outcome,'failed');assert.equal(requests,3);
  const metrics=JSON.parse(String(db.sqlite.prepare('SELECT metrics_json FROM street_network_jobs').get()!.metrics_json));
  assert.equal(metrics.lastError.attempt,3);assert.equal(metrics.lastError.sourceAttempts[0].status,429);
  assert.equal(metrics.lastError.sourceAttempts[0].retryAfterSeconds,30);
  assert.equal(metrics.requests,4,'road success plus all three failed requests');
  assert.equal(metrics.lastError.sourceAttempts[0].bytes,0,'cancelled error bodies are not claimed as measured bytes');
});

test('diagnostic presentation and endpoint redaction are safe for unknown input',()=>{
  assert.equal(safeSourceEndpoint('https://u:p@example.test/token?a=b'),'configured-upstream');
  assert.equal(safeContentType('application/json; token=secret'),'application/json');
  assert.equal(safeContentType('secret-token'),null);
  assert.match(preparationFailureMessage('house_assignment_budget'),/Verarbeitungsgrenze/);
  assert.match(preparationFailureMessage('osm_normalization_no_trustworthy_buildings'),/keine neue Generation/);
  assert.ok(!preparationFailureMessage('secret-token').includes('secret-token'));
});
