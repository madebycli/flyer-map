import type { SyncTransport } from '../store/syncClient.ts';
import type { Op } from '../store/types.ts';
import type { NoteTransport } from '../notes/sync.ts';
import type { Note } from '../notes/types.ts';

export type CollectionAreaInfo = { status: 'open' | 'claimed' | 'in-progress' | 'completed' | 'archived'; color: string; runId: string | null; claimedBy: string | null; claimedById: string | null };
export type CollectionRunInfo = { id: string; mainAreaId: string; members: { collectorId: string; label: string }[] };

export type Meta = {
  campaign: { id: string; name: string };
  kind: 'distribution' | 'collection';
  collectorId: string | null;
  collectorLabel: string | null;
  mainAreaId: string | null;
  /** The Sammelgebiet of an Abholaktion (collection side only). */
  mainArea: { id: string; name: string; geometry: { type: 'Polygon'; coordinates: [number, number][][] }; updatedAt: string } | null;
  pickupRights: { view: boolean; create: boolean; edit: boolean };
  runs: CollectionRunInfo[];
  /** The device's temporary identity as the server knows it (a neutral label such as "Nutzer 2"; null when the link carries none). */
  me: { label: string | null };
  role: 'admin' | 'team-editor' | 'viewer' | 'field-group-member' | 'collection-collector';
  teamId: string | null;
  canWrite: boolean;
  canBuildPack: boolean;
  teams: { id: string; name: string; color: string; updatedAt: string }[];
  /** Basemap styles chosen by the deployment (null = plain background); the client carries no third-party map URL. */
  basemap: { dark: string | null; light: string | null } | null;
  areas: { id: string; name: string; teamId: string; geometry: { type: 'Polygon'; coordinates: [number, number][][] }; updatedAt: string; packVersion: number | null; packStale?: boolean; writable: boolean; collection?: CollectionAreaInfo }[];
};

export class V5ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export async function call(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (response.ok) return response;
  let code = 'http_' + response.status, message = `Serverfehler ${response.status}`;
  try { const body = await response.clone().json() as { error?: { code?: string; message?: string } }; code = body.error?.code ?? code; message = body.error?.message ?? message; } catch { /* non-JSON error */ }
  throw new V5ApiError(response.status, code, message);
}

const base = (campaignId: string) => `/api/v5/campaigns/${encodeURIComponent(campaignId)}`;

export async function fetchMeta(campaignId: string, kind?: 'collection'): Promise<Meta> {
  return (await call(`${base(campaignId)}/meta${kind ? `?kind=${kind}` : ''}`)).json() as Promise<Meta>;
}

export async function fetchPack(campaignId: string, areaId: string): Promise<Uint8Array | null> {
  try { return new Uint8Array(await (await call(`${base(campaignId)}/areas/${encodeURIComponent(areaId)}/pack`)).arrayBuffer()); }
  catch (error) { if (error instanceof V5ApiError && error.code === 'no_pack') return null; throw error; }
}

export async function buildPack(campaignId: string, areaId: string): Promise<void> {
  await call(`${base(campaignId)}/areas/${encodeURIComponent(areaId)}/pack`, { method: 'POST' });
}

export function httpTransport(campaignId: string): SyncTransport {
  return {
    async pull(since) {
      const page = await (await call(`${base(campaignId)}/state?since=${since}&limit=1000`)).json() as { ops: Op[]; cursor: number; serverNow?: number };
      return { ops: page.ops, cursor: page.cursor, serverNow: page.serverNow };
    },
    async push(ops) {
      // Edits without a known Area cannot be authorised yet; they stay in the outbox.
      const sendable = ops.filter((op) => op.area);
      if (!sendable.length) return { accepted: [], cursor: 0 };
      const result = await (await call(`${base(campaignId)}/ops`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ops: sendable.map(({ id, key, status, area }) => ({ id, key, status, area })) }),
      })).json() as { accepted: string[]; rejected: { id: string; reason?: string }[] };
      // Permanently rejected edits are rolled back locally by the sync client; they must not retry forever.
      return { accepted: result.accepted, rejected: result.rejected.map((r) => r.id), refetch: result.rejected.some((r) => r.reason === 'key_owned_elsewhere'), cursor: 0 };
    },
  };
}

