import type { D1DatabaseLike } from '../campaignRepository.ts';

type PreparationStatus = 'pending' | 'ready' | 'failed';
type DiagnosticRow = { generation:string;status:PreparationStatus;road_count:number;house_count:number;started_at:string|null;ready_at:string|null;failed_at:string|null;updated_at:string;phase:string|null;cursor:number|null;attempts:number|null;error_code:string|null;lease_until:string|null;metrics_json:string|null };
type SafeSourceAttempt = { endpoint:string;providerAttempt:number;kind:'roads'|'buildings';status:number|null;contentType:string|null;contentLength:number|null;retryAfterSeconds:number|null;responseType:string;remark:string|null;bytes:number;elapsedMs:number;aborted:boolean;code:string|null };

const SHA256 = /^[0-9a-f]{64}$/;
const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null;
const integer=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)?value:null;
const text=(value:unknown)=>typeof value==='string'?value:null;
const hash=(value:unknown)=>{const candidate=text(value);return candidate&&SHA256.test(candidate)?candidate:null;};
const hashes=(value:unknown)=>Array.isArray(value)?value.slice(0,512).flatMap((entry)=>{const candidate=hash(entry);return candidate?[candidate]:[]}):[];
const v4Code=(value:unknown)=>typeof value==='string'?value.replace(/^street_engine_v3_/u,'street_engine_v4_'):value;
const v4Phase=(value:unknown)=>value==='v3-source'?'v4-source':value;

function safeSourceAttempt(value:unknown):SafeSourceAttempt|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const row=value as Record<string,unknown>;const kind=row.kind==='roads'||row.kind==='buildings'?row.kind:null;const endpoint=text(row.endpoint);const providerAttempt=integer(row.providerAttempt);
  if(!kind||!endpoint||providerAttempt===null)return null;
  return {endpoint,providerAttempt,kind,status:integer(row.status),contentType:text(row.contentType),contentLength:finite(row.contentLength),retryAfterSeconds:finite(row.retryAfterSeconds),responseType:text(row.responseType)??'unavailable',remark:text(row.remark),bytes:finite(row.bytes)??0,elapsedMs:finite(row.elapsedMs)??0,aborted:row.aborted===true,code:text(row.code)};
}
function safeQuality(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const row=value as Record<string,unknown>;const samples=Array.isArray(row.samples)?row.samples.slice(0,10).flatMap((sample)=>{if(!sample||typeof sample!=='object'||Array.isArray(sample))return[];const item=sample as Record<string,unknown>;return[{osmId:integer(item.osmId),tile:integer(item.tile)??0,reason:text(item.reason)??'unknown'}];}):[];
  return {receivedBuildings:finite(row.receivedBuildings)??0,acceptedBuildings:finite(row.acceptedBuildings)??0,rejectedBuildings:finite(row.rejectedBuildings)??0,emptyBuildingTiles:finite(row.emptyBuildingTiles)??0,samples};
}
function safeTileTimings(value:unknown){
  if(!Array.isArray(value))return[];return value.slice(-512).flatMap((entry)=>{if(!entry||typeof entry!=='object'||Array.isArray(entry))return[];const row=entry as Record<string,unknown>;const kind=row.kind==='roads'||row.kind==='buildings'?row.kind:null;const tile=integer(row.tile);if(!kind||tile===null)return[];return[{kind,tile,bytes:finite(row.bytes)??0,elapsedMs:finite(row.elapsedMs)??0,attempts:integer(row.attempts)??0}];});
}
function safeAttempts(value:unknown){return Array.isArray(value)?value.slice(-8).map(safeSourceAttempt).filter((item):item is SafeSourceAttempt=>item!==null):[];}

