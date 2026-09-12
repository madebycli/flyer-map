import type { D1DatabaseLike } from './campaignRepository.ts';
import type { RxdbCollectionName } from '../src/data/rxdbSyncProtocol.ts';
import { hasBaseStorage } from './streetNetwork/baseStorage.ts';

export async function syncHeads(db:D1DatabaseLike,campaignId:string):Promise<{seq:number;collections?:Partial<Record<RxdbCollectionName,number>>}>{
  if(await hasBaseStorage(db)){
    const rows=await db.prepare('SELECT collection_name,seq FROM campaign_sync_heads WHERE campaign_id=?').bind(campaignId).all<{collection_name:RxdbCollectionName;seq:number}>();
    return {seq:Math.max(0,...rows.results.map(row=>row.seq)),collections:Object.fromEntries(rows.results.map(row=>[row.collection_name,row.seq]))};
  }
  const row=await db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM campaign_sync_changes WHERE campaign_id = ?').bind(campaignId).first<{seq:number}>();
  return {seq:row?.seq??0};
}
