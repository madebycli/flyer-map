import type { TemplatePlan } from '../areas/template.ts';
import type { LngLat } from '../engine/types.ts';
import { fromRing, toPolygon } from '../areas/polygon.ts';
import { fold } from './search.ts';
import { buildPack, createArea, createTeam, saveAreaGeometry, type Meta } from './api.ts';

export type ApplyResult = { teamsCreated: number; areasCreated: number; areasReshaped: number; reshapedIds: string[]; errors: string[] };
export type ApplyProgress = { done: number; total: number; label: string };

const polygon = (ring: LngLat[]) => toPolygon(fromRing(ring));

/**
 * Carries out a plan one step at a time (Gruppen first, then outlines), so a failure in the middle leaves a consistent map: every
 * step is its own validated mutation and a failed one is reported, the rest continues. Fresh map data is requested for every changed
 * outline when the caller may build it; a refusal (cooldown) just leaves the "Kartendaten laden" offer for later.
 */
export async function applyTemplatePlan(
  campaignId: string,
  plan: TemplatePlan,
  meta: Pick<Meta, 'teams' | 'areas' | 'canBuildPack'>,
  onProgress: (progress: ApplyProgress) => void,
): Promise<ApplyResult> {
  const result: ApplyResult = { teamsCreated: 0, areasCreated: 0, areasReshaped: 0, reshapedIds: [], errors: [] };
  const total = plan.createTeams.length + plan.createAreas.length + plan.reshapeAreas.length;
  let done = 0;
  const step = (label: string) => onProgress({ done, total, label });
  const teamId = new Map(meta.teams.map((t) => [fold(t.name), t.id]));
  const attempt = async (label: string, run: () => Promise<void>) => {
    step(label);
    try { await run(); } catch (error) { result.errors.push(`${label}: ${error instanceof Error ? error.message : 'fehlgeschlagen'}`); }
    done++;
  };

  for (const team of plan.createTeams) {
    const id = `team_${crypto.randomUUID()}`;
    await attempt(`Gruppe ${team.name}`, async () => { await createTeam(campaignId, { id, name: team.name, color: team.color }); teamId.set(fold(team.name), id); result.teamsCreated++; });
  }
  const refreshPack = async (areaId: string) => { if (meta.canBuildPack) { try { await buildPack(campaignId, areaId); } catch { /* cooldown or limit: offered again as "Kartendaten laden" */ } } };
  for (const area of plan.reshapeAreas) {
    const current = meta.areas.find((a) => a.id === area.id);
    await attempt(`Gebiet ${area.name}`, async () => {
      if (!current) throw new Error('Gebiet nicht mehr vorhanden');
      await saveAreaGeometry(campaignId, { id: current.id, updatedAt: current.updatedAt }, polygon(area.ring));
      result.areasReshaped++; result.reshapedIds.push(area.id);
      await refreshPack(area.id);
    });
  }
  for (const area of plan.createAreas) {
    await attempt(`Gebiet ${area.name}`, async () => {
      const team = teamId.get(fold(area.team));
      if (!team) throw new Error(`Gruppe „${area.team}“ fehlt`);
      const id = `area_${crypto.randomUUID()}`;
      await createArea(campaignId, { id, teamId: team, name: area.name, geometry: polygon(area.ring) });
      result.areasCreated++;
      await refreshPack(id);
    });
  }
  onProgress({ done: total, total, label: '' });
  return result;
}
