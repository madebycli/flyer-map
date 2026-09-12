import type { AccessContext } from './access.ts';
import type { CampaignSyncNamespace } from './campaignSyncDurableObject.ts';
import type { RxdbCollectionName } from '../src/data/rxdbSyncProtocol.ts';

export type CampaignExecution={campaignId:string;access:AccessContext;operation:'pull'|'push'|'network';collectionName?:RxdbCollectionName;input:unknown};
/** Called only after the public Worker performed its normal access/method checks. */
export async function executeInCampaign(namespace:CampaignSyncNamespace,input:CampaignExecution):Promise<Response>{
  if(input.operation==='push'&&input.input&&typeof input.input==='object'&&'rows' in input.input&&Array.isArray(input.input.rows)&&input.input.rows.length>1&&input.input.rows.length<=40){
    const conflicts:unknown[]=[],rejections:unknown[]=[];
    for(const row of input.input.rows){
      const response=await executeInCampaign(namespace,{...input,input:{rows:[row]}});
      if(!response.ok)return response;
      const result=await response.json() as {conflicts:unknown[];rejections:unknown[]};
      conflicts.push(...result.conflicts);rejections.push(...result.rejections);
    }
    return Response.json({conflicts,rejections},{headers:{'cache-control':'no-store'}});
  }
  return namespace.get(namespace.idFromName(input.campaignId)).fetch('https://campaign-sync.internal/execute',{
    method:'POST',headers:{'content-type':'application/json','x-campaign-sync-internal':'1'},body:JSON.stringify(input),
  });
}