export function httpNoteTransport(campaignId: string): NoteTransport {
  return {
    async pull(since) {
      const page = await (await call(`${base(campaignId)}/notes?since=${since}&limit=500`)).json() as { notes: Note[]; cursor: number; more: boolean; serverNow?: number };
      return page;
    },
    async push(notes) {
      try {
        return await (await call(`${base(campaignId)}/notes`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ notes: notes.map(({ id, key, area, flag, text, rev, deleted }) => ({ id, key, area, flag, text, rev, deleted })) }),
        })).json() as { accepted: string[]; rejected: { id: string; reason: string }[] };
      } catch (error) {
        // A role that may not write at all would otherwise retry forever; treat it as a permanent refusal of this batch.
        if (error instanceof V5ApiError && error.status === 403) return { accepted: [], rejected: notes.map((n) => ({ id: n.id, reason: error.code })) };
        throw error;
      }
    },
  };
}

/** Pre-v5 snapshot, used only for the one-time progress carry-over. */
export async function fetchLegacySnapshot(campaignId: string): Promise<unknown> {
  return (await call(`/api/campaigns/${encodeURIComponent(campaignId)}/snapshot`)).json();
}

type Polygon = { type: 'Polygon'; coordinates: [number, number][][] };

/**
 * Mutations go through the existing, validated, authorised legacy endpoint, so legacy clients stay consistent.
 * `id` makes a user action idempotent: a double tap or a retry after a lost response sends the same mutation id.
 */
