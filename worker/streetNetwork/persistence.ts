import type { NetworkEvent } from './events.ts';
import type { CampaignSnapshot, DistributionTask, HouseTask } from '../../src/domain/campaign.ts';
import { rxdbChangeFeedEntriesForSnapshotDelta } from '../rxdbChangeFeed.ts';
import type { D1DatabaseLike, D1PreparedStatement } from '../campaignRepository.ts';
import { hasBaseStorage } from './baseStorage.ts';
import { persistChunkSnapshot } from './chunkPersistence.ts';

export function jsonChunks<T>(rows: readonly T[], limit = 400_000): T[][] {
  const chunks: T[][] = []; let chunk: T[] = [], bytes = 2;
  for (const row of rows) {
    const size = new TextEncoder().encode(JSON.stringify(row)).length + 1;
    if (size > limit) throw new Error('network_row_budget_exceeded');
    if (bytes + size > limit) { chunks.push(chunk); chunk = []; bytes = 2; }
    chunk.push(row); bytes += size;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

/** One D1 transaction owns canonical records, network metadata, revision, ledger and feed. */
export async function persistNetworkSnapshot(db: D1DatabaseLike, before: CampaignSnapshot, after: CampaignSnapshot, options: {
  areaId: string; generation: string; preparing: boolean; timestamp: string;
  sourceTimestamp?:string; lease?:string; events?:NetworkEvent[];
  intent?: { id: string; fingerprint: string };
}) {
  if(await hasBaseStorage(db))return persistChunkSnapshot(db,before,after,options);
  const campaignId = before.campaign.id, token = crypto.randomUUID();
  const area = before.areas.find((candidate) => candidate.id === options.areaId)!;
  const guard = 'EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)';
  const bind = [campaignId, token];
  const sql: D1PreparedStatement[] = [db.prepare(`UPDATE campaigns SET revision = ?, write_token = ?, updated_at = ?
    WHERE id = ? AND revision = ?
    AND EXISTS (SELECT 1 FROM areas WHERE id = ? AND campaign_id = ? AND geometry_json = ?)
    AND EXISTS (SELECT 1 FROM area_task_preparations WHERE area_id = ? AND campaign_id = ? AND generation = ? AND status = ?)
    ${options.preparing ? `AND EXISTS(SELECT 1 FROM street_network_jobs WHERE campaign_id=? AND area_id=? AND generation=? AND lease=?) AND NOT EXISTS (SELECT 1 FROM tasks WHERE campaign_id = ? AND area_id = ? AND area_preparation_generation IS NOT NULL AND (status <> 'open' OR EXISTS (SELECT 1 FROM street_network_state WHERE task_id = tasks.id AND json_array_length(network_json, '$.coverage') > 0)))
    AND NOT EXISTS (SELECT 1 FROM house_tasks WHERE campaign_id = ? AND area_id = ? AND area_preparation_generation IS NOT NULL AND status <> 'open')` : ''}`)
    .bind(before.revision + 1, token, options.timestamp, campaignId, before.revision, options.areaId, campaignId, JSON.stringify(area.geometry), options.areaId, campaignId, options.generation, options.preparing ? 'pending' : 'ready', ...(options.preparing ? [campaignId, options.areaId, options.generation,options.lease,campaignId, options.areaId, campaignId, options.areaId] : []))];
  const taskBefore = new Map(before.tasks.map((task) => [task.id, task]));
  const houseBefore = new Map((before.houseTasks ?? []).map((house) => [house.id, house]));
  const tasks = after.tasks.filter((task) => JSON.stringify(taskBefore.get(task.id)) !== JSON.stringify(task));
  const houses = (after.houseTasks ?? []).filter((house) => JSON.stringify(houseBefore.get(house.id)) !== JSON.stringify(house));
  const afterTaskIds = new Set(after.tasks.map((task) => task.id));
  const afterHouseIds = new Set((after.houseTasks ?? []).map((task) => task.id));
  for (const [table, removed] of [['house_tasks', [...houseBefore.keys()].filter((id) => !afterHouseIds.has(id))], ['tasks', [...taskBefore.keys()].filter((id) => !afterTaskIds.has(id))]] as const) {
    for (const chunk of jsonChunks(removed)) sql.push(db.prepare(`DELETE FROM ${table} WHERE campaign_id = ? AND id IN (SELECT value FROM json_each(?)) AND ${guard}`).bind(campaignId, JSON.stringify(chunk), ...bind));
  }
  const fields = `json_extract(value,'$.id'), json_extract(value,'$.campaignId'), json_extract(value,'$.areaId'), json_extract(value,'$.label'), json_extract(value,'$.geometry'), json_extract(value,'$.source'), json_extract(value,'$.areaPreparationGeneration'), json_extract(value,'$.status'), json_extract(value,'$.completedAt'), json_extract(value,'$.createdAt'), json_extract(value,'$.updatedAt')`;
  const columns = 'id,campaign_id,area_id,label,geometry_json,source_json,area_preparation_generation,status,completed_at,created_at,updated_at';
  const updates = 'label=excluded.label,geometry_json=excluded.geometry_json,source_json=excluded.source_json,area_preparation_generation=excluded.area_preparation_generation,status=excluded.status,completed_at=excluded.completed_at,updated_at=excluded.updated_at';
  for (const chunk of jsonChunks<DistributionTask>(tasks)) {
    sql.push(db.prepare(`INSERT INTO tasks (${columns},task_type) SELECT ${fields},'street' FROM json_each(?) WHERE ${guard} ON CONFLICT(id) DO UPDATE SET ${updates}`).bind(JSON.stringify(chunk), ...bind));
    sql.push(db.prepare(`INSERT INTO street_network_state(task_id,network_json) SELECT json_extract(value,'$.id'),json_extract(value,'$.network') FROM json_each(?) WHERE json_type(value,'$.network') = 'object' AND ${guard} ON CONFLICT(task_id) DO UPDATE SET network_json=excluded.network_json`).bind(JSON.stringify(chunk), ...bind));
  }
  for (const chunk of jsonChunks<HouseTask>(houses)) {
    sql.push(db.prepare(`INSERT INTO house_tasks (${columns},parent_street_task_id) SELECT ${fields},json_extract(value,'$.parentStreetTaskId') FROM json_each(?) WHERE ${guard} ON CONFLICT(id) DO UPDATE SET ${updates},parent_street_task_id=excluded.parent_street_task_id`).bind(JSON.stringify(chunk), ...bind));
    sql.push(db.prepare(`INSERT INTO house_road_positions(house_id,position_json) SELECT json_extract(value,'$.id'),json_extract(value,'$.roadPosition') FROM json_each(?) WHERE json_type(value,'$.roadPosition') = 'object' AND ${guard} ON CONFLICT(house_id) DO UPDATE SET position_json=excluded.position_json`).bind(JSON.stringify(chunk), ...bind));
  }
  const changes = rxdbChangeFeedEntriesForSnapshotDelta(before, { ...after, revision: before.revision + 1 });
  for (const chunk of jsonChunks(changes)) sql.push(db.prepare(`INSERT INTO campaign_sync_changes(campaign_id,collection_name,document_id,operation,scope_team_id,document_json,changed_at)
    SELECT ?,json_extract(value,'$.collectionName'),json_extract(value,'$.document.id'),CASE WHEN json_extract(value,'$.document._deleted') = 1 THEN 'delete' ELSE 'upsert' END,json_extract(value,'$.scopeTeamId'),json_extract(value,'$.document'),? FROM json_each(?) WHERE ${guard}`).bind(campaignId, options.timestamp, JSON.stringify(chunk), ...bind));
  for(const chunk of jsonChunks(options.events??[]))sql.push(db.prepare(`INSERT INTO domain_events(id,campaign_id,team_id,field_session_id,entity_type,entity_id,event_type,occurred_at,actor_kind,actor_ref,payload_version,payload_json,dedupe_key,created_at)
    SELECT json_extract(value,'$.id'),?,json_extract(value,'$.teamId'),json_extract(value,'$.fieldSessionId'),json_extract(value,'$.entityType'),json_extract(value,'$.entityId'),json_extract(value,'$.eventType'),json_extract(value,'$.occurredAt'),json_extract(value,'$.actorKind'),json_extract(value,'$.actorRef'),1,json_extract(value,'$.payload'),json_extract(value,'$.dedupeKey'),? FROM json_each(?) WHERE ${guard}`).bind(campaignId,options.timestamp,JSON.stringify(chunk),...bind));
  if (options.preparing) sql.push(db.prepare(`UPDATE area_task_preparations SET status='ready',source_timestamp=?,road_count=?,house_count=?,ready_at=?,updated_at=?,last_error_code=NULL WHERE campaign_id=? AND area_id=? AND generation=? AND ${guard}`).bind(options.sourceTimestamp??null,after.tasks.filter((task) => task.areaId === area.id && task.network).length, (after.houseTasks ?? []).filter((house) => house.areaId === area.id && house.areaPreparationGeneration).length, options.timestamp, options.timestamp, campaignId, area.id, options.generation, ...bind));
  if (options.intent) sql.push(db.prepare(`INSERT INTO street_network_intents(campaign_id,intent_id,fingerprint,revision) SELECT ?,?,?,? WHERE ${guard}`).bind(campaignId, options.intent.id, options.intent.fingerprint, before.revision + 1, ...bind));
  if(sql.length>900)throw new Error('network_transaction_budget');
  const results = await db.batch(sql);
  return { committed: results[0]?.meta?.changes === 1, revision: before.revision + 1, statements: sql.length, taskWrites: tasks.length, houseWrites: houses.length, feedWrites: changes.length };
}
