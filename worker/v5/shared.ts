import type { AccessContext } from '../access.ts';
import { loadCanonicalArea, type D1DatabaseLike } from '../campaignRepository.ts';

export const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, { ...init, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...init.headers } });
export const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, { status });

export const ID = /^[A-Za-z0-9._:-]{1,160}$/u;
export const writesAllowed = (a: AccessContext) => a.role === 'admin' || a.role === 'team-editor' || a.role === 'field-group-member';
export const isScoped = (a: AccessContext) => a.role === 'team-editor' || a.role === 'field-group-member';

/** The Area when this caller may work in it (scoped roles: only their own team's), else null. */
export async function canSeeArea(db: D1DatabaseLike, access: AccessContext, campaignId: string, areaId: string) {
  const area = await loadCanonicalArea(db, campaignId, areaId);
  if (!area) return null;
  if (!isScoped(access)) return area;
  return access.teamId === area.teamId ? area : null;
}
