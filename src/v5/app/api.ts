import type { SyncTransport } from '../store/syncClient.ts';
import type { Op } from '../store/types.ts';
import type { NoteTransport } from '../notes/sync.ts';
import type { Note } from '../notes/types.ts';

export type CollectionAreaInfo = { status: 'open' | 'claimed' | 'in-progress' | 'completed' | 'archived'; runId: string | null; claimedBy: string | null; claimedById: string | null };
export type CollectionRunInfo = { id: string; mainAreaId: string; members: { collectorId: string; label: string }[] };

export type Meta = {
  campaign: { id: string; name: string };
  kind: 'distribution' | 'collection';
  collectorId: string | null;
  collectorLabel: string | null;
  mainAreaId: string | null;
  pickupRights: { view: boolean; create: boolean; edit: boolean };
  runs: CollectionRunInfo[];
  /** The device's temporary identity as the server knows it (a neutral label such as "Nutzer 2"; null when the link carries none). */
  me: { label: string | null };
  role: 'admin' | 'team-editor' | 'viewer' | 'field-group-member' | 'collection-collector';
  teamId: string | null;
  canWrite: boolean;
  canBuildPack: boolean;
  teams: { id: string; name: string; color: string }[];
  /** Basemap styles chosen by the deployment (null = plain background); the client carries no third-party map URL. */
  basemap: { dark: string; light: string } | null;
  areas: { id: string; name: string; teamId: string; geometry: { type: 'Polygon'; coordinates: [number, number][][] }; updatedAt: string; packVersion: number | null; packStale?: boolean; writable: boolean; collection?: CollectionAreaInfo }[];
};

export class V5ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

async function call(path: string, init?: RequestInit): Promise<Response> {
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
      })).json() as { accepted: string[]; rejected: { id: string }[] };
      // Permanently rejected edits are rolled back locally by the sync client; they must not retry forever.
      return { accepted: result.accepted, rejected: result.rejected.map((r) => r.id), cursor: 0 };
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

export const createArea = (campaignId: string, area: { id: string; teamId: string; name: string; geometry: Polygon }) =>
  postAreaMutation(campaignId, 'area.create', { areaId: area.id, teamId: area.teamId, name: area.name, geometry: area.geometry });

/** Admin only: remove progress rows of an Area for keys the derivation no longer produces. Returns how many rows went. */
export async function pruneArea(campaignId: string, areaId: string, keys: string[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < keys.length; i += 4000) {
    const response = await call(`${base(campaignId)}/areas/${encodeURIComponent(areaId)}/prune`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: keys.slice(i, i + 4000) }) });
    removed += ((await response.json()) as { removed: number }).removed;
  }
  return removed;
}
