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

test('Smart Marking renders points without duplicating candidate roads and shortcut commit stays open',async(t)=>{
  const db=new NetworkD1(true);seedNetwork(db);
  await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async()=>networkOsm()});
  const snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
  const road=snapshot.tasks[0];
  const useNetworkWorkspace=await loadWorkspaceHook();
  const originals=new Map<string,PropertyDescriptor|undefined>();
  const set=(name:string,value:unknown)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});};
  const events=new EventTarget();
  const navigatorValue={onLine:false};
  set('window',{setInterval,clearInterval,setTimeout,clearTimeout,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)});
  set('navigator',navigatorValue);set('indexedDB',indexedDB);set('IS_REACT_ACT_ENVIRONMENT',true);
  let renderer:ReactTestRenderer|undefined;let workspace:any;
  t.after(async()=>{if(renderer)await act(async()=>renderer!.unmount());for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}db.sqlite.close();});
  function Harness(){workspace=useNetworkWorkspace(snapshot,{role:'admin',teamId:null},async()=>{},()=>true);return null;}
  await act(async()=>{renderer=create(createElement(Harness));});
  await act(async()=>workspace.open('area_n'));

  assert.deepEqual(workspace.mapProps.smartRoads,[],'prepared roads must not be copied into a second Smart GeoJSON source');
  await act(async()=>workspace.mapProps.onSmartStreetPoint(road.geometry.coordinates[0],[]));
  assert.ok(workspace.mapProps.smartStartAnchor,'first accepted tap must expose a visible point anchor');
  assert.equal(workspace.mapProps.smartPreviewGeometry,null,'one tap must not highlight a whole road fragment');
  await act(async()=>workspace.mapProps.onSmartStreetPoint(road.geometry.coordinates.at(-1),[]));
  assert.ok(workspace.mapProps.smartEndAnchor,'second accepted tap must expose a visible point anchor');
  assert.ok(workspace.mapProps.smartPreviewGeometry,'two taps may preview only the actual route between the points');

  await act(async()=>{await workspace.panelState.onCommit('completed');});
  assert.equal(workspace.active,true,'shortcut status must keep Smart Marking open');
  assert.ok(workspace.panelState,'Smart Marking sheet must stay mounted');
  assert.equal(workspace.panelState.saving,false,'local enqueue must clear the loading state');
  assert.equal(workspace.panelState.pointCount,0,'finished shortcut selection must be cleared for the next marking');
  assert.equal(workspace.mapProps.smartStartAnchor,null);
  assert.equal(workspace.mapProps.smartEndAnchor,null);
  const queued=await queuedNetworkIntents('campaign_n:admin::');
  assert.equal(queued.length,1,'offline shortcut must remain durably queued');
});

test('online shortcut commit does not wait for a slow remote network request',async(t)=>{
  const db=new NetworkD1(true);seedNetwork(db);
  await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async()=>networkOsm()});
  const snapshot=(await loadCampaignSnapshot(db,'campaign_n'))!;
  const road=snapshot.tasks[0];
  const useNetworkWorkspace=await loadWorkspaceHook();
  const originals=new Map<string,PropertyDescriptor|undefined>();
  const set=(name:string,value:unknown)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});};
  const events=new EventTarget();
  const navigatorValue={onLine:false};
  set('window',{setInterval,clearInterval,setTimeout,clearTimeout,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)});
  set('navigator',navigatorValue);set('indexedDB',indexedDB);set('IS_REACT_ACT_ENVIRONMENT',true);
  let networkFetchStarted=false;
  let resolveNetworkFetch:(response:Response)=>void=()=>{};
  const networkFetch=new Promise<Response>(resolve=>{resolveNetworkFetch=resolve;});
  set('fetch',async(input:RequestInfo|URL)=>{
    const url=String(input);
    if(url.includes('/network')){
      networkFetchStarted=true;
      return await networkFetch;
    }
    return Response.json({status:'ready',updatedAt:'2026-09-16T00:00:00Z'});
  });
  let renderer:ReactTestRenderer|undefined;let workspace:any;
  t.after(async()=>{if(renderer)await act(async()=>renderer!.unmount());for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}db.sqlite.close();});
  function Harness(){workspace=useNetworkWorkspace(snapshot,{role:'admin',teamId:null},async()=>{},()=>true);return null;}
  await act(async()=>{renderer=create(createElement(Harness));});
  await act(async()=>workspace.open('area_n'));
  await act(async()=>workspace.mapProps.onSmartStreetPoint(road.geometry.coordinates[0],[]));
  await act(async()=>workspace.mapProps.onSmartStreetPoint(road.geometry.coordinates.at(-1),[]));
  navigatorValue.onLine=true;

  const result=await Promise.race([
    (async()=>{await act(async()=>{await workspace.panelState.onCommit('completed');});return 'committed';})(),
    new Promise<string>(resolve=>setTimeout(()=>resolve('timeout'),250)),
  ]);
  assert.equal(result,'committed','shortcut commit must finish after local persistence, not remote flush');
  assert.equal(workspace.active,true);
  assert.equal(workspace.panelState.saving,false);
  assert.equal(workspace.panelState.pointCount,0);

  for(let i=0;i<20&&!networkFetchStarted;i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(networkFetchStarted,true,'detached remote flush should still start after local commit returns');
  resolveNetworkFetch(Response.json({ok:true}));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
});
