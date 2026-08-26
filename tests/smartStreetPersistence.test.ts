import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AccessContext } from "../worker/access.ts";
import { authorizeSnapshotWrite } from "../worker/authorization.ts";
import {
  loadCampaignSnapshot,
  replaceCampaignSnapshot,
  type D1DatabaseLike,
  type D1PreparedStatement,
  type D1RunResult,
} from "../worker/campaignRepository.ts";
import { persistCampaignMutation } from "../worker/mutationRepository.ts";
import { validateCampaignMutation } from "../worker/mutationValidation.ts";
import { validateCampaignSnapshot } from "../worker/snapshotValidation.ts";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import { deriveCampaignMutation } from "../src/domain/mutationDiff.ts";
import { applyCampaignMutation, type CampaignMutation } from "../src/domain/mutations.ts";
import type { SmartRoadCandidate } from "../src/domain/smartCandidates.ts";
import type { SmartRoadPointAnchor } from "../src/domain/smartRoadPointAnchor.ts";
import { createSmartStreetTaskSnapshot } from "../src/domain/smartStreetTask.ts";

const createdAt = "2026-08-26T10:00:00.000Z";

function road(
  sourceId: string,
  osmId: number,
  coordinates: Array<[number, number]>,
): SmartRoadCandidate {
  return {
    sourceId,
    osmId,
    name: "Teststraße",
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates },
  };
}

function anchor(
  sourceId: string,
  segmentIndex: number,
  segmentT: number,
  snapped: [number, number],
): SmartRoadPointAnchor {
  return { sourceId, segmentIndex, segmentT, snapped, distanceMeters: 0 };
}

function baseSnapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 4,
    campaign: {
      id: "campaign_smart-street",
      name: "Aktion",
      status: "active",
      defaultMapView: null,
      createdAt,
      updatedAt: createdAt,
    },
    teams: [
      {
        id: "team_a",
        campaignId: "campaign_smart-street",
        name: "Team A",
        color: "#2563eb",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    areas: [
      {
        id: "area_a",
        campaignId: "campaign_smart-street",
        teamId: "team_a",
        name: "Gebiet A",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [10, 50],
            [10.1, 50],
            [10.1, 50.1],
            [10, 50],
          ]],
        },
        createdAt,
        updatedAt: createdAt,
      },
    ],
    tasks: [],
  };
}

function smartTask() {
  const roads = [
    road("way/101", 101, [[10, 50], [10.01, 50]]),
    road("way/102", 102, [[10.01, 50], [10.02, 50]]),
  ];
  return createSmartStreetTaskSnapshot({
    campaignId: "campaign_smart-street",
    areaId: "area_a",
    label: "Teststraße",
    roads,
    sourceIds: ["way/101", "way/102"],
    startAnchor: anchor("way/101", 0, 0.25, [10.0025, 50]),
    endAnchor: anchor("way/102", 0, 0.5, [10.015, 50]),
    taskId: "task_smart-1",
    timestamp: "2026-08-26T10:05:00.000Z",
  });
}

function createTaskMutation(task = smartTask()) {
  const previous = baseSnapshot();
  const next: CampaignSnapshot = {
    ...previous,
    revision: previous.revision + 1,
    campaign: { ...previous.campaign, updatedAt: task.createdAt },
    tasks: [task],
  };
  const mutation = deriveCampaignMutation(previous, next);
  if (!mutation || mutation.type !== "task.create") throw new Error("expected task.create");
  return { previous, mutation };
}

const admin: AccessContext = {
  grantId: "grant_admin",
  campaignId: "campaign_smart-street",
  role: "admin",
  teamId: null,
  label: null,
};

test("Smart Street snapshot derives a task.create mutation with separate OSM provenance", () => {
  const { previous, mutation } = createTaskMutation();
  assert.equal(mutation.payload.taskId, "task_smart-1");
  assert.deepEqual(mutation.payload.source, {
    dataset: "OpenStreetMap",
    objectType: "way",
    objectIds: [101, 102],
  });
  assert.equal(validateCampaignMutation(mutation, previous.campaign.id).valid, true);

  const applied = applyCampaignMutation(previous, mutation);
  assert.deepEqual(applied.tasks[0].source, mutation.payload.source);
  assert.equal(validateCampaignSnapshot(applied, previous.campaign.id).valid, true);
});

