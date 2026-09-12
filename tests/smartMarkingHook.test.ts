import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { transformWithOxc } from 'vite';
import { indexedDB } from 'fake-indexeddb';
import { NetworkD1, seedNetwork, networkOsm } from './helpers/networkD1.ts';
import { prepareAreaTasks } from '../worker/areaTaskPreparation.ts';
import { loadCampaignSnapshot } from '../worker/campaignRepository.ts';
import { queuedNetworkIntents } from '../src/data/networkIntentQueue.ts';

async function loadWorkspaceHook() {
  const sourceUrl=new URL('../src/map/useNetworkWorkspace.tsx',import.meta.url);
  const transformed=await transformWithOxc(await readFile(sourceUrl,'utf8'),sourceUrl.pathname,{jsx:{runtime:'automatic'}});
  const code=transformed.code.replace(/from\s*(['"])([^'"]+)\1/g,(_all,quote,specifier)=>`from ${quote}${specifier.startsWith('.')?new URL(specifier,sourceUrl).href:import.meta.resolve(specifier)}${quote}`);
  return (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).useNetworkWorkspace as typeof import('../src/map/useNetworkWorkspace.tsx').useNetworkWorkspace;
}

test('real React Smart Mark hook chooses Area from A/B, previews and queues offline, then accepts another Area',async(t)=>{
  const db=new NetworkD1(true);seedNetwork(db);
  await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async()=>networkOsm()});
  const snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
  const road=snapshot.tasks[0];
  snapshot.areas.push({...snapshot.areas[0],id:'area_second'});
  snapshot.tasks.push({...road,id:'street_second',areaId:'area_second',geometry:{type:'LineString',coordinates:road.geometry.coordinates.map(([x,y])=>[x,y+0.02])}});
  const useNetworkWorkspace=await loadWorkspaceHook();
  const originals=new Map<string,PropertyDescriptor|undefined>();
  const set=(name:string,value:unknown)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});};
  const events=new EventTarget();
  set('window',{setInterval,clearInterval,setTimeout,clearTimeout,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)});
  set('navigator',{onLine:false});set('indexedDB',indexedDB);set('IS_REACT_ACT_ENVIRONMENT',true);
  set('fetch',async()=>Response.json({status:'ready',updatedAt:'2026-09-09T00:00:00Z'}));
  let renderer:ReactTestRenderer|undefined;let workspace:any;
  t.after(async()=>{if(renderer)await act(async()=>renderer!.unmount());for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}db.sqlite.close();});
  function Harness(){workspace=useNetworkWorkspace(snapshot,{role:'admin',teamId:null},async()=>{},()=>true);return null;}
  await act(async()=>{renderer=create(createElement(Harness));});
  await act(async()=>workspace.open(null));
  assert.equal(workspace.active,true);
  await act(async()=>workspace.mapProps.onSmartStreetPoint(road.geometry.coordinates[0],[road.id]));
  assert.equal(workspace.mapProps.smartStartAnchor.sourceId,road.id);
  await act(async()=>workspace.mapProps.onSmartStreetPoint(road.geometry.coordinates.at(-1),[road.id]));
  assert.ok(workspace.mapProps.smartPreviewGeometry);
  assert.ok(workspace.panelState);
  assert.equal(workspace.panelState.activeRoute !== null,true);
  await act(async()=>{await workspace.panelState.onCommit('completed');});
  const queued=await queuedNetworkIntents('campaign_n:admin::');
  assert.equal(queued.length,1);assert.equal(queued[0].intent.areaId,'area_n');
  assert.equal(workspace.mapProps.smartStartAnchor,null);
  const second=snapshot.tasks.at(-1)!;
  await act(async()=>workspace.mapProps.onSmartStreetPoint(second.geometry.coordinates[0],[second.id]));
  assert.equal(workspace.mapProps.smartStartAnchor.sourceId,second.id);
});

