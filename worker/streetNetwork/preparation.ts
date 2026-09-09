import { addressBuildings, type AddressNode } from './addresses.ts';
import type { Area, DistributionTask, HouseTask, LngLat, PolygonGeometry } from '../../src/domain/campaign.ts';
import type { AreaTaskPreparationRun, AreaTaskPreparationOptions } from '../areaTaskPreparation.ts';
import { preparationProgress } from '../areaTaskPreparation.ts';
import { loadCampaignSnapshot, type D1DatabaseLike } from '../campaignRepository.ts';
import { buildRoadNetwork, associateHouses, interiorPoint, polygonOwnsPoint, polygonIntersects, type RoadInput } from './geometry.ts';
import { sha256Hex, reconcileServerPreparedStreetTasks, canonicalStreetFragmentGeometryJson } from './reconcile.ts';
import { requestDatabase } from '../requestDatabase.ts';
import { hasBaseStorage, restoreManualHouseParents } from './baseStorage.ts';
import { cachedSourceTile } from './sourceCache.ts';
import { jsonChunks, persistNetworkSnapshot } from './persistence.ts';

type Job = { generation:string;phase:string;cursor:number;lease:string|null;lease_until:string|null;attempts:number;metrics_json:string;geometry_json:string };
type Building = { osmId:number;tags:Record<string,string>;geometry:PolygonGeometry };
type Metrics = { cacheHits?:number; targetChunks?:{key:string;start:number;count:number}[]; addressMs?:number;normalizationMs?:number;parseMs?:number;tiles?:number;peakConcurrency?:number;tileTimings?:{kind:string;tile:number;bytes:number;elapsedMs:number;attempts:number}[]; lastError?:{phase:string;cursor:number;code:string;attempt:number}; roads?:number;houses?:number;addressableBuildings?:number;buildings?:number; requests?:number;retries?:number;bytes?:number;fetchMs?:number;graphMs?:number;linkMs?:number;publishMs?:number;sourceTimestamp?:string };
const DEFAULT_OVERPASS_URLS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
] as const;
const MAX_TRANSIENT_OVERPASS_ATTEMPTS = 3;
function isTransientOverpassCode(code:string) {
  return code==='overpass_rate_limited'||code==='overpass_timeout'||code==='overpass_transport_error'||/^overpass_http_5\d\d$/.test(code);
}
function normalizeOverpassError(error:unknown,timedOut:boolean) {
  if(timedOut)return new Error('overpass_timeout');
  if(error instanceof Error && /^(?:overpass_|osm_normalization_)/.test(error.message))return error;
  return new Error('overpass_transport_error');
}
export function preparationTiles(area: Area): [number,number,number,number][] {
  const points=area.geometry.coordinates.flat();
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  if (maxX-minX>2 || maxY-minY>2 || Math.abs(minY)>85 || Math.abs(maxY)>85) throw new Error('query_planning_area_budget');
  const tiles:[number,number,number,number][]=[];
  // A fixed geographic grid makes source tiles reusable after geometry edits.
  for(let iy=Math.floor(minY*100+1e-9);iy<Math.ceil(maxY*100-1e-9);iy++) for(let ix=Math.floor(minX*100+1e-9);ix<Math.ceil(maxX*100-1e-9);ix++) {
    const y=iy/100,x=ix/100,north=(iy+1)/100,east=(ix+1)/100;
    if(!polygonIntersects(area.geometry,{type:'Polygon',coordinates:[[[x,y],[east,y],[east,north],[x,north],[x,y]]]}))continue;
    tiles.push([y,x,north,east]);
    if(tiles.length>256) throw new Error('query_planning_tile_budget');
  }
  return tiles;
}
function checkedOverpassUrl(url:string) {
  const parsed=new URL(url);
  if(parsed.protocol!=='https:' && !(parsed.protocol==='http:' && ['localhost','127.0.0.1'].includes(parsed.hostname))) throw new Error('overpass_invalid_upstream');
  return url;
}
async function fetchTile(bbox:number[],kind:'roads'|'buildings',options:AreaTaskPreparationOptions,date?:string) {
  const urls=(options.upstreamUrl ? [options.upstreamUrl] : [...DEFAULT_OVERPASS_URLS]).map(checkedOverpassUrl);
  const started=performance.now();
  const selection=kind==='roads'?`way["highway"](${bbox.join(',')});`:`(way["building"](${bbox.join(',')});node["addr:housenumber"](${bbox.join(',')}));`;
  const query=`[out:json][timeout:15]${date?`[date:"${date}"]`:''};${selection}out body geom;`;
  let lastError:Error|undefined;
  for(let index=0;index<urls.length;index++) {
    const controller=new AbortController();let timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},options.limits?.timeoutMs ?? 18000);
    try {
      const response=await (options.fetchImpl ?? fetch)(urls[index],{method:'POST',body:new URLSearchParams({data:query}),signal:controller.signal});
      if(!response.ok) {
        const code=response.status===429?'overpass_rate_limited':`overpass_http_${response.status}`;
        try{await response.body?.cancel();}catch{/* ignore failed cleanup before retry/failover */}
        throw new Error(code);
      }
      const reader=response.body?.getReader(); if(!reader) throw new Error('overpass_partial_failure');
      const chunks:Uint8Array[]=[];let bytes=0;
      while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>(options.limits?.maxUpstreamBytes??4000000)){await reader.cancel();throw new Error('overpass_response_budget');}chunks.push(part.value);}
      const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
      const parseStarted=performance.now();
      let payload:any;
      try{payload=JSON.parse(new TextDecoder().decode(buffer));}catch{throw new Error('overpass_partial_failure');}
      if(payload.remark || !Array.isArray(payload.elements)) throw new Error('overpass_partial_failure');
      const parseMs=performance.now()-parseStarted;
      const normalizeStarted=performance.now();
      if(payload.elements.length>30000)throw new Error('osm_normalization_feature_budget');
      const features:(RoadInput|Building)[]=[];
      const addressNodes:AddressNode[]=[];
      for(const way of payload.elements){
        if(kind==='buildings' && way.type==='node' && way.tags?.['addr:housenumber']) {
          if(!Number.isSafeInteger(way.id)||!Number.isFinite(way.lon)||!Number.isFinite(way.lat)||Math.abs(way.lon)>180||Math.abs(way.lat)>85)throw new Error('osm_normalization_invalid_address');
          addressNodes.push({osmId:way.id,point:[way.lon,way.lat],tags:Object.fromEntries(Object.entries(way.tags).filter(([,v])=>typeof v==='string')) as Record<string,string>});
        }
        if(way.type!=='way')continue;
        if(!way.tags?.[kind==='roads'?'highway':'building'])continue;
        if(!Number.isSafeInteger(way.id) || !Array.isArray(way.geometry) || way.geometry.length<2) throw new Error('osm_normalization_missing_nodes');
        const coordinates:LngLat[]=way.geometry.map((p:{lon:number;lat:number})=>[p.lon,p.lat]);
        if(coordinates.some(p=>!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>85))throw new Error('osm_normalization_invalid_coordinate');
        const tags=Object.fromEntries(Object.entries(way.tags).filter(([,value])=>typeof value==='string')) as Record<string,string>;
        if(kind==='roads')features.push({osmId:way.id,tags,geometry:JSON.parse(canonicalStreetFragmentGeometryJson({type:'LineString',coordinates}))});
        else {
          if(coordinates.length<4 || JSON.stringify(coordinates[0])!==JSON.stringify(coordinates.at(-1)))throw new Error('osm_normalization_open_building');
          features.push({osmId:way.id,tags,geometry:{type:'Polygon',coordinates:[coordinates]}});
        }
      }
      const sourceTimestamp=payload.osm3s?.timestamp_osm_base;
      if(sourceTimestamp && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(sourceTimestamp))throw new Error('osm_normalization_timestamp');
      return {features,addressNodes,bytes,parseMs,normalizationMs:performance.now()-normalizeStarted,attempts:index+1,fetchMs:performance.now()-started,sourceTimestamp};
    } catch(error) {
      const normalized=normalizeOverpassError(error,timedOut);
      if(!options.upstreamUrl && isTransientOverpassCode(normalized.message) && index<urls.length-1){lastError=normalized;continue;}
      throw normalized;
    } finally {clearTimeout(timeout);}
  }
  throw lastError ?? new Error('overpass_transport_error');
}
async function staged<T>(db:D1DatabaseLike,run:AreaTaskPreparationRun,kind:string):Promise<T[]> {
  const rows=await db.prepare('SELECT payload_json FROM street_network_staging WHERE campaign_id=? AND area_id=? AND generation=? AND kind=? ORDER BY chunk_key').bind(run.campaignId,run.areaId,run.generation,kind).all<{payload_json:string}>();
  return rows.results.flatMap(row=>JSON.parse(row.payload_json) as T[]);
}