function safeMetrics(raw:string|null){
  let metrics:Record<string,unknown>={};
  if(raw)try{const parsed=JSON.parse(raw) as unknown;if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))metrics=parsed as Record<string,unknown>;}catch{/* diagnostics stay available */}
  const lastError=metrics.lastError&&typeof metrics.lastError==='object'&&!Array.isArray(metrics.lastError)?metrics.lastError as Record<string,unknown>:null;
  const engineVersion=metrics.engineVersion==='v4'||metrics.engineVersion==='sourcepack-v3'?'v4':'legacy';
  const algorithm=text(metrics.algorithmVersion)?.replace(/^v3-/u,'v4-')??null;
  return {
    engineVersion,
    sourcePolicy:engineVersion==='v4'?'immutable-source-pack/no-live-overpass':'legacy',
    manifestHash:hash(metrics.manifestHash),sourcePackVersion:text(metrics.sourcePackVersion),algorithmVersion:algorithm,selectedShardIds:hashes(metrics.selectedShardIds),shardCount:integer(metrics.shardCount)??0,objectGets:integer(metrics.objectGets)??0,compressedBytes:finite(metrics.compressedBytes)??0,decodedBytes:finite(metrics.decodedBytes)??0,legacyOverpassRequests:engineVersion==='v4'?integer(metrics.legacyOverpassRequests)??0:null,resultHash:hash(metrics.resultHash),
    tiles:integer(metrics.tiles),cacheHits:finite(metrics.cacheHits)??0,cacheMisses:finite(metrics.cacheMisses)??0,requests:finite(metrics.requests)??0,retries:finite(metrics.retries)??0,bytes:finite(metrics.bytes)??0,observedSourceBytes:finite(metrics.observedSourceBytes)??0,
    activeMs:finite(metrics.activeMs),sourceMs:finite(metrics.sourceMs)??0,fetchMs:finite(metrics.fetchMs)??0,parseMs:finite(metrics.parseMs)??0,normalizationMs:finite(metrics.normalizationMs)??0,graphMs:finite(metrics.graphMs)??0,addressMs:finite(metrics.addressMs)??0,linkMs:finite(metrics.linkMs)??0,publishMs:finite(metrics.publishMs)??0,
    roads:finite(metrics.roads)??0,buildings:finite(metrics.buildings)??0,addressableBuildings:finite(metrics.addressableBuildings)??0,houses:finite(metrics.houses)??0,sourceTimestamp:text(metrics.sourceTimestamp),tileTimings:safeTileTimings(metrics.tileTimings),lastSourceAttempts:engineVersion==='v4'?[]:safeAttempts(metrics.lastSourceAttempts),quality:safeQuality(metrics.quality),
    lastError:lastError?{phase:String(v4Phase(text(lastError.phase)??'unknown')),cursor:integer(lastError.cursor)??0,code:String(v4Code(text(lastError.code)??'unknown')),attempt:integer(lastError.attempt)??0,sourceAttempts:engineVersion==='v4'?[]:safeAttempts(lastError.sourceAttempts),quality:safeQuality(lastError.quality)}:null,
  };
}
function parsedTime(value:string|null){if(!value)return null;const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:null;}

/** Read-only, allowlisted projection. V4 never returns geometry, source object bodies, credentials or provider URLs. */
export async function getStreetEngineDiagnosticSnapshot(db:D1DatabaseLike,campaignId:string,areaId:string){
  const row=await db.prepare(`SELECT p.generation,p.status,p.road_count,p.house_count,p.started_at,p.ready_at,p.failed_at,p.updated_at,j.phase,j.cursor,j.attempts,j.error_code,j.lease_until,j.metrics_json FROM area_task_preparations p LEFT JOIN street_network_jobs j ON j.campaign_id=p.campaign_id AND j.area_id=p.area_id AND j.generation=p.generation WHERE p.campaign_id=? AND p.area_id=?`).bind(campaignId,areaId).first<DiagnosticRow>();
  if(!row)return null;
  const now=Date.now(),started=parsedTime(row.started_at),finished=parsedTime(row.ready_at??row.failed_at),leaseUntil=parsedTime(row.lease_until),updated=parsedTime(row.updated_at),metrics=safeMetrics(row.metrics_json),wallElapsedMs=started===null?null:Math.max(0,(finished??now)-started),activeElapsedMs=metrics.activeMs;
  return {generation:row.generation,status:row.status,engineVersion:metrics.engineVersion,phase:String(v4Phase(row.phase??'queued')),cursor:row.cursor??0,attempts:row.attempts??0,errorCode:v4Code(row.error_code),leaseUntil:row.lease_until,retryWaitRemainingMs:leaseUntil===null?0:Math.max(0,leaseUntil-now),startedAt:row.started_at,finishedAt:row.ready_at??row.failed_at,updatedAt:row.updated_at,elapsedMs:activeElapsedMs??wallElapsedMs,activeElapsedMs,wallElapsedMs,staleForMs:updated===null?null:Math.max(0,now-updated),roadCount:row.road_count,houseCount:row.house_count,metrics};
}