test('real workspace preparation polling backs off transient failures and stops authorization loops',async(t)=>{
  const useNetworkWorkspace=await loadWorkspaceHook();
  const originals=new Map<string,PropertyDescriptor|undefined>();
  const set=(name:string,value:unknown)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});};
  const events=new EventTarget();
  let nextTimer=1;const callbacks=new Map<number,()=>void>();const delays:number[]=[];
  let now=Date.now();const originalDateNow=Date.now;Date.now=()=>now;
  const setTimeoutMock=(callback:()=>void,delay:number)=>{const id=nextTimer++;callbacks.set(id,callback);delays.push(delay);return id;};
  const clearTimeoutMock=(id:number)=>{callbacks.delete(id);};
  const runNext=async()=>{const entry=callbacks.entries().next().value as [number,()=>void]|undefined;assert.ok(entry);callbacks.delete(entry[0]);now+=delays[delays.length-1];await act(async()=>{entry[1]();await Promise.resolve();await Promise.resolve();});};
  const windowValue={setInterval:()=>1,clearInterval:()=>{},setTimeout:setTimeoutMock,clearTimeout:clearTimeoutMock,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)};
  const documentValue={visibilityState:'visible',addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)};
  set('window',windowValue);set('document',documentValue);set('navigator',{onLine:true});set('indexedDB',indexedDB);set('IS_REACT_ACT_ENVIRONMENT',true);
  let fetchCalls=0;set('fetch',async()=>{fetchCalls+=1;return new Response(JSON.stringify({error:{code:'temporary'}}),{status:500,headers:{'content-type':'application/json'}});});
  const snapshot={schemaVersion:3,revision:1,campaign:{id:'campaign_poll',name:'Poll',status:'active',defaultMapView:null,createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'},teams:[],areas:[{id:'area_poll',campaignId:'campaign_poll',teamId:'team_poll',name:'Area',geometry:{type:'Polygon',coordinates:[[[13,51],[13.01,51],[13.01,51.01],[13,51.01],[13,51]]]},createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'}],tasks:[],houseTasks:[]};
  let renderer:ReactTestRenderer|undefined;
  t.after(async()=>{Date.now=originalDateNow;if(renderer)await act(async()=>renderer!.unmount());for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
  function Harness(){useNetworkWorkspace(snapshot,{campaignId:'campaign_poll',role:'admin',teamId:null,label:null},async()=>{},()=>true);return null;}
  await act(async()=>{renderer=create(createElement(Harness));});await act(async()=>{await Promise.resolve();await Promise.resolve();});
  assert.equal(fetchCalls,1);assert.deepEqual(delays,[2_000]);
  for(const expected of [4_000,8_000,16_000,30_000]){await runNext();assert.equal(delays.at(-1),expected);}
  await runNext();assert.equal(fetchCalls,6);assert.equal(callbacks.size,0);
});

test('workspace renders a Building quality failure and its bounded source details',async(t)=>{
  const db=new NetworkD1(true);seedNetwork(db);const snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
  const useNetworkWorkspace=await loadWorkspaceHook(),events=new EventTarget();
  const originals=new Map<string,PropertyDescriptor|undefined>();
  const set=(name:string,value:unknown)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});};
  set('window',{setInterval,clearInterval,setTimeout,clearTimeout,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)});
  set('navigator',{onLine:false});set('indexedDB',indexedDB);set('IS_REACT_ACT_ENVIRONMENT',true);
  let renderer:ReactTestRenderer|undefined;
  t.after(async()=>{if(renderer)await act(async()=>renderer!.unmount());for(const [key,value]of originals){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}db.sqlite.close();});
  function Harness(){const workspace=useNetworkWorkspace(snapshot,{role:'admin',teamId:null},async()=>{},()=>true);return workspace.areaActions(snapshot.areas[0],true);}
  await act(async()=>{renderer=create(createElement(Harness));});
  await act(async()=>events.dispatchEvent(new CustomEvent('campaign-preparation',{detail:{campaignId:'campaign_n',areaId:'area_n',state:{status:'failed',roadCount:1,houseCount:0,errorCode:'area_preparation_osm_failed',updatedAt:null,sourceTimestamp:null,progress:{phase:'buildings',percent:40,totalTiles:1,completedRoadTiles:1,completedBuildingTiles:0,processedBuildings:0,totalBuildings:0},failure:{phase:'buildings',cursor:0,code:'osm_normalization_no_trustworthy_buildings',attempt:1},quality:{receivedBuildings:1,acceptedBuildings:0,rejectedBuildings:1,emptyBuildingTiles:0,samples:[{osmId:999,tile:0,reason:'open_ring'}]}}}})));
  const text=JSON.stringify(renderer!.toJSON());
  assert.match(text,/keine neue Generation veröffentlicht/);assert.match(text,/Fehlerdetails/);
  assert.match(text,/osm_normalization_no_trustworthy_buildings/);assert.match(text,/999/);assert.match(text,/open_ring/);
  assert.ok(renderer!.root.findAllByProps({role:'alert'}).length>0);
});
