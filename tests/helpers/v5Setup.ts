import { NetworkD1, seedNetwork } from './networkD1.ts';
import { createAccessGrant, createSessionForGrant, sessionCookie, type PersistentAccessRole } from '../../worker/access.ts';
import { handleV5Api } from '../../worker/v5/api.ts';
import { encodeClock } from '../../src/v5/store/hlc.ts';

export const campaign = 'campaign_n';
export const stamp = (wall: number, counter = 0, node = 'n') => encodeClock({ wall, counter, node });
export const NOW = 1_800_000_000_000;

export async function setup() {
  const db = new NetworkD1(false, true);
  seedNetwork(db);
  const t = '2026-09-07T00:00:00.000Z';
  db.sqlite.prepare("INSERT INTO teams(id,campaign_id,name,color,created_at,updated_at) VALUES('team_o',?,'Other','#ef4444',?,?)").run(campaign, t, t);
  db.sqlite.prepare("INSERT INTO areas(id,campaign_id,team_id,name,geometry_json,created_at,updated_at) VALUES('area_o',?,'team_o','Other',?,?,?)")
    .run(campaign, JSON.stringify({ type: 'Polygon', coordinates: [[[13.02, 51], [13.03, 51], [13.03, 51.01], [13.02, 51.01], [13.02, 51]]] }), t, t);
  const cookies: Record<string, string> = {};
  for (const [name, role, teamId] of [['admin', 'admin', null], ['viewer', 'viewer', null], ['editor', 'team-editor', 'team_n'], ['other', 'team-editor', 'team_o']] as [string, PersistentAccessRole, string | null][]) {
    const { grant } = await createAccessGrant(db, { campaignId: campaign, role, teamId, label: name });
    const ctx = (await resolveAccessForGrant(db, grant.grantId))!;
    const session = await createSessionForGrant(db, ctx);
    cookies[name] = `${sessionCookie(session.sessionSecret).split(';')[0]}`;
  }
  const call = async (who: string | null, method: string, path: string, body?: unknown, opts = {}) => {
    const request = new Request(`https://example.test${path}`, {
      method, headers: { ...(who ? { cookie: cookies[who] } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    return (await handleV5Api(request, db, { now: () => NOW, ...opts }))!;
  };
  return { db, call };
}

async function resolveAccessForGrant(db: NetworkD1, grantId: string) {
  const row = db.sqlite.prepare('SELECT id, campaign_id, role, team_id, label FROM campaign_access_grants WHERE id=?').get(grantId) as { id: string; campaign_id: string; role: PersistentAccessRole; team_id: string | null; label: string | null };
  return { grantId: row.id, campaignId: row.campaign_id, role: row.role, teamId: row.team_id, label: row.label };
}

