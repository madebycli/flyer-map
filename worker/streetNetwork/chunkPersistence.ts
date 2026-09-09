import type { CampaignSnapshot } from '../../src/domain/campaign.ts';
import type { D1DatabaseLike } from '../campaignRepository.ts';
import { rxdbChangeFeedEntriesForSnapshotDelta, rxdbChangeFeedStatements } from '../rxdbChangeFeed.ts';
import { basePreparationStatements, overlayStatements, boundedChunks } from './baseStorage.ts';
import type { NetworkEvent } from './events.ts';

export type NetworkPersistenceOptions={areaId:string;generation:string;preparing:boolean;timestamp:string;sourceTimestamp?:string;lease?:string;events?:NetworkEvent[];intent?:{id:string;fingerprint:string}};
export async function persistChunkSnapshot(db:D1DatabaseLike,before:CampaignSnapshot,after:CampaignSnapshot,options:NetworkPersistenceOptions){
  const campaignId=before.campaign.id,token=crypto.randomUUID();
  const area=before.areas.find(area=>area.id===options.areaId)!;
  const guard='EXISTS(SELECT 1 FROM campaigns WHERE id=? AND write_token=?)';
  const statements=[db.prepare(`UPDATE campaigns SET revision=?,write_token=?,updated_at=? WHERE id=? AND revision=?
    AND EXISTS(SELECT 1 FROM areas WHERE id=? AND campaign_id=? AND geometry_json=?)
    AND EXISTS(SELECT 1 FROM area_task_preparations WHERE campaign_id=? AND area_id=? AND generation=? AND status=?)
    ${options.preparing?'AND EXISTS(SELECT 1 FROM street_network_jobs WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?)':''}`)
    .bind(before.revision+1,token,options.timestamp,campaignId,before.revision,area.id,campaignId,JSON.stringify(area.geometry),campaignId,area.id,options.generation,options.preparing?'pending':'ready',...(options.preparing?[campaignId,area.id,options.generation,options.lease]:[]))];
  const previous=new Map([...before.tasks,...before.houseTasks??[]].map(entity=>[entity.id,entity]));
  const changed=[...after.tasks,...after.houseTasks??[]].filter(entity=>entity.areaId===area.id&&JSON.stringify(previous.get(entity.id))!==JSON.stringify(entity));
  if(options.preparing){
    const base=await basePreparationStatements(db,before,after,area.id,options.generation,token);
    statements.push(...base.statements);
    // Preserve user work even if reconciliation removes an entity from the new
    // visible base. Overlay identity remains stable until the Area is deleted.
    const workById=new Map([...previous.values(),...after.tasks,...after.houseTasks??[]].filter(entity=>entity.areaId===area.id&&entity.areaPreparationGeneration&&(entity.status!=='open'||entity.taskType==='street'&&Boolean(entity.network?.coverage.length))).map(entity=>[entity.id,entity]));
    const worked=[...workById.values()];
    statements.push(...await overlayStatements(db,campaignId,area.id,worked,token));
    statements.push(db.prepare(`UPDATE area_task_preparations SET status='ready',source_timestamp=?,road_count=?,house_count=?,ready_at=?,updated_at=?,last_error_code=NULL WHERE campaign_id=? AND area_id=? AND generation=? AND ${guard}`)
      .bind(options.sourceTimestamp??null,after.tasks.filter(task=>task.areaId===area.id&&task.network).length,(after.houseTasks??[]).filter(house=>house.areaId===area.id&&house.areaPreparationGeneration).length,options.timestamp,options.timestamp,campaignId,area.id,options.generation,campaignId,token));
  }else{
    statements.push(...await overlayStatements(db,campaignId,area.id,changed,token));
  }
  const changes=rxdbChangeFeedEntriesForSnapshotDelta(before,{...after,revision:before.revision+1});
  statements.push(...rxdbChangeFeedStatements(db,campaignId,token,options.timestamp,changes,true));
  if(options.intent)statements.push(db.prepare(`INSERT INTO street_network_intents(campaign_id,intent_id,fingerprint,revision) SELECT ?,?,?,? WHERE ${guard}`).bind(campaignId,options.intent.id,options.intent.fingerprint,before.revision+1,campaignId,token));
  // Retain every history event and its dedupe identity, but bind bounded JSON
  // batches so history-enabled campaigns do not exceed the invocation query cap.
  for(const chunk of boundedChunks(options.events??[],800_000))statements.push(db.prepare(`INSERT INTO domain_events(id,campaign_id,team_id,field_session_id,entity_type,entity_id,event_type,occurred_at,actor_kind,actor_ref,payload_version,payload_json,dedupe_key,created_at)
    SELECT json_extract(value,'$.id'),?,json_extract(value,'$.teamId'),json_extract(value,'$.fieldSessionId'),json_extract(value,'$.entityType'),json_extract(value,'$.entityId'),json_extract(value,'$.eventType'),json_extract(value,'$.occurredAt'),json_extract(value,'$.actorKind'),json_extract(value,'$.actorRef'),1,json_extract(value,'$.payload'),json_extract(value,'$.dedupeKey'),? FROM json_each(?) WHERE ${guard}`)
    .bind(campaignId,options.timestamp,JSON.stringify(chunk),campaignId,token));
  if(statements.length>35)throw new Error('network_transaction_budget');
  const result=await db.batch(statements);
  return {committed:result[0]?.meta?.changes===1,revision:before.revision+1,statements:statements.length,taskWrites:changed.filter(entity=>entity.taskType==='street').length,houseWrites:changed.filter(entity=>entity.taskType==='house').length,feedWrites:changes.length};
}
