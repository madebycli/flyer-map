import assert from "node:assert/strict";
import test from "node:test";
import {
  createAccessGrant,
  createSessionForGrant,
  hashSecret,
  redeemAccessToken,
  resolveAccess,
  revokeAccessGrant,
  sessionCookie,
  type AccessRole,
} from "../worker/access.ts";
import type { D1DatabaseLike, D1PreparedStatement, D1RunResult } from "../worker/campaignRepository.ts";

type Grant = {
  id: string;
  campaignId: string;
  role: AccessRole;
  teamId: string | null;
  tokenHash: string;
  label: string | null;
  revokedAt: string | null;
};

type Session = {
  id: string;
  grantId: string;
  campaignId: string;
  sessionHash: string;
  expiresAt: string;
};

class Statement implements D1PreparedStatement {
  values: unknown[] = [];
  constructor(readonly db: AccessDb, readonly query: string) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    const query = this.query.replace(/\s+/g, " ");
    if (query.includes("FROM campaign_sessions s")) {
      const [sessionHash, now, campaignId] = this.values as [string, string, string | null];
      const session = this.db.sessions.find((item) => item.sessionHash === sessionHash && item.expiresAt > now);
      if (!session) return null;
      const grant = this.db.grants.find(
        (item) =>
          item.id === session.grantId &&
          item.campaignId === session.campaignId &&
          item.revokedAt === null &&
          (!campaignId || item.campaignId === campaignId),
      );
      if (!grant) return null;
      return {
        grant_id: grant.id,
        campaign_id: grant.campaignId,
        role: grant.role,
        team_id: grant.teamId,
        label: grant.label,
      } as T;
    }
    if (query.includes("WHERE token_hash = ?")) {
      const [tokenHash, campaignId] = this.values as [string, string];
      const grant = this.db.grants.find(
        (item) => item.tokenHash === tokenHash && item.campaignId === campaignId && item.revokedAt === null,
      );
      if (!grant) return null;
      return {
        id: grant.id,
        campaign_id: grant.campaignId,
        role: grant.role,
        team_id: grant.teamId,
        label: grant.label,
      } as T;
    }
    return null;
  }
  async all<T>() {
    return { results: [] as T[] };
  }
}

class AccessDb implements D1DatabaseLike {
  grants: Grant[] = [];
  sessions: Session[] = [];
  capturedValues: unknown[][] = [];

  prepare(query: string) {
    return new Statement(this, query);
  }

  async batch(statements: D1PreparedStatement[]) {
    const results: D1RunResult[] = [];
    for (const item of statements as Statement[]) {
      this.capturedValues.push(item.values);
      const query = item.query.replace(/\s+/g, " ").trim();
      let changes = 0;
      if (query.startsWith("INSERT INTO campaign_access_grants")) {
        const [id, campaignId, role, teamId, tokenHash, label] = item.values as [
          string,
          string,
          AccessRole,
          string | null,
          string,
          string | null,
        ];
        this.grants.push({ id, campaignId, role, teamId, tokenHash, label, revokedAt: null });
        changes = 1;
      } else if (query.startsWith("INSERT INTO campaign_sessions")) {
        const [id, grantId, campaignId, sessionHash, , expiresAt] = item.values as string[];
        this.sessions.push({ id, grantId, campaignId, sessionHash, expiresAt });
        changes = 1;
      } else if (query.startsWith("UPDATE campaign_access_grants")) {
        const [revokedAt, grantId, campaignId] = item.values as [string, string, string];
        const grant = this.grants.find((candidate) => candidate.id === grantId && candidate.campaignId === campaignId);
        if (grant) {
          grant.revokedAt ??= revokedAt;
          changes = 1;
        }
      }
      results.push({ success: true, meta: { changes } });
    }
    return results;
  }
}

function requestWithSession(secret?: string) {
  return new Request("https://flyer.test/api/campaigns/campaign_a/version", {
    headers: secret ? { cookie: `vf_session=${secret}` } : undefined,
  });
}

test("no session credential resolves to no campaign access", async () => {
  const db = new AccessDb();
  assert.equal(await resolveAccess(db, requestWithSession(), "campaign_a"), null);
});

test("invite token has strong random shape and D1 only receives its SHA-256 hash", async () => {
  const db = new AccessDb();
  const created = await createAccessGrant(db, {
    campaignId: "campaign_a",
    role: "viewer",
    teamId: null,
    label: "Phone B",
  });

  assert.ok(created.token.length >= 43);
  assert.match(created.token, /^[A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify(db.capturedValues).includes(created.token), false);
  assert.equal(db.grants[0].tokenHash, await hashSecret(created.token));
  assert.equal(db.grants[0].tokenHash.length, 64);
});

test("session is campaign-scoped and grant revocation invalidates it immediately", async () => {
  const db = new AccessDb();
  const created = await createAccessGrant(db, {
    campaignId: "campaign_a",
    role: "admin",
    teamId: null,
    label: null,
  });
  const session = await createSessionForGrant(db, {
    grantId: created.grant.grantId,
    campaignId: "campaign_a",
    role: "admin",
    teamId: null,
    label: null,
  });

  assert.match(sessionCookie(session.sessionSecret), /HttpOnly/);
  assert.match(sessionCookie(session.sessionSecret), /Secure/);
  assert.match(sessionCookie(session.sessionSecret), /SameSite=Lax/);
  assert.equal((await resolveAccess(db, requestWithSession(session.sessionSecret), "campaign_a"))?.role, "admin");
  assert.equal(await resolveAccess(db, requestWithSession(session.sessionSecret), "campaign_b"), null);

  assert.equal(await revokeAccessGrant(db, "campaign_a", created.grant.grantId), true);
  assert.equal(await resolveAccess(db, requestWithSession(session.sessionSecret), "campaign_a"), null);
});

test("invite redemption rejects invalid or wrong-campaign tokens", async () => {
  const db = new AccessDb();
  const created = await createAccessGrant(db, {
    campaignId: "campaign_a",
    role: "viewer",
    teamId: null,
    label: null,
  });

  assert.equal(await redeemAccessToken(db, "campaign_a", "x".repeat(43)), null);
  assert.equal(await redeemAccessToken(db, "campaign_b", created.token), null);
  assert.equal((await redeemAccessToken(db, "campaign_a", created.token))?.access.role, "viewer");
});
