import type { D1DatabaseLike } from '../campaignRepository.ts';
import { boundedChunks } from './baseStorage.ts';
import { sha256Hex } from './reconcile.ts';

/** Fixed-size, public source cache. No credentials, user geometry or work state. */
export async function cachedSourceTile<T extends {features:unknown[];addressNodes:unknown[];bytes:number;attempts:number;fetchMs:number;parseMs:number;normalizationMs:number}>(db:D1DatabaseLike,key:unknown,fetchTile:()=>Promise<T>):Promise<T&{cacheHit:boolean}>{
  const cacheKey=await sha256Hex(JSON.stringify(key));
  const existing=await db.prepare('SELECT part,payload_json FROM street_source_tiles WHERE cache_key=? ORDER BY part').bind(cacheKey).all<{part:number;payload_json:string}>();
  if(existing.results.length){
    const [first,...parts]=existing.results;const meta=JSON.parse(first.payload_json);
    if(first.part===-1&&meta.parts===parts.length){
      const values=parts.flatMap(row=>JSON.parse(row.payload_json));
      return {...meta.value,features:values.filter(row=>row.kind==='feature').map(row=>row.value),addressNodes:values.filter(row=>row.kind==='address').map(row=>row.value),attempts:0,fetchMs:0,parseMs:0,normalizationMs:0,cacheHit:true};
    }
  }
  const result=await fetchTile();
  const {features,addressNodes,...value}=result;
  const parts=boundedChunks([...features.map(value=>({kind:'feature',value})),...addressNodes.map(value=>({kind:'address',value}))],400_000);
  const rows=[{part:-1,payload:JSON.stringify({parts:parts.length,value})},...parts.map((part,i)=>({part:i,payload:JSON.stringify(part)}))];
  const cachedAt=new Date().toISOString();
  const statements=[db.prepare('DELETE FROM street_source_tiles WHERE cache_key=?').bind(cacheKey),...boundedChunks(rows,1_000_000).map(chunk=>db.prepare(`INSERT INTO street_source_tiles(cache_key,part,cached_at,payload_json) SELECT ?,json_extract(value,'$.part'),?,json_extract(value,'$.payload') FROM json_each(?)`).bind(cacheKey,cachedAt,JSON.stringify(chunk))),
    db.prepare('DELETE FROM street_source_tiles WHERE cache_key NOT IN(SELECT cache_key FROM street_source_tiles WHERE part=-1 ORDER BY cached_at DESC,cache_key DESC LIMIT 32)')];
  await db.batch(statements);
  return {...result,cacheHit:false};
}