export async function postMutation(campaignId: string, type: string, payload: Record<string, unknown>, options: { id?: string; revisionFrom?: 'version' | 'collection' } = {}): Promise<void> {
  const id = options.id ?? `mutation_${crypto.randomUUID()}`;
  for (let attempt = 0; ; attempt++) {
    // Collectors may not read /version; the collection snapshot carries the same revision for everyone who may mutate collection data.
    const revisionUrl = options.revisionFrom === 'collection' ? `/api/campaigns/${encodeURIComponent(campaignId)}/collection/snapshot` : `/api/campaigns/${encodeURIComponent(campaignId)}/version`;
    const { revision } = await (await call(revisionUrl)).json() as { revision: number };
    const mutation = { id, campaignId, type, payload, baseRevision: revision, createdAt: new Date().toISOString() };
    try {
      await call(`/api/campaigns/${encodeURIComponent(campaignId)}/mutations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mutation, fieldGroupId: null }) });
      return;
    } catch (error) {
      // Our own earlier attempt was applied but its response got lost: the id is ours alone, so the action is done.
      if (error instanceof V5ApiError && error.code === 'mutation_id_reused') return;
      // Somebody else saved in the meantime: the revision moved, our own entity checks still decide.
      if (error instanceof V5ApiError && error.status === 409 && /revision/i.test(error.code) && attempt < 2) continue;
      throw error;
    }
  }
}

const postAreaMutation = (campaignId: string, type: 'area.update-geometry' | 'area.create', payload: Record<string, unknown>) => postMutation(campaignId, type, payload);

export const saveAreaGeometry = (campaignId: string, area: { id: string; updatedAt: string }, geometry: Polygon) =>
  postAreaMutation(campaignId, 'area.update-geometry', { areaId: area.id, geometry, expectedUpdatedAt: area.updatedAt });

export const createTeam = (campaignId: string, team: { id: string; name: string; color: string }) =>
  postMutation(campaignId, 'team.create', { teamId: team.id, name: team.name, color: team.color });

export const updateTeam = (campaignId: string, team: { id: string; updatedAt: string }, patch: { name?: string; color?: string }) =>
  postMutation(campaignId, 'team.update', { teamId: team.id, expectedUpdatedAt: team.updatedAt, ...patch });

export const deleteTeam = (campaignId: string, team: { id: string; updatedAt: string }) =>
  postMutation(campaignId, 'team.delete', { teamId: team.id, expectedUpdatedAt: team.updatedAt });

export const renameArea = (campaignId: string, area: { id: string; updatedAt: string }, name: string) =>
  postMutation(campaignId, 'area.rename', { areaId: area.id, name, expectedUpdatedAt: area.updatedAt });

export const setAreaTeam = (campaignId: string, area: { id: string; updatedAt: string }, teamId: string) =>
  postMutation(campaignId, 'area.set-team', { areaId: area.id, teamId, expectedUpdatedAt: area.updatedAt });

export const renameCampaign = (campaignId: string, expectedName: string, name: string) =>
  postMutation(campaignId, 'campaign.rename', { name, expectedName });

export const deleteArea = (campaignId: string, area: { id: string; updatedAt: string }) =>
  postMutation(campaignId, 'area.delete', { areaId: area.id, expectedUpdatedAt: area.updatedAt });

/** After the Gebiet is gone: the server drops what v5 kept for it (progress, notes, map data). */
export async function forgetArea(campaignId: string, areaId: string): Promise<{ removed: number }> {
  return (await call(`${base(campaignId)}/areas/${encodeURIComponent(areaId)}/forget`, { method: 'POST' })).json() as Promise<{ removed: number }>;
}

const collectionMutation = (campaignId: string, type: string, payload: Record<string, unknown>) => postMutation(campaignId, type, payload, { revisionFrom: 'collection' });

export const createMainArea = (campaignId: string, main: { id: string; name: string; geometry: Polygon }) =>
  collectionMutation(campaignId, 'collection.main-area.create', { mainAreaId: main.id, name: main.name, geometry: main.geometry });
export const updateMainArea = (campaignId: string, main: { id: string; updatedAt: string }, name: string, geometry: Polygon) =>
  collectionMutation(campaignId, 'collection.main-area.update', { mainAreaId: main.id, name, geometry, expectedUpdatedAt: main.updatedAt });
export const createCollectionArea = (campaignId: string, area: { id: string; mainAreaId: string; name: string; geometry: Polygon; color: string }) =>
  collectionMutation(campaignId, 'collection.area.create', { areaId: area.id, mainAreaId: area.mainAreaId, name: area.name, geometry: area.geometry, color: area.color });
export const updateCollectionArea = (campaignId: string, area: { id: string; updatedAt: string }, name: string, geometry: Polygon, color: string) =>
  collectionMutation(campaignId, 'collection.area.update', { areaId: area.id, name, geometry, color, expectedUpdatedAt: area.updatedAt });
export const archiveCollectionArea = (campaignId: string, area: { id: string; updatedAt: string }) =>
  collectionMutation(campaignId, 'collection.area.archive', { areaId: area.id, expectedUpdatedAt: area.updatedAt });
/** An admin frees an Area a helper holds (a lost phone, someone who left): the Raum is closed, the Gebiet is open again. */
export const forceReleaseArea = (campaignId: string, runId: string, areaId: string) =>
  collectionMutation(campaignId, 'collection.admin.force-release-area', { runId, areaId, adminId: `admin_${crypto.randomUUID()}` });

export const createArea = (campaignId: string, area: { id: string; teamId: string; name: string; geometry: Polygon }) =>
  postAreaMutation(campaignId, 'area.create', { areaId: area.id, teamId: area.teamId, name: area.name, geometry: area.geometry });

/** Why a clean-up was held back: it would remove most of the Area's progress and needs an explicit yes. */
export class PruneConfirmRequired extends Error {
  constructor() { super('Sehr viele Markierungen dieses Gebiets würden entfernt.'); }
}

/**
 * Admin only: remove progress rows of an Area for keys the derivation no longer produces. The server names the keys it really removed
 * (only rows of that Area), so the caller forgets exactly those. Without `confirm`, a clean-up that would wipe most of the Area is refused.
 */
export async function pruneArea(campaignId: string, areaId: string, keys: string[], confirm = false): Promise<{ removed: number; keys: string[] }> {
  const out = { removed: 0, keys: [] as string[] };
  for (let i = 0; i < keys.length; i += 1500) {
    try {
      const response = await call(`${base(campaignId)}/areas/${encodeURIComponent(areaId)}/prune`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: keys.slice(i, i + 1500), ...(confirm ? { confirm: true } : {}) }) });
      const body = (await response.json()) as { removed: number; keys: string[] };
      out.removed += body.removed; out.keys.push(...body.keys);
    } catch (error) {
      if (error instanceof V5ApiError && error.code === 'prune_confirm_required') throw new PruneConfirmRequired();
      throw error;
    }
  }
  return out;
}
