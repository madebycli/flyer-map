import { call } from './api.ts';
import { linkFor } from './link.ts';

/** Who may open the field map with a link: a Gruppe (edit its own Gebiete) or a viewer (read only). Admins are people with an account, not links. */
export type GrantRole = 'team-editor' | 'viewer';
export type Grant = { grantId: string; role: 'admin' | GrantRole; teamId: string | null; label: string | null; createdAt: string; revokedAt: string | null };
export type Collector = { id: string; label: string; createdAt: string; revokedAt: string | null };

const campaign = (id: string) => `/api/campaigns/${encodeURIComponent(id)}`;
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function listGrants(campaignId: string): Promise<Grant[]> {
  return ((await (await call(`${campaign(campaignId)}/access`)).json()) as { grants: Grant[] }).grants;
}

/** The secret comes back once; the returned link is what the admin hands over. */
export async function createGrant(campaignId: string, input: { role: GrantRole; teamId: string | null; label: string }): Promise<{ link: string }> {
  const { token } = (await (await call(`${campaign(campaignId)}/access`, json(input))).json()) as { token: string };
  return { link: linkFor(location.origin, campaignId, { kind: 'access', token }) };
}

export async function revokeGrant(campaignId: string, grantId: string): Promise<void> {
  await call(`${campaign(campaignId)}/access/${encodeURIComponent(grantId)}`, { method: 'DELETE' });
}

export async function createCollectionLink(campaignId: string): Promise<{ link: string }> {
  const { token } = (await (await call(`${campaign(campaignId)}/collection/access`, json({}))).json()) as { token: string };
  return { link: linkFor(location.origin, campaignId, { kind: 'collection', token }) };
}

export async function listCollectors(campaignId: string): Promise<Collector[]> {
  return ((await (await call(`${campaign(campaignId)}/collection/collectors`)).json()) as { collectors: Collector[] }).collectors;
}

export async function revokeCollector(campaignId: string, collectorId: string): Promise<void> {
  await call(`${campaign(campaignId)}/collection/collectors/${encodeURIComponent(collectorId)}`, { method: 'DELETE' });
}
