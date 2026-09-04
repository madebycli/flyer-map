import assert from "node:assert/strict";
import test from "node:test";
import { resolveAccess } from "../worker/access.ts";
import { resolveOrganizationCampaignOrganizerAccess } from "../worker/organizationCampaignAccess.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";

type BridgeState = {
  sessionSecret: string;
  sessionHash: string;
  accountId: string;
  accountDisabled: boolean;
  assurance: "mfa" | "recovery";
  expiresAt: string;
  revoked: boolean;
  membershipId: string;
  membershipDisabled: boolean;
  role: "organizer" | "admin";
  organizationId: string;
  campaignId: string;
  campaignOrganizationId: string | null;
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

class BridgeStatement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(
    private readonly db: BridgeDb,
    readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    const normalized = this.query.replace(/\s+/gu, " ").trim();
    if (!normalized.includes("FROM organization_account_sessions s")) return null;
    this.db.lastBridgeQuery = normalized;
    if (!this.db.schemaAvailable) throw new Error("no such table: organization_account_sessions");

    const [campaignId, sessionHash, now] = this.values as [string, string, string];
    const state = this.db.state;
    if (
      campaignId !== state.campaignId ||
      sessionHash !== state.sessionHash ||
      state.expiresAt <= now ||
      state.revoked ||
      state.assurance !== "mfa" ||
      state.accountDisabled ||
      state.membershipDisabled ||
      state.role !== "organizer" ||
      !state.campaignOrganizationId ||
      state.campaignOrganizationId !== state.organizationId
    ) {
      return null;
    }

    return {
      membership_id: state.membershipId,
      campaign_id: state.campaignId,
    } as T;
  }

  async all<T>() {
    return { results: [] as T[] };
  }
}

class BridgeDb implements D1DatabaseLike {
  schemaAvailable = true;
  lastBridgeQuery = "";

  constructor(readonly state: BridgeState) {}

  prepare(query: string) {
    return new BridgeStatement(this, query);
  }

  async batch(_statements: D1PreparedStatement[]) {
    return [] as D1RunResult[];
  }
}

async function state(overrides: Partial<BridgeState> = {}): Promise<BridgeState> {
  const sessionSecret = overrides.sessionSecret ?? "organization-session-secret";
  return {
    sessionSecret,
    sessionHash: overrides.sessionHash ?? await sha256(sessionSecret),
    accountId: "account_a",
    accountDisabled: false,
    assurance: "mfa",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    revoked: false,
    membershipId: "membership_a",
    membershipDisabled: false,
    role: "organizer",
    organizationId: "org_a",
    campaignId: "campaign_a",
    campaignOrganizationId: "org_a",
    ...overrides,
  };
}

function request(sessionSecret: string) {
  return new Request("https://flyer.test/?campaign=campaign_a", {
    headers: {
      cookie: `__Host-vf_organization_session=${encodeURIComponent(sessionSecret)}`,
    },
  });
}

test("MFA Organizer receives synthetic admin access for an owned Campaign", async () => {
  const current = await state();
  const db = new BridgeDb(current);

  const bridge = await resolveOrganizationCampaignOrganizerAccess(
    db,
    request(current.sessionSecret),
    current.campaignId,
  );
  assert.deepEqual(bridge, {
    membershipId: current.membershipId,
    campaignId: current.campaignId,
  });

  const access = await resolveAccess(db, request(current.sessionSecret), current.campaignId);
  assert.equal(access?.role, "admin");
  assert.equal(access?.campaignId, current.campaignId);
  assert.equal(access?.grantId, `organization:${current.membershipId}`);
  assert.equal(access?.label, "Organizer");

  assert.match(db.lastBridgeQuery, /a\.disabled_at IS NULL/u);
  assert.match(db.lastBridgeQuery, /m\.disabled_at IS NULL/u);
  assert.match(db.lastBridgeQuery, /m\.role_kind = 'organizer'/u);
  assert.match(db.lastBridgeQuery, /c\.organization_id = m\.organization_id/u);
  assert.match(db.lastBridgeQuery, /s\.revoked_at IS NULL/u);
  assert.match(db.lastBridgeQuery, /s\.assurance = 'mfa'/u);
});

test("Organizer bridge rejects foreign and legacy-unowned Campaigns", async () => {
  const foreign = await state({ campaignOrganizationId: "org_b" });
  assert.equal(
    await resolveOrganizationCampaignOrganizerAccess(
      new BridgeDb(foreign),
      request(foreign.sessionSecret),
      foreign.campaignId,
    ),
    null,
  );

  const legacy = await state({ campaignOrganizationId: null });
  assert.equal(
    await resolveOrganizationCampaignOrganizerAccess(
      new BridgeDb(legacy),
      request(legacy.sessionSecret),
      legacy.campaignId,
    ),
    null,
  );
});

test("Organizer bridge rejects recovery assurance, disabled identities, revoked and expired sessions", async () => {
  const cases: Partial<BridgeState>[] = [
    { assurance: "recovery" },
    { accountDisabled: true },
    { membershipDisabled: true },
    { revoked: true },
    { expiresAt: new Date(Date.now() - 60_000).toISOString() },
  ];

  for (const overrides of cases) {
    const current = await state(overrides);
    assert.equal(
      await resolveOrganizationCampaignOrganizerAccess(
        new BridgeDb(current),
        request(current.sessionSecret),
        current.campaignId,
      ),
      null,
    );
  }
});

test("Organization Admin does not inherit legacy full-admin access without capability mapping", async () => {
  const current = await state({ role: "admin" });
  assert.equal(
    await resolveAccess(new BridgeDb(current), request(current.sessionSecret), current.campaignId),
    null,
  );
});

test("missing Organization schema fails closed without breaking legacy-compatible access resolution", async () => {
  const current = await state();
  const db = new BridgeDb(current);
  db.schemaAvailable = false;

  assert.equal(
    await resolveOrganizationCampaignOrganizerAccess(
      db,
      request(current.sessionSecret),
      current.campaignId,
    ),
    null,
  );
  assert.equal(await resolveAccess(db, request(current.sessionSecret), current.campaignId), null);
});
