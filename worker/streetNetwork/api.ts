import type { AccessContext } from '../access.ts';
import { loadCampaignSnapshot, hasStreetNetworkSchema, type D1DatabaseLike } from '../campaignRepository.ts';
import { RoadIndex, snapNetworkPoint, networkRoutes, applyNetworkCoverage } from '../../src/domain/streetNetwork.ts';
import type { LngLat, TaskStatus } from '../../src/domain/campaign.ts';
import { networkEvents } from './events.ts';
import { persistNetworkSnapshot } from './persistence.ts';
import { requestDatabase } from '../requestDatabase.ts';
import { hasBaseStorage } from './baseStorage.ts';

export type NetworkIntent = { id: string; areaId: string; generation: string; start: { point: LngLat; taskId: string }; end: { point: LngLat; taskId: string }; selectedPath: string[]; status: TaskStatus };
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(value);
export function validNetworkIntent(value: unknown): value is NetworkIntent {
  if (!value || typeof value !== 'object') return false;
  const input = value as NetworkIntent;
  const anchor = (value: NetworkIntent['start']) => value && id(value.taskId) && Array.isArray(value.point) && value.point.length === 2 && value.point.every(Number.isFinite) && Math.abs(value.point[0]) <= 180 && Math.abs(value.point[1]) < 85;
  return id(input.id) && id(input.areaId) && id(input.generation) && anchor(input.start) && anchor(input.end) && Array.isArray(input.selectedPath) && input.selectedPath.length > 0 && input.selectedPath.length <= 500 && input.selectedPath.every(id) && ['open','completed','later','not-deliverable'].includes(input.status);
}
const response = (status: number, code: string, extra = {}) => Response.json({ code, ...extra }, { status, headers: {'cache-control':'no-store'} });
export async function handleNetworkIntent(request: Request, db: D1DatabaseLike, campaignId: string, access: AccessContext, notify?: () => Promise<unknown>) {
  db=requestDatabase(db);
  if (request.method !== 'POST') return response(405,'method_not_allowed');
  if (access.campaignId !== campaignId || !['admin','team-editor','field-group-member'].includes(access.role)) return response(403,'forbidden');
  const reader = request.body?.getReader();
  if (!reader) return response(400,'invalid_network_intent');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 32000) { await reader.cancel(); return response(413,'payload_too_large'); } chunks.push(part.value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  let input: unknown; try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return response(400,'invalid_json'); }
  if (!validNetworkIntent(input)) return response(400,'invalid_network_intent');
  if (!await hasStreetNetworkSchema(db)) return response(503,'network_schema_unavailable');
  const intent = input;
  const fingerprint = JSON.stringify({ areaId:intent.areaId,generation:intent.generation,start:intent.start,end:intent.end,selectedPath:intent.selectedPath,status:intent.status });
  const maxAttempts=await hasBaseStorage(db)?1:3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const before = await loadCampaignSnapshot(db,campaignId,{includeCollection:false,areaId:intent.areaId});
    const area = before?.areas.find((area) => area.id === intent.areaId);
    if (!before || !area) return response(404,'area_not_found');
    if (access.role !== 'admin' && access.teamId !== area.teamId) return response(403,'forbidden');
    const replay = await db.prepare('SELECT fingerprint,revision FROM street_network_intents WHERE campaign_id=? AND intent_id=?').bind(campaignId,intent.id).first<{fingerprint:string;revision:number}>();
    if (replay) return replay.fingerprint === fingerprint ? response(200,'already_applied',{revision:replay.revision}) : response(409,'intent_id_reused');
    const state = await db.prepare('SELECT generation,status FROM area_task_preparations WHERE campaign_id=? AND area_id=?').bind(campaignId,area.id).first<{generation:string;status:string}>();
    if (state?.status !== 'ready' || state.generation !== intent.generation) return response(409,'network_generation_changed');
    const tasks = before.tasks.filter((task) => task.areaId === area.id && task.network);
    try {
      const index = new RoadIndex(tasks);
      const routes = networkRoutes(tasks,snapNetworkPoint(index,intent.start.point,intent.start.taskId),snapNetworkPoint(index,intent.end.point,intent.end.taskId));
      const route = routes.find((route) => JSON.stringify(route.ranges.map((range) => range.taskId)) === JSON.stringify(intent.selectedPath));
      if (!route) return response(409,'network_route_changed');
      const timestamp = new Date().toISOString();
      const delta = applyNetworkCoverage(before.tasks,before.houseTasks ?? [],route.ranges,intent.status,timestamp);
      const events=await networkEvents(db,before,{...before,...delta},access,intent.id,route.ranges[0].taskId,timestamp);
      const persisted = await persistNetworkSnapshot(db,before,{...before,...delta},{areaId:area.id,generation:intent.generation,preparing:false,timestamp,events,intent:{id:intent.id,fingerprint}});
      if (persisted.committed) { try { await notify?.(); } catch { /* durable feed can be pulled without invalidation */ } return response(200,'applied',persisted); }
    } catch (error) {
      if (error instanceof Error && /^(network_|invalid_|coverage_)/.test(error.message)) return response(409,error.message);
      throw error;
    }
  }
  return response(409,'network_concurrent_write');
}
