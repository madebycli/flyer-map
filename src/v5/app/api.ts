import type { SyncTransport } from '../store/syncClient.ts';
import type { Op } from '../store/types.ts';

export type Meta = {
  campaign: { id: string; name: string };
  role: 'admin' | 'team-editor' | 'viewer' | 'field-group-member' | 'collection-collector';
  teamId: string | null;
  canWrite: boolean;
  canBuildPack: boolean;
  teams: { id: string; name: string; color: string }[];
  areas: { id: string; name: string; teamId: string; geometry: { type: 'Polygon'; coordinates: [number, number][][] }; updatedAt: string; packVersion: number | null; packStale?: boolean }[];
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

export async function fetchMeta(campaignId: string): Promise<Meta> {
  return (await call(`${base(campaignId)}/meta`)).json() as Promise<Meta>;
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
      const page = await (await call(`${base(campaignId)}/state?since=${since}&limit=1000`)).json() as { ops: Op[]; cursor: number };
      return { ops: page.ops, cursor: page.cursor };
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

/** Pre-v5 snapshot, used only for the one-time progress carry-over. */
export async function fetchLegacySnapshot(campaignId: string): Promise<unknown> {
  return (await call(`/api/campaigns/${encodeURIComponent(campaignId)}/snapshot`)).json();
}

type Polygon = { type: 'Polygon'; coordinates: [number, number][][] };

/** Area edits go through the existing, validated, authorised mutation endpoint, so legacy clients stay consistent. */
async function postAreaMutation(campaignId: string, type: 'area.update-geometry' | 'area.create', payload: Record<string, unknown>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const { revision } = await (await call(`/api/campaigns/${encodeURIComponent(campaignId)}/version`)).json() as { revision: number };
    const mutation = { id: `mutation_${crypto.randomUUID()}`, campaignId, type, payload, baseRevision: revision, createdAt: new Date().toISOString() };
    try {
      await call(`/api/campaigns/${encodeURIComponent(campaignId)}/mutations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mutation, fieldGroupId: null }) });
      return;
    } catch (error) {
      // Somebody else saved in the meantime: the revision moved, our own entity check (expectedUpdatedAt) still decides.
      if (error instanceof V5ApiError && error.status === 409 && /revision/i.test(error.code) && attempt < 2) continue;
      throw error;
    }
  }
}

export const saveAreaGeometry = (campaignId: string, area: { id: string; updatedAt: string }, geometry: Polygon) =>
  postAreaMutation(campaignId, 'area.update-geometry', { areaId: area.id, geometry, expectedUpdatedAt: area.updatedAt });

export const createArea = (campaignId: string, area: { id: string; teamId: string; name: string; geometry: Polygon }) =>
  postAreaMutation(campaignId, 'area.create', { areaId: area.id, teamId: area.teamId, name: area.name, geometry: area.geometry });
