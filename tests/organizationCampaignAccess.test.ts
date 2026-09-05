import assert from "node:assert/strict";
import test from "node:test";
import { resolveAccess } from "../worker/access.ts";
import { resolveOrganizationCampaignOrganizerAccess } from "../worker/organizationCampaignAccess.ts";
import organizerWorker from "../worker/indexOrganizer.ts";
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
  capabilities: string[];
  templateCapabilities: string[];
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
    if (normalized.includes("SELECT organization_id FROM campaigns WHERE id = ? LIMIT 1")) {
      const [campaignId] = this.values as [string];
      if (campaignId !== this.db.state.campaignId) return null;
      return { organization_id: this.db.state.campaignOrganizationId } as T;
    }
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
      !state.campaignOrganizationId ||
      state.campaignOrganizationId !== state.organizationId
    ) {
      return null;
    }

    return {
      membership_id: state.membershipId,
      campaign_id: state.campaignId,
      role_kind: state.role,
      capabilities_json: JSON.stringify(state.capabilities),
      template_capabilities_json: state.templateCapabilities.length
        ? JSON.stringify(state.templateCapabilities)
        : null,
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
    capabilities: [],
    templateCapabilities: [],
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

function routeRequest(current: BridgeState) {
  return new Request(`https://flyer.test/api/access/current?campaign=${encodeURIComponent(current.campaignId)}`, {
    headers: {
      cookie: `__Host-vf_organization_session=${encodeURIComponent(current.sessionSecret)}`,
    },
  });
}

async function runtimeAccessResponse(current: BridgeState) {
  const db = new BridgeDb(current);
  const response = await organizerWorker.fetch(
    routeRequest(current),
    { DB: db } as Parameters<typeof organizerWorker.fetch>[1],
  );
  return { response, db };
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
    organizationRole: "organizer",
  });

  const access = await resolveAccess(db, request(current.sessionSecret), current.campaignId);
  assert.equal(access?.role, "admin");
  assert.equal(access?.campaignId, current.campaignId);
  assert.equal(access?.grantId, `organization:${current.membershipId}`);
  assert.equal(access?.label, "Organizer");

  assert.match(db.lastBridgeQuery, /a\.disabled_at IS NULL/u);
  assert.match(db.lastBridgeQuery, /m\.disabled_at IS NULL/u);
  assert.match(db.lastBridgeQuery, /c\.organization_id = m\.organization_id/u);
  assert.match(db.lastBridgeQuery, /s\.revoked_at IS NULL/u);
  assert.match(db.lastBridgeQuery, /s\.assurance = 'mfa'/u);
});

test("Organization Admin receives Campaign admin access only with campaign.manage", async () => {
  const direct = await state({ role: "admin", capabilities: ["campaign.manage"] });
  assert.equal(
    (await resolveAccess(new BridgeDb(direct), request(direct.sessionSecret), direct.campaignId))?.role,
    "admin",
  );

  const viaTemplate = await state({ role: "admin", templateCapabilities: ["campaign.manage"] });
  assert.equal(
    (await resolveAccess(new BridgeDb(viaTemplate), request(viaTemplate.sessionSecret), viaTemplate.campaignId))?.role,
    "admin",
  );

  const restricted = await state({ role: "admin", capabilities: ["audit.read"] });
  assert.equal(
    await resolveAccess(new BridgeDb(restricted), request(restricted.sessionSecret), restricted.campaignId),
    null,
  );
});

test("Organizer runtime routes central Campaign access and keeps tenant/capability checks server-side", async () => {
  const allowed = await state({ role: "admin", capabilities: ["campaign.manage"] });
  const allowedResult = await runtimeAccessResponse(allowed);
  assert.equal(allowedResult.response.status, 200);
  assert.deepEqual(await allowedResult.response.json(), {
    access: {
      campaignId: allowed.campaignId,
      role: "admin",
      teamId: null,
      label: "Organizer",
      collectorId: null,
      collectionAccessId: null,
      identityProvider: "organization",
    },
  });
  assert.equal(allowedResult.response.headers.get("cache-control"), "no-store");
  assert.equal(allowedResult.response.headers.get("x-frame-options"), "DENY");

  const restricted = await state({ role: "admin", capabilities: ["audit.read"] });
  const restrictedResult = await runtimeAccessResponse(restricted);
  assert.equal(restrictedResult.response.status, 401);
  assert.deepEqual(await restrictedResult.response.json(), {
    error: {
      code: "organization_access_required",
      message: "Für diese Campaign ist eine zentrale Organization-Anmeldung mit ausreichender Berechtigung erforderlich.",
    },
  });

  const foreign = await state({
    role: "admin",
    capabilities: ["campaign.manage"],
    campaignOrganizationId: "org_b",
  });
  const foreignResult = await runtimeAccessResponse(foreign);
  assert.equal(foreignResult.response.status, 401);
  assert.deepEqual(await foreignResult.response.json(), {
    error: {
      code: "organization_access_required",
      message: "Für diese Campaign ist eine zentrale Organization-Anmeldung mit ausreichender Berechtigung erforderlich.",
    },
  });
});

test("Organization bridge rejects foreign and legacy-unowned Campaigns", async () => {
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

test("Organization bridge rejects recovery assurance, disabled identities, revoked and expired sessions", async () => {
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