/** One request performs one bounded fetch, graph phase, house chunk or final transaction. */
export async function runNetworkPreparationStep(db:D1DatabaseLike,run:AreaTaskPreparationRun,options:AreaTaskPreparationOptions={}) {
  db=requestDatabase(db);
  const {campaignId,areaId,generation}=run; const scope=[campaignId,areaId,generation];
  const now=(options.now?.()??new Date()).toISOString(),lease=crypto.randomUUID();
  await db.batch([db.prepare(`INSERT INTO street_network_jobs(campaign_id,area_id,generation,geometry_json,phase) SELECT ?,?,?,?,'roads' WHERE EXISTS(SELECT 1 FROM area_task_preparations WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending') ON CONFLICT(campaign_id,area_id) DO UPDATE SET generation=excluded.generation,geometry_json=excluded.geometry_json,phase='roads',cursor=0,lease=NULL,lease_until=NULL,attempts=0,error_code=NULL,metrics_json='{}' WHERE street_network_jobs.generation<>excluded.generation`).bind(...scope,JSON.stringify(run.area.geometry),...scope)]);
  const claimed=await db.batch([db.prepare(`UPDATE street_network_jobs SET lease=?,lease_until=? WHERE campaign_id=? AND area_id=? AND generation=? AND phase<>'ready' AND (lease_until IS NULL OR lease_until<=?) AND EXISTS(SELECT 1 FROM area_task_preparations WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending')`).bind(lease,new Date(Date.parse(now)+60000).toISOString(),...scope,now,...scope)]);
  if(claimed[0]?.meta?.changes!==1)return {outcome:'pending' as const};
  const job=await db.prepare('SELECT * FROM street_network_jobs WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?').bind(...scope,lease).first<Job>();
  if(!job)return {outcome:'pending' as const};
  const metrics:Metrics=JSON.parse(job.metrics_json);
  const guard=`EXISTS(SELECT 1 FROM street_network_jobs WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?)`;
  const ownership=[...scope,lease];
  const save=async(kind:string,key:string,rows:unknown[])=>{
    const chunks=jsonChunks(rows);
    if (!chunks.length) return [];
    if(chunks.length>35)throw new Error('network_staging_batch_budget');
    await db.batch(chunks.map((chunk,i)=>db.prepare(`INSERT INTO street_network_staging(campaign_id,area_id,generation,kind,chunk_key,payload_json) SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(campaign_id,area_id,generation,kind,chunk_key) DO UPDATE SET payload_json=excluded.payload_json`).bind(...scope,kind,`${key}:${String(i).padStart(6,'0')}`,JSON.stringify(chunk),...ownership)));
    let start=0;return chunks.map((chunk,i)=>{const part={key:`${key}:${String(i).padStart(6,'0')}`,start,count:chunk.length};start+=chunk.length;return part;});
  };
  let phase=job.phase,cursor=job.cursor;
  try {
    const tiles=preparationTiles(run.area);
    metrics.tiles=tiles.length;metrics.peakConcurrency=1;
    if(phase==='roads'||phase==='buildings') {
      const kind=phase;
      const cacheEnabled=await hasBaseStorage(db);
      const sourceDate=metrics.sourceTimestamp??new Date(Date.parse(now)-3600000).toISOString().slice(0,10)+'T00:00:00Z';
      const result=cacheEnabled?await cachedSourceTile(db,{version:1,bbox:tiles[cursor],kind:phase,date:sourceDate,source:options.upstreamUrl??'default'},()=>fetchTile(tiles[cursor],kind,options,sourceDate)):{...await fetchTile(tiles[cursor],phase,options,metrics.sourceTimestamp),cacheHit:false};
      if(cacheEnabled)metrics.sourceTimestamp=sourceDate;
      metrics.cacheHits=(metrics.cacheHits??0)+(result.cacheHit?1:0);
      metrics.requests=(metrics.requests??0)+result.attempts;metrics.parseMs=(metrics.parseMs??0)+result.parseMs;metrics.normalizationMs=(metrics.normalizationMs??0)+result.normalizationMs;
      (metrics.tileTimings??=[]).push({kind:phase,tile:cursor,bytes:result.bytes,elapsedMs:result.fetchMs,attempts:result.attempts});metrics.bytes=(metrics.bytes??0)+result.bytes;metrics.fetchMs=(metrics.fetchMs??0)+result.fetchMs;metrics.sourceTimestamp??=result.sourceTimestamp;
      if(metrics.bytes>16000000)throw new Error('overpass_aggregate_budget');
      await save(phase,String(cursor).padStart(6,'0'),result.features);
      if(phase==='buildings')await save('addresses',String(cursor).padStart(6,'0'),result.addressNodes);
      if(++cursor>=tiles.length){phase=phase==='roads'?'graph':'addresses';cursor=0;}
    } else if(phase==='graph') {
      const begin=performance.now();
      const roads=await staged<RoadInput>(db,run,'roads');
      if(roads.length>20000)throw new Error('graph_source_budget');
      const tasks=await buildRoadNetwork({roads,area:run.area.geometry,campaignId,areaId,generation,timestamp:now});
      if(tasks.length>(options.maxRoadFragments??20000))throw new Error('graph_build_budget');
      metrics.roads=tasks.length;await save('edges','all',tasks);metrics.graphMs=performance.now()-begin;phase='buildings';cursor=0;
    } else if(phase==='addresses') {
      const begin=performance.now();
      const buildings=await staged<Building>(db,run,'buildings');
      const ordered=addressBuildings(buildings,await staged<AddressNode>(db,run,'addresses'));
      metrics.buildings=buildings.length;metrics.addressableBuildings=ordered.length;
      if(ordered.length>(options.maxBuildings??10000))throw new Error('house_assignment_budget');
      metrics.targetChunks=await save('targets','all',ordered);metrics.addressMs=performance.now()-begin;phase='link';cursor=0;
    } else if(phase==='link') {
      const begin=performance.now();
      const selectedChunks=metrics.targetChunks?.filter(chunk=>chunk.start<cursor+250&&chunk.start+chunk.count>cursor);
      const selectedRows=selectedChunks?await db.prepare("SELECT payload_json FROM street_network_staging WHERE campaign_id=? AND area_id=? AND generation=? AND kind='targets' AND chunk_key IN(SELECT value FROM json_each(?)) ORDER BY chunk_key").bind(...scope,JSON.stringify(selectedChunks.map(chunk=>chunk.key))).all<{payload_json:string}>():null;
      const ordered:ReturnType<typeof addressBuildings>=selectedRows?selectedRows.results.flatMap(row=>JSON.parse(row.payload_json)):await staged<ReturnType<typeof addressBuildings>[number]>(db,run,'targets');
      const localCursor=cursor-(selectedChunks?.[0]?.start??0);
      const houses:HouseTask[]=[];const addresses=new Map<string,string>();
      for(const building of ordered.slice(localCursor,localCursor+250)) {
        const point=interiorPoint(building.geometry);if(!polygonOwnsPoint(run.area.geometry,point))continue;
        const id=`task_house_auto_${await sha256Hex(JSON.stringify({campaignId,areaId,osmId:building.osmId,...(building.identityAddress?{address:building.identityAddress}:{})}))}`;
        houses.push({id,campaignId,areaId,taskType:'house',label:building.address.label,geometry:building.geometry,source:{dataset:'OpenStreetMap',objectType:'way',objectIds:[building.osmId]},areaPreparationGeneration:generation,parentStreetTaskId:null,status:'open',completedAt:null,createdAt:now,updatedAt:now});
        if(building.tags['addr:street'])addresses.set(id,building.tags['addr:street']);
      }
      const linked=associateHouses(await staged<DistributionTask>(db,run,'edges'),houses,addresses);
      metrics.houses=(metrics.houses??0)+linked.length;
      await save('houses',String(cursor).padStart(6,'0'),linked);metrics.linkMs=(metrics.linkMs??0)+performance.now()-begin;
      cursor+=250;if(cursor>=(metrics.addressableBuildings??ordered.length)){phase='publish';cursor=0;}
    } else if(phase==='publish') {
      const before=await loadCampaignSnapshot(db,campaignId,{includeCollection:false,areaId});if(!before)throw new Error('reconcile_campaign_missing');
      if(JSON.stringify(before.areas.find(area=>area.id===areaId)?.geometry)!==JSON.stringify(run.area.geometry))throw new Error('reconcile_stale_geometry');
      const prepared=await staged<DistributionTask>(db,run,'edges');
      const reconcile=await reconcileServerPreparedStreetTasks({existingTasks:before.tasks,preparedFragments:[],preparedTasks:prepared,campaignId,areaId,generation,timestamp:now,allowRemovedWork:await hasBaseStorage(db)});
      if(reconcile.outcome!=='ready')throw new Error('area_preparation_work_started');
      const preparedHouses=await staged<HouseTask>(db,run,'houses');
      const oldHouses=new Map((before.houseTasks??[]).map(h=>[h.id,h]));
      let houseTasks=[...(before.houseTasks??[]).filter(h=>h.areaId!==areaId||!h.areaPreparationGeneration),...preparedHouses.map(h=>{const prior=oldHouses.get(h.id);return prior?{...h,label:prior.label,status:prior.status,completedAt:prior.completedAt,createdAt:prior.createdAt}:h;})];
      if(await hasBaseStorage(db))houseTasks=await restoreManualHouseParents(db,campaignId,houseTasks,reconcile.afterTasks);
      const begin=performance.now();
      const result=await persistNetworkSnapshot(db,before,{...before,tasks:reconcile.afterTasks,houseTasks},{areaId,generation,preparing:true,timestamp:now,sourceTimestamp:metrics.sourceTimestamp,lease});
      if(!result.committed)throw new Error('reconcile_stale_or_worked');
      metrics.publishMs=performance.now()-begin;phase='ready';
      try{await options.onCommitted?.(db);}catch{/* durable feed remains authoritative */}
    }
    const checkpoint=await db.batch([db.prepare(`UPDATE street_network_jobs SET phase=?,cursor=?,lease=NULL,lease_until=NULL,attempts=0,error_code=NULL,metrics_json=? WHERE campaign_id=? AND area_id=? AND generation=? AND lease=? AND EXISTS(SELECT 1 FROM area_task_preparations WHERE campaign_id=? AND area_id=? AND generation=?)`).bind(phase,cursor,JSON.stringify(metrics),...ownership,...scope)]);
    if(checkpoint[0]?.meta?.changes===1)try{options.onProgress?.(run.area,{status:phase==='ready'?'ready':'pending',roadCount:metrics.roads??0,houseCount:metrics.houses??0,sourceTimestamp:metrics.sourceTimestamp??null,errorCode:null,updatedAt:now,progress:preparationProgress(phase,cursor,tiles.length,metrics,phase==='ready')});}catch{/* A socket failure cannot roll back durable progress. */}
    return phase==='ready'?{outcome:'ready' as const,roadCount:metrics.roads??0,houseCount:metrics.houses??0}:{outcome:'pending' as const};
  } catch(error) {
    const code=error instanceof Error && /^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'network_preparation_failure';
    const nextAttempts=job.attempts+1;
    metrics.lastError={phase,cursor,code,attempt:nextAttempts};
    const retryable=isTransientOverpassCode(code);
    metrics.retries=(metrics.retries??0)+1;
    await db.batch([db.prepare(`UPDATE street_network_jobs SET lease=NULL,lease_until=?,attempts=attempts+1,error_code=?,metrics_json=? WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?`).bind(new Date(Date.parse(now)+Math.min(60000,1000*2**Math.min(job.attempts,6)+Math.floor(Math.random()*250))).toISOString(),code,JSON.stringify(metrics),...ownership)]);
    return retryable && nextAttempts<MAX_TRANSIENT_OVERPASS_ATTEMPTS ? {outcome:'pending' as const} : {outcome:'failed' as const,code};
  }
}
