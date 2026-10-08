import type { SyncTransport } from '../store/syncClient.ts';
import type { Op } from '../store/types.ts';

export type Meta = {
  campaign: { id: string; name: string };
  role: 'admin' | 'team-editor' | 'viewer' | 'field-group-member' | 'collection-collector';
  teamId: string | null;
  canWrite: boolean;
  canBuildPack: boolean;
  teams: { id: string; name: string; color: string }[];
  areas: { id: string; name: string; teamId: string; geometry: { type: 'Polygon'; coordinates: [number, number][][] }; packVersion: number | null }[];
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
      })).json() as { accepted: string[]; rejected: { id: string }[]; cursor: number };
      // Permanently rejected edits (forbidden area, bad clock) must leave the outbox or they would retry forever.
      return { accepted: [...result.accepted, ...result.rejected.map((r) => r.id)], cursor: result.cursor };
    },
  };
}
