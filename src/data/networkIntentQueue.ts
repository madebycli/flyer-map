import type { NetworkIntent } from '../../worker/streetNetwork/api.ts';
type QueuedIntent = { key:string; scope:string; campaignId:string; intent:NetworkIntent; enqueuedAt:number; blocked?:string };
function openQueue():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{const request=indexedDB.open('flyer-map-network-intents',1);request.onupgradeneeded=()=>request.result.createObjectStore('intents',{keyPath:'key'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
async function transact<T>(mode:IDBTransactionMode,operation:(store:IDBObjectStore)=>IDBRequest<T>) {
  const db=await openQueue();
  try{return await new Promise<T>((resolve,reject)=>{const tx=db.transaction('intents',mode);const request=operation(tx.objectStore('intents'));tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export async function enqueueNetworkIntent(scope:string,campaignId:string,intent:NetworkIntent) {
  await transact('readwrite',store=>store.put({key:`${scope}:${intent.id}`,scope,campaignId,intent,enqueuedAt:Date.now()} satisfies QueuedIntent));
}
export async function queuedNetworkIntents(scope:string) {return (await transact('readonly',store=>store.getAll()) as QueuedIntent[]).filter(item=>item.scope===scope).sort((a,b)=>a.enqueuedAt-b.enqueuedAt||a.key.localeCompare(b.key));}
export async function discardNetworkIntent(key:string) {await transact('readwrite',store=>store.delete(key));}
const flushing=new Map<string,Promise<void>>();
export function flushNetworkIntents(scope:string,onApplied:()=>Promise<unknown>) {
  const existing=flushing.get(scope);if(existing)return existing;
  const operation=(async()=>{
    for(const item of await queuedNetworkIntents(scope)) {
      if(item.blocked)continue;
      const response=await fetch(`/api/campaigns/${encodeURIComponent(item.campaignId)}/network`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(item.intent)});
      if(response.ok){await discardNetworkIntent(item.key);await onApplied();continue;}
      if(response.status>=400 && response.status<500 && response.status!==429) {
        const body=await response.json().catch(()=>({}));
        await transact('readwrite',store=>store.put({...item,blocked:typeof body.code==='string'?body.code:'network_conflict'}));
        break;
      }
      throw new Error('network_retry');
    }
  })().finally(()=>flushing.delete(scope));
  flushing.set(scope,operation);return operation;
}
