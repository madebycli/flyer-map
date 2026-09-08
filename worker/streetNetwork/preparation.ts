import type { Area, DistributionTask, HouseTask, LngLat, PolygonGeometry } from '../../src/domain/campaign.ts';
import type { AreaTaskPreparationRun, AreaTaskPreparationOptions } from '../areaTaskPreparation.ts';
import { loadCampaignSnapshot, type D1DatabaseLike } from '../campaignRepository.ts';
import { buildRoadNetwork, associateHouses, interiorPoint, clipNetworkLines, type RoadInput } from './geometry.ts';
import { sha256Hex, reconcileServerPreparedStreetTasks, canonicalStreetFragmentGeometryJson } from './reconcile.ts';
import { jsonChunks, persistNetworkSnapshot } from './persistence.ts';
import { pointInOrOnPolygon } from '../../src/domain/areaTaskPreparation.ts';

type Job = { generation:string;phase:string;cursor:number;lease:string|null;lease_until:string|null;attempts:number;metrics_json:string;geometry_json:string };
type Building = { osmId:number;tags:Record<string,string>;geometry:PolygonGeometry };
type Metrics = { requests?:number;retries?:number;bytes?:number;fetchMs?:number;graphMs?:number;linkMs?:number;publishMs?:number;sourceTimestamp?:string };
export function preparationTiles(area: Area): [number,number,number,number][] {
  const points=area.geometry.coordinates.flat();
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  if (maxX-minX>2 || maxY-minY>2 || Math.abs(minY)>85 || Math.abs(maxY)>85) throw new Error('query_planning_area_budget');
  const tiles:[number,number,number,number][]=[];
  const dy=0.01,dx=0.01/Math.cos((minY+maxY)/2*Math.PI/180);
  for(let y=minY;y<maxY;y+=dy) for(let x=minX;x<maxX;x+=dx) {
    tiles.push([y,x,Math.min(maxY,y+dy),Math.min(maxX,x+dx)]);
    if(tiles.length>256) throw new Error('query_planning_tile_budget');
  }
  return tiles;
}
async function fetchTile(bbox:number[],kind:'roads'|'buildings',options:AreaTaskPreparationOptions,date?:string) {
  const url=options.upstreamUrl ?? 'https://overpass-api.de/api/interpreter';
  const parsed=new URL(url);
  if(parsed.protocol!=='https:' && !(parsed.protocol==='http:' && ['localhost','127.0.0.1'].includes(parsed.hostname))) throw new Error('overpass_invalid_upstream');
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),options.limits?.timeoutMs ?? 18000);
  const started=performance.now();
  try {
    const query=`[out:json][timeout:15]${date?`[date:"${date}"]`:''};way["${kind==='roads'?'highway':'building'}"](${bbox.join(',')});out body geom;`;
    const response=await (options.fetchImpl ?? fetch)(url,{method:'POST',body:new URLSearchParams({data:query}),signal:controller.signal});
    if(!response.ok) throw new Error(response.status===429?'overpass_rate_limited':`overpass_http_${response.status}`);
    const reader=response.body?.getReader(); if(!reader) throw new Error('overpass_partial_failure');
    const chunks:Uint8Array[]=[];let bytes=0;
    while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>(options.limits?.maxUpstreamBytes??4000000)){await reader.cancel();throw new Error('overpass_response_budget');}chunks.push(part.value);}
    const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
    const payload=JSON.parse(new TextDecoder().decode(buffer));
    if(payload.remark || !Array.isArray(payload.elements)) throw new Error('overpass_partial_failure');
    const features:(RoadInput|Building)[]=[];
    for(const way of payload.elements){
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
    return {features,bytes,fetchMs:performance.now()-started,sourceTimestamp};
  } finally {clearTimeout(timeout);}
}
async function staged<T>(db:D1DatabaseLike,run:AreaTaskPreparationRun,kind:string):Promise<T[]> {
  const rows=await db.prepare('SELECT payload_json FROM street_network_staging WHERE campaign_id=? AND area_id=? AND generation=? AND kind=? ORDER BY chunk_key').bind(run.campaignId,run.areaId,run.generation,kind).all<{payload_json:string}>();
  return rows.results.flatMap(row=>JSON.parse(row.payload_json) as T[]);
}