test("server validation rejects forged Task identity and malformed OSM provenance", () => {
  const previous = baseSnapshot();
  const valid: CampaignMutation = {
    id: "mutation_smart-create",
    campaignId: previous.campaign.id,
    type: "task.create",
    payload: {
      taskId: "task_smart-1",
      areaId: "area_a",
      label: "Teststraße",
      geometry: { type: "LineString", coordinates: [[10, 50], [10.01, 50]] },
      source: { dataset: "OpenStreetMap", objectType: "way", objectIds: [101] },
    },
    baseRevision: previous.revision,
    createdAt,
  };

  assert.equal(validateCampaignMutation(valid, previous.campaign.id).valid, true);
  for (const taskId of ["osm_101", "task_"]) {
    assert.equal(
      validateCampaignMutation(
        { ...valid, payload: { ...valid.payload, taskId } },
        previous.campaign.id,
      ).valid,
      false,
    );
  }
  assert.equal(
    validateCampaignMutation(
      {
        ...valid,
        payload: {
          ...valid.payload,
          source: {
            dataset: "OpenStreetMap",
            objectType: "way",
            objectIds: [101],
            injected: "<script>alert(1)</script>",
          },
        },
      },
      previous.campaign.id,
    ).valid,
    false,
  );
  assert.equal(
    validateCampaignMutation(
      {
        ...valid,
        payload: {
          ...valid.payload,
          source: { dataset: "OpenStreetMap", objectType: "way", objectIds: ["101"] },
        },
      },
      previous.campaign.id,
    ).valid,
    false,
  );
  assert.equal(
    validateCampaignMutation(
      {
        ...valid,
        payload: {
          ...valid.payload,
          source: { dataset: "OpenStreetMap", objectType: "way", objectIds: [101, 101] },
        },
      },
      previous.campaign.id,
    ).valid,
    false,
  );
});

test("schema-v3 remains compatible with manual tasks while validating Smart Street provenance", () => {
  const manual = baseSnapshot();
  manual.tasks = [{
    ...smartTask(),
    id: "task_manual-1",
    source: undefined,
  }];
  assert.equal(validateCampaignSnapshot(manual, manual.campaign.id).valid, true);

  const smart = baseSnapshot();
  smart.tasks = [smartTask()];
  assert.equal(validateCampaignSnapshot(smart, smart.campaign.id).valid, true);

  const wrongType = structuredClone(smart) as unknown as {
    tasks: Array<{ source: unknown }>;
  };
  wrongType.tasks[0].source = {
    dataset: "OpenStreetMap",
    objectType: "node",
    objectIds: [101],
  };
  assert.equal(validateCampaignSnapshot(wrongType, smart.campaign.id).valid, false);

  const duplicateIds = structuredClone(smart) as unknown as {
    tasks: Array<{ source: unknown }>;
  };
  duplicateIds.tasks[0].source = {
    dataset: "OpenStreetMap",
    objectType: "way",
    objectIds: [101, 101],
  };
  assert.equal(validateCampaignSnapshot(duplicateIds, smart.campaign.id).valid, false);
});

test("legacy full-snapshot authorization cannot strip existing Smart Street provenance", () => {
  const previous = baseSnapshot();
  previous.tasks = [smartTask()];
  const next: CampaignSnapshot = {
    ...previous,
    revision: previous.revision + 1,
    tasks: [{ ...previous.tasks[0], source: undefined }],
  };

  assert.deepEqual(authorizeSnapshotWrite(admin, previous, next), {
    allowed: false,
    reason: "task_source_provenance_immutable",
  });
});

test("legacy full-snapshot authorization cannot rewrite reviewed Smart Street geometry", () => {
  const previous = baseSnapshot();
  previous.tasks = [smartTask()];
  const next: CampaignSnapshot = {
    ...previous,
    revision: previous.revision + 1,
    tasks: [{
      ...previous.tasks[0],
      geometry: {
        type: "LineString",
        coordinates: [[10.003, 50], [10.014, 50]],
      },
    }],
  };

  assert.deepEqual(authorizeSnapshotWrite(admin, previous, next), {
    allowed: false,
    reason: "smart_street_geometry_immutable",
  });
});

class FakeStatement implements D1PreparedStatement {
  values: unknown[] = [];
  readonly query: string;

  constructor(query: string, private readonly database: CapturingDatabase) {
    this.query = query;
  }
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    return this.database.firstForQuery(this.query) as T | null;
  }
  async all<T>() {
    return { results: this.database.allForQuery(this.query) as T[] };
  }
}

class CapturingDatabase implements D1DatabaseLike {
  lastBatch: FakeStatement[] = [];
  prepared: FakeStatement[] = [];

  constructor(readonly supportsTaskSource = true) {}

  prepare(query: string) {
    const statement = new FakeStatement(query, this);
    this.prepared.push(statement);
    return statement;
  }
  firstForQuery(_query: string): unknown | null {
    return null;
  }
  allForQuery(query: string): unknown[] {
    if (/PRAGMA table_info\(tasks\)/u.test(query)) {
      return this.supportsTaskSource ? [{ name: "id" }, { name: "source_json" }] : [{ name: "id" }];
    }
    return [];
  }
  async batch(statements: D1PreparedStatement[]) {
    this.lastBatch = statements as FakeStatement[];
    return this.lastBatch.map<D1RunResult>(() => ({ success: true, meta: { changes: 1 } }));
  }
}

class PreMigrationReadDatabase extends CapturingDatabase {
  constructor() {
    super(false);
  }

  override firstForQuery(query: string): unknown | null {
    if (/FROM campaigns WHERE id = \?/u.test(query) && /SELECT id, name, status, revision/u.test(query)) {
      return {
        id: "campaign_smart-street",
        name: "Aktion",
        status: "active",
        revision: 4,
        map_center_lng: null,
        map_center_lat: null,
        map_zoom: null,
        map_bearing: null,
        created_at: createdAt,
        updated_at: createdAt,
      };
    }
    return null;
  }

