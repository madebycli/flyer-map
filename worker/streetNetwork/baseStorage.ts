import type { CampaignSnapshot, DistributionTask, HouseTask } from '../../src/domain/campaign.ts';
import type { D1DatabaseLike, D1PreparedStatement } from '../campaignRepository.ts';
import { sha256Hex } from './reconcile.ts';

export type PreparedEntity = DistributionTask | HouseTask;
type Work = Pick<PreparedEntity,'label'|'status'|'completedAt'|'createdAt'|'updatedAt'> & {coverage?: NonNullable<DistributionTask['network']>['coverage']};
type Overlay = Record<string,Work>;
const encoder = new TextEncoder();
export function boundedChunks<T>(rows: readonly T[], limit=220_000): T[][] {
  const chunks:T[][]=[];let chunk:T[]=[],bytes=2;
  for(const row of rows){
    const size=encoder.encode(JSON.stringify(row)).length+1;
    if(size>limit)throw new Error('network_row_budget_exceeded');
    if(bytes+size>limit){chunks.push(chunk);chunk=[];bytes=2;}
    chunk.push(row);bytes+=size;
  }
  if(chunk.length)chunks.push(chunk);
  return chunks;
}
export async function hasBaseStorage(db:D1DatabaseLike){
  const row=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='street_base_chunks'").first<{name:string}>();
  return row?.name==='street_base_chunks';
}
// Stable partitions bound overlay writes without a secondary row/index per House.
export function workBucket(id:string){let hash=2166136261;for(const char of id)hash=Math.imul(hash^char.charCodeAt(0),16777619);return (hash>>>0)%16;}
function workOf(entity:PreparedEntity):Work{
  return {label:entity.label,status:entity.status,completedAt:entity.completedAt,createdAt:entity.createdAt,updatedAt:entity.updatedAt,...(entity.taskType==='street'&&entity.network?{coverage:entity.network.coverage}:{})};
}
function applyWork(entity:PreparedEntity,work:Work|undefined):PreparedEntity{
  if(!work)return entity;
  const {coverage,...fields}=work;
  return {...entity,...fields,...(entity.taskType==='street'&&entity.network&&coverage?{network:{...entity.network,coverage}}:{})};
}
export async function readPreparedEntities(db:D1DatabaseLike,campaignId:string,areaId?:string,houseId?:string):Promise<PreparedEntity[]>{
  const filter=areaId?' AND c.area_id=?':'';
  const entityFilter=houseId?" AND (c.kind='street' OR (c.kind='house' AND c.bucket=?))":'';
  const values=areaId?[campaignId,areaId]:[campaignId];
  const [chunks,overlays]=await Promise.all([
    db.prepare(`SELECT c.area_id,c.payload_json,a.generation FROM street_base_chunks c JOIN street_base_areas a ON a.campaign_id=c.campaign_id AND a.area_id=c.area_id WHERE c.campaign_id=?${filter}${entityFilter}`).bind(...values,...(houseId?[workBucket(houseId)]:[])).all<{area_id:string;payload_json:string;generation:string}>(),
    db.prepare(`SELECT c.area_id,c.payload_json FROM street_work_overlays c WHERE c.campaign_id=?${filter}`).bind(...values).all<{area_id:string;payload_json:string}>(),
  ]);
  const work=new Map<string,Overlay>();
  for(const row of overlays.results)work.set(row.area_id,{...work.get(row.area_id),...JSON.parse(row.payload_json)});
  return chunks.results.flatMap(row=>(JSON.parse(row.payload_json) as PreparedEntity[]).filter(entity=>!houseId||entity.taskType==='street'||entity.id===houseId).map(entity=>applyWork({...entity,areaPreparationGeneration:row.generation},work.get(row.area_id)?.[entity.id])));
}
export async function restoreManualHouseParents(db:D1DatabaseLike,campaignId:string,houses:HouseTask[],tasks:DistributionTask[]){
  const manual=houses.filter(h=>!h.areaPreparationGeneration);if(!manual.length)return houses;
  const rows=await db.prepare('SELECT house_id,area_id,parent_task_id FROM street_manual_house_parents WHERE campaign_id=? AND house_id IN(SELECT value FROM json_each(?))').bind(campaignId,JSON.stringify(manual.map(h=>h.id))).all<{house_id:string;area_id:string;parent_task_id:string}>();
  const links=new Map(rows.results.map(row=>[row.house_id,row]));const parents=new Map(tasks.map(task=>[task.id,task]));
  return houses.map(h=>{const link=links.get(h.id);const parentId=link?.parent_task_id??h.parentStreetTaskId;if(!parentId)return h;const parent=parents.get(parentId);return {...h,parentStreetTaskId:parent?.areaId===h.areaId?parent.id:null};});
}
export async function mergePreparedSnapshot(db:D1DatabaseLike,snapshot:CampaignSnapshot,areaId?:string,houseId?:string):Promise<CampaignSnapshot>{
  if(!await hasBaseStorage(db))return snapshot;
  const entities=await readPreparedEntities(db,snapshot.campaign.id,areaId,houseId);
  const ids=new Set(entities.map(entity=>entity.id));
  const tasks=[...snapshot.tasks.filter(task=>!ids.has(task.id)),...entities.filter((entity):entity is DistributionTask=>entity.taskType==='street')];
  const houses=[...(snapshot.houseTasks??[]).filter(house=>!ids.has(house.id)),...entities.filter((entity):entity is HouseTask=>entity.taskType==='house')];
  return {...snapshot,tasks,houseTasks:await restoreManualHouseParents(db,snapshot.campaign.id,houses,tasks)};
}
export async function overlayStatements(db:D1DatabaseLike,campaignId:string,areaId:string,entities:PreparedEntity[],token:string):Promise<D1PreparedStatement[]>{
  if(!entities.length)return [];
  const buckets=[...new Set(entities.map(entity=>workBucket(entity.id)))];
  const existing=await db.prepare('SELECT bucket,payload_json FROM street_work_overlays WHERE campaign_id=? AND area_id=? AND bucket IN (SELECT value FROM json_each(?))').bind(campaignId,areaId,JSON.stringify(buckets)).all<{bucket:number;payload_json:string}>();
  const byBucket=new Map(existing.results.map(row=>[row.bucket,JSON.parse(row.payload_json) as Overlay]));
  for(const entity of entities){const bucket=workBucket(entity.id);const work=byBucket.get(bucket)??{};work[entity.id]=workOf(entity);byBucket.set(bucket,work);}
  const rows=[...byBucket].map(([bucket,work])=>({bucket,payload:JSON.stringify(work)}));
  return boundedChunks(rows,1_000_000).map(chunk=>db.prepare(`INSERT INTO street_work_overlays(campaign_id,area_id,bucket,payload_json)
    SELECT ?,?,json_extract(value,'$.bucket'),json_extract(value,'$.payload') FROM json_each(?)
    WHERE EXISTS(SELECT 1 FROM campaigns WHERE id=? AND write_token=?)
    ON CONFLICT(campaign_id,area_id,bucket) DO UPDATE SET payload_json=excluded.payload_json WHERE street_work_overlays.payload_json<>excluded.payload_json`).bind(campaignId,areaId,JSON.stringify(chunk),campaignId,token));
}
export async function basePreparationStatements(db:D1DatabaseLike,before:CampaignSnapshot,after:CampaignSnapshot,areaId:string,generation:string,token:string){
  const campaignId=before.campaign.id;
  const old=new Map([...before.tasks,...before.houseTasks??[]].map(entity=>[entity.id,entity]));
  const existing=await db.prepare('SELECT content_hash,payload_json FROM street_base_chunks WHERE campaign_id=? AND area_id=?').bind(campaignId,areaId).all<{content_hash:string;payload_json:string}>();
  const oldBase=new Map(existing.results.flatMap(row=>JSON.parse(row.payload_json) as PreparedEntity[]).map(entity=>[entity.id,entity]));
  const entities=[...after.tasks,...after.houseTasks??[]].filter(entity=>entity.areaId===areaId&&entity.areaPreparationGeneration);
  const partitions=new Map<string,PreparedEntity[]>();
  for(const entity of entities){
    const prior=old.get(entity.id);
    // Generation is manifest-owned. Unchanged content does not get rewritten merely
    // because a surrounding Area was expanded or shrunk.
    const base=oldBase.get(entity.id);
    const stable={...entity,label:base?.label??entity.label,status:'open' as const,completedAt:null,areaPreparationGeneration:null,updatedAt:base?.updatedAt??prior?.createdAt??entity.createdAt,...(entity.taskType==='street'&&entity.network?{network:{...entity.network,coverage:[]}}:{})};
    const partition=entity.taskType+':'+workBucket(entity.id);const rows=partitions.get(partition)??[];rows.push(stable);partitions.set(partition,rows);
  }
  const rows=[];
  for(const [partition,entities] of [...partitions].sort((a,b)=>a[0].localeCompare(b[0]))){
    const [kind,bucketText]=partition.split(':');const bucket=Number(bucketText);
    entities.sort((a,b)=>a.id.localeCompare(b.id));
    for(const chunk of boundedChunks(entities)){
      const payload=JSON.stringify(chunk);rows.push({kind,bucket,payload,hash:await sha256Hex(payload)});
    }
  }
  const hashes=new Set(existing.results.map(row=>row.content_hash));
  const guard='EXISTS(SELECT 1 FROM campaigns WHERE id=? AND write_token=?)';
  const statements=boundedChunks(rows.filter(row=>!hashes.has(row.hash)),1_500_000).map(chunk=>db.prepare(`INSERT INTO street_base_chunks(campaign_id,area_id,content_hash,kind,bucket,payload_json)
    SELECT ?,?,json_extract(value,'$.hash'),json_extract(value,'$.kind'),json_extract(value,'$.bucket'),json_extract(value,'$.payload') FROM json_each(?) WHERE ${guard}`).bind(campaignId,areaId,JSON.stringify(chunk),campaignId,token));
  statements.push(db.prepare(`DELETE FROM street_base_chunks WHERE campaign_id=? AND area_id=? AND content_hash NOT IN(SELECT value FROM json_each(?)) AND ${guard}`).bind(campaignId,areaId,JSON.stringify(rows.map(row=>row.hash)),campaignId,token));
  statements.push(db.prepare(`INSERT INTO street_base_areas(campaign_id,area_id,generation) SELECT ?,?,? WHERE ${guard} ON CONFLICT(campaign_id,area_id) DO UPDATE SET generation=excluded.generation`).bind(campaignId,areaId,generation,campaignId,token));
  // Preserve manual references before legacy automatic Street rows are removed.
  const legacyParents=new Set(before.tasks.filter(t=>t.areaId===areaId&&t.areaPreparationGeneration).map(t=>t.id));
  const manualLinks=(before.houseTasks??[]).filter(h=>h.areaId===areaId&&!h.areaPreparationGeneration&&h.parentStreetTaskId&&legacyParents.has(h.parentStreetTaskId));
  if(manualLinks.length)statements.push(db.prepare(`INSERT INTO street_manual_house_parents(campaign_id,house_id,area_id,parent_task_id)
    SELECT ?,json_extract(value,'$.id'),?,json_extract(value,'$.parentStreetTaskId') FROM json_each(?) WHERE ${guard}
    ON CONFLICT(campaign_id,house_id) DO UPDATE SET parent_task_id=excluded.parent_task_id`)
    .bind(campaignId,areaId,JSON.stringify(manualLinks),campaignId,token));
  // An existing candidate may still have legacy prepared rows. Remove only those
  // represented by the newly committed base, under the same revision guard.
  for(const table of ['house_tasks','tasks'])statements.push(db.prepare(`DELETE FROM ${table} WHERE campaign_id=? AND area_id=? AND area_preparation_generation IS NOT NULL AND ${guard}`).bind(campaignId,areaId,campaignId,token));
  return {statements,baseRows:rows.length};
}