/** One request performs one bounded fetch, graph phase, house chunk or final transaction. */
export async function runNetworkPreparationStep(db:D1DatabaseLike,run:AreaTaskPreparationRun,options:AreaTaskPreparationOptions={}) {
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
    if (!chunks.length) return;
    await db.batch(chunks.map((chunk,i)=>db.prepare(`INSERT INTO street_network_staging(campaign_id,area_id,generation,kind,chunk_key,payload_json) SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(campaign_id,area_id,generation,kind,chunk_key) DO UPDATE SET payload_json=excluded.payload_json`).bind(...scope,kind,`${key}:${String(i).padStart(6,'0')}`,JSON.stringify(chunk),...ownership)));
  };
  let phase=job.phase,cursor=job.cursor;
  try {
    const tiles=preparationTiles(run.area);
    if(phase==='roads'||phase==='buildings') {
      const result=await fetchTile(tiles[cursor],phase,options,metrics.sourceTimestamp);
      metrics.requests=(metrics.requests??0)+1;metrics.bytes=(metrics.bytes??0)+result.bytes;metrics.fetchMs=(metrics.fetchMs??0)+result.fetchMs;metrics.sourceTimestamp??=result.sourceTimestamp;
      if(metrics.bytes>64000000)throw new Error('overpass_aggregate_budget');
      await save(phase,String(cursor).padStart(6,'0'),result.features);
      if(++cursor>=tiles.length){phase=phase==='roads'?'graph':'link';cursor=0;}
    } else if(phase==='graph') {
      const begin=performance.now();
      const tasks=await buildRoadNetwork({roads:await staged<RoadInput>(db,run,'roads'),area:run.area.geometry,campaignId,areaId,generation,timestamp:now});
      if(tasks.length>(options.maxRoadFragments??20000))throw new Error('graph_build_budget');
      await save('edges','all',tasks);metrics.graphMs=performance.now()-begin;phase='buildings';cursor=0;
    } else if(phase==='link') {
      const begin=performance.now();
      const buildings=await staged<Building>(db,run,'buildings');
      const byId=new Map<number,Building>();
      for(const building of buildings){const prior=byId.get(building.osmId);if(prior && JSON.stringify(prior)!==JSON.stringify(building))throw new Error('house_dedupe_conflict');byId.set(building.osmId,building);}
      const ordered=[...byId.values()].sort((a,b)=>a.osmId-b.osmId);
      if(ordered.length>(options.maxBuildings??50000))throw new Error('house_assignment_budget');
      const houses:HouseTask[]=[];const addresses=new Map<string,string>();
      for(const building of ordered.slice(cursor,cursor+250)) {
        const point=interiorPoint(building.geometry);if(!pointInOrOnPolygon(point,run.area.geometry))continue;
        const id=`task_house_auto_${await sha256Hex(JSON.stringify({campaignId,areaId,osmId:building.osmId}))}`;
        houses.push({id,campaignId,areaId,taskType:'house',label:[building.tags['addr:street'],building.tags['addr:housenumber']].filter(Boolean).join(' ')||'Haus',geometry:building.geometry,source:{dataset:'OpenStreetMap',objectType:'way',objectIds:[building.osmId]},areaPreparationGeneration:generation,parentStreetTaskId:null,status:'open',completedAt:null,createdAt:now,updatedAt:now});
        if(building.tags['addr:street'])addresses.set(id,building.tags['addr:street']);
      }
      const linked=associateHouses(await staged<DistributionTask>(db,run,'edges'),houses,addresses);
      await save('houses',String(cursor).padStart(6,'0'),linked);metrics.linkMs=(metrics.linkMs??0)+performance.now()-begin;
      cursor+=250;if(cursor>=ordered.length){phase='publish';cursor=0;}
    } else if(phase==='publish') {
      const before=await loadCampaignSnapshot(db,campaignId);if(!before)throw new Error('reconcile_campaign_missing');
      if(JSON.stringify(before.areas.find(area=>area.id===areaId)?.geometry)!==JSON.stringify(run.area.geometry))throw new Error('reconcile_stale_geometry');
      const prepared=await staged<DistributionTask>(db,run,'edges');
      const reconcile=await reconcileServerPreparedStreetTasks({existingTasks:before.tasks,preparedFragments:[],preparedTasks:prepared,campaignId,areaId,generation,timestamp:now});
      if(reconcile.outcome!=='ready')throw new Error('area_preparation_work_started');
      const preparedHouses=await staged<HouseTask>(db,run,'houses');
      const oldHouses=new Map((before.houseTasks??[]).map(h=>[h.id,h]));
      const houseTasks=[...(before.houseTasks??[]).filter(h=>h.areaId!==areaId||!h.areaPreparationGeneration),...preparedHouses.map(h=>{const prior=oldHouses.get(h.id);return prior?{...h,label:prior.label,status:prior.status,completedAt:prior.completedAt,createdAt:prior.createdAt}:h;})];
      const begin=performance.now();
      const result=await persistNetworkSnapshot(db,before,{...before,tasks:reconcile.afterTasks,houseTasks},{areaId,generation,preparing:true,timestamp:now,sourceTimestamp:metrics.sourceTimestamp,lease});
      if(!result.committed)throw new Error('reconcile_stale_or_worked');
      metrics.publishMs=performance.now()-begin;phase='ready';
      try{await options.onCommitted?.();}catch{/* durable feed remains authoritative */}
    }
    await db.batch([db.prepare(`UPDATE street_network_jobs SET phase=?,cursor=?,lease=NULL,lease_until=NULL,error_code=NULL,metrics_json=? WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?`).bind(phase,cursor,JSON.stringify(metrics),...ownership)]);
    return phase==='ready'?{outcome:'ready' as const}:{outcome:'pending' as const};
  } catch(error) {
    const code=error instanceof Error && /^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'network_preparation_failure';
    metrics.retries=(metrics.retries??0)+1;
    await db.batch([db.prepare(`UPDATE street_network_jobs SET lease=NULL,lease_until=?,attempts=attempts+1,error_code=?,metrics_json=? WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?`).bind(new Date(Date.parse(now)+Math.min(60000,1000*2**Math.min(job.attempts,6))).toISOString(),code,JSON.stringify(metrics),...ownership)]);
    return {outcome:'failed' as const,code};
  }
}
