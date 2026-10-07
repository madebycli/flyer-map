import type { Area, Team } from '../domain/campaign.ts';
import { darkenHexColor } from '../domain/color.ts';

const DEFAULT_COLOR = '#64748b';
const DEFAULT_PALETTE = { color: DEFAULT_COLOR, completedColor: darkenHexColor(DEFAULT_COLOR, 0.25) };

/** Build once per Area/Team change, rather than searching both arrays per Task. */
export function createAreaRenderIndex(areas: readonly Area[], teams: readonly Team[]) {
  const teamsById = new Map<string, Team>();
  for (const team of teams) if (!teamsById.has(team.id)) teamsById.set(team.id, team);
  const palettes = new Map<string, typeof DEFAULT_PALETTE>();
  const index = new Map<string, { area: Area; team: Team | undefined; palette: typeof DEFAULT_PALETTE }>();
  for (const area of areas) {
    if (index.has(area.id)) continue;
    const team = teamsById.get(area.teamId);
    const color = team?.color ?? DEFAULT_COLOR;
    let palette = palettes.get(color);
    if (!palette) {
      palette = { color, completedColor: darkenHexColor(color, 0.25) };
      palettes.set(color, palette);
    }
    index.set(area.id, { area, team, palette });
  }
  return index;
}

export function colorAreaEntities<T extends { areaId: string }>(
  entities: readonly T[],
  index: ReturnType<typeof createAreaRenderIndex>,
) {
  return entities.map((entity) => ({ ...entity, ...(index.get(entity.areaId)?.palette ?? DEFAULT_PALETTE) }));
}