  override allForQuery(query: string): unknown[] {
    if (/PRAGMA table_info\(tasks\)/u.test(query)) return [{ name: "id" }];
    if (/FROM tasks WHERE campaign_id = \?/u.test(query)) {
      assert.match(query, /NULL AS source_json/u);
      return [{
        id: "task_manual-legacy",
        campaign_id: "campaign_smart-street",
        area_id: "area_a",
        task_type: "street",
        label: "Legacy Street",
        geometry_json: JSON.stringify({
          type: "LineString",
          coordinates: [[10, 50], [10.01, 50]],
        }),
        source_json: null,
        status: "open",
        completed_at: null,
        created_at: createdAt,
        updated_at: createdAt,
      }];
    }
    return [];
  }
}

test("narrow task persistence binds source JSON instead of concatenating provenance into SQL", async () => {
  const { previous, mutation } = createTaskMutation();

  const db = new CapturingDatabase();
  const result = await persistCampaignMutation(db, mutation, previous.revision, "a".repeat(64));
  assert.deepEqual(result, { ok: true, revision: 5, alreadyApplied: false });

  const statement = db.lastBatch[1];
  assert.match(statement.query, /source_json/);
  assert.doesNotMatch(statement.query, /OpenStreetMap/);
  assert.doesNotMatch(statement.query, /101/);
  assert.equal(
    statement.values.includes(JSON.stringify(mutation.payload.source)),
    true,
  );
});

test("pre-migration D1 still loads legacy manual Tasks without selecting a missing column", async () => {
  const db = new PreMigrationReadDatabase();
  const snapshot = await loadCampaignSnapshot(db, "campaign_smart-street");
  assert.ok(snapshot);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0].id, "task_manual-legacy");
  assert.equal(snapshot.tasks[0].source, undefined);
});

test("pre-migration D1 still persists manual task.create without source_json", async () => {
  const manualTask = { ...smartTask(), id: "task_manual-pre-migration", source: undefined };
  const { previous, mutation } = createTaskMutation(manualTask);
  const db = new CapturingDatabase(false);

  const result = await persistCampaignMutation(db, mutation, previous.revision, "b".repeat(64));
  assert.deepEqual(result, { ok: true, revision: 5, alreadyApplied: false });
  assert.equal(db.lastBatch.length, 3);
  assert.doesNotMatch(db.lastBatch[1].query, /source_json/u);
});

test("pre-migration D1 blocks Smart Street provenance before claiming a revision", async () => {
  const { previous, mutation } = createTaskMutation();
  const db = new CapturingDatabase(false);

  const result = await persistCampaignMutation(db, mutation, previous.revision, "c".repeat(64));
  assert.deepEqual(result, {
    ok: false,
    currentRevision: previous.revision,
    reason: "schema_migration_required",
  });
  assert.equal(db.lastBatch.length, 0);
});

test("legacy snapshot replacement carries Smart Street provenance through its bound JSON batch", async () => {
  const snapshot = baseSnapshot();
  snapshot.tasks = [smartTask()];
  const db = new CapturingDatabase();

  const result = await replaceCampaignSnapshot(db, snapshot, snapshot.revision - 1);
  assert.deepEqual(result, { ok: true, revision: snapshot.revision });
  assert.equal(db.lastBatch.length, 7);
  assert.match(db.lastBatch[6].query, /source_json/);
  assert.doesNotMatch(db.lastBatch[6].query, /OpenStreetMap/);

  const boundTasks = JSON.parse(String(db.lastBatch[6].values[0]));
  assert.deepEqual(boundTasks[0].source, smartTask().source);
});

test("pre-migration legacy snapshot replacement keeps manual Tasks compatible", async () => {
  const snapshot = baseSnapshot();
  snapshot.tasks = [{ ...smartTask(), id: "task_manual-snapshot", source: undefined }];
  const db = new CapturingDatabase(false);

  const result = await replaceCampaignSnapshot(db, snapshot, snapshot.revision - 1);
  assert.deepEqual(result, { ok: true, revision: snapshot.revision });
  assert.equal(db.lastBatch.length, 7);
  assert.doesNotMatch(db.lastBatch[6].query, /source_json/u);
});

test("pre-migration legacy snapshot replacement refuses to discard Smart Street provenance", async () => {
  const snapshot = baseSnapshot();
  snapshot.tasks = [smartTask()];
  const db = new CapturingDatabase(false);

  const result = await replaceCampaignSnapshot(db, snapshot, snapshot.revision - 1);
  assert.deepEqual(result, {
    ok: false,
    currentRevision: snapshot.revision - 1,
    reason: "schema_migration_required",
  });
  assert.equal(db.lastBatch.length, 0);
});

test("M6 provenance migration is additive and nullable for existing manual tasks", () => {
  const sql = readFileSync(
    new URL("../migrations/0004_m6_task_source_provenance.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /ALTER TABLE tasks/i);
  assert.match(sql, /ADD COLUMN source_json TEXT/i);
  assert.match(sql, /source_json IS NULL OR json_valid\(source_json\)/i);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|UPDATE tasks/i);
});
