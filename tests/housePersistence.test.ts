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
import type { CampaignSnapshot, HouseTask } from "../src/domain/campaign.ts";
import { deriveCampaignMutation } from "../src/domain/mutationDiff.ts";
import { applyCampaignMutation, type CampaignMutation } from "../src/domain/mutations.ts";
import type { SmartBuildingCandidate } from "../src/domain/smartCandidates.ts";
import { createSmartHouseTaskSnapshot } from "../src/domain/smartHouseTask.ts";

const createdAt = "2026-08-26T19:00:00.000Z";

function baseSnapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 7,
    campaign: {
      id: "campaign_house-test",
      name: "Aktion",
      status: "active",
      defaultMapView: null,
      createdAt,
      updatedAt: createdAt,
    },
    teams: [
      {
        id: "team_a",
        campaignId: "campaign_house-test",
        name: "Team A",
        color: "#2563eb",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    areas: [
      {
        id: "area_a",
        campaignId: "campaign_house-test",
        teamId: "team_a",
        name: "Gebiet A",
        geometry: {
          type: "Polygon",
          coordinates: [[[10, 50], [10.1, 50], [10.1, 50.1], [10, 50]]],
        },
        createdAt,
        updatedAt: createdAt,
      },
    ],
    tasks: [
      {
        id: "task_street-1",
        campaignId: "campaign_house-test",
        areaId: "area_a",
        taskType: "street",
        label: "Hauptstraße",
        geometry: { type: "LineString", coordinates: [[10, 50], [10.05, 50]] },
        status: "open",
        completedAt: null,
        createdAt,
        updatedAt: createdAt,
      },
    ],
  };
}

function building(): SmartBuildingCandidate {
  return {
    sourceId: "way/501",
    osmId: 501,
    buildingType: "house",
    houseNumber: "12",
    street: "Hauptstraße",
    postcode: "12345",
    city: "Teststadt",
    geometry: {
      type: "Polygon",
      coordinates: [[[10.01, 50.001], [10.012, 50.001], [10.012, 50.003], [10.01, 50.001]]],
    },
  };
}

function houseTask(): HouseTask {
  return createSmartHouseTaskSnapshot({
    campaignId: "campaign_house-test",
    areaId: "area_a",
    building: building(),
    parentStreetTaskId: "task_street-1",
    taskId: "task_house-1",
    timestamp: "2026-08-26T19:05:00.000Z",
  });
}

function createHouseMutation() {
  const previous = baseSnapshot();
  const house = houseTask();
  const next: CampaignSnapshot = {
    ...previous,
    revision: previous.revision + 1,
    campaign: { ...previous.campaign, updatedAt: house.createdAt },
    houseTasks: [house],
  };
  const mutation = deriveCampaignMutation(previous, next);
  if (!mutation || mutation.type !== "house.create") throw new Error("expected house.create");
  return { previous, house, mutation };
}

function createHouseBatchMutation(count = 2) {
  const previous = baseSnapshot();
  const houses = Array.from({ length: count }, (_, index) => {
    const candidate = building();
    candidate.sourceId = `way/${501 + index}`;
    candidate.osmId = 501 + index;
    candidate.houseNumber = String(12 + index);
    candidate.geometry = {
      type: "Polygon",
      coordinates: [[
        [10.01 + index * 0.001, 50.001],
        [10.012 + index * 0.001, 50.001],
        [10.012 + index * 0.001, 50.003],
        [10.01 + index * 0.001, 50.001],
      ]],
    };
    return createSmartHouseTaskSnapshot({
      campaignId: previous.campaign.id,
      areaId: "area_a",
      building: candidate,
      parentStreetTaskId: "task_street-1",
      taskId: `task_house-${index + 1}`,
      timestamp: "2026-08-26T19:05:00.000Z",
    });
  });
  const next: CampaignSnapshot = {
    ...previous,
    revision: previous.revision + 1,
    campaign: { ...previous.campaign, updatedAt: houses[0].createdAt },
    houseTasks: houses,
  };
  const mutation = deriveCampaignMutation(previous, next);
  if (!mutation || mutation.type !== "house.create-batch") {
    throw new Error("expected house.create-batch");
  }
  return { previous, houses, mutation };
}

const admin: AccessContext = {
  grantId: "grant_admin",
  campaignId: "campaign_house-test",
  role: "admin",
  teamId: null,
  label: null,
};

const editor: AccessContext = {
  grantId: "grant_editor",
  campaignId: "campaign_house-test",
  role: "team-editor",
  teamId: "team_a",
  label: null,
};

const viewer: AccessContext = {
  grantId: "grant_viewer",
  campaignId: "campaign_house-test",
  role: "viewer",
  teamId: null,
  label: null,
};

test("Smart House snapshot keeps application identity separate from OSM provenance", () => {
  const house = houseTask();
  assert.equal(house.id, "task_house-1");
  assert.equal(house.taskType, "house");
  assert.equal(house.label, "Hauptstraße 12");
  assert.equal(house.parentStreetTaskId, "task_street-1");
  assert.deepEqual(house.source, {
    dataset: "OpenStreetMap",
    objectType: "way",
    objectIds: [501],
  });
  assert.equal(house.geometry.type, "Polygon");
});

test("House create derives, validates and applies through the M5 mutation model", () => {
  const { previous, mutation } = createHouseMutation();
  assert.equal(validateCampaignMutation(mutation, previous.campaign.id).valid, true);

  const applied = applyCampaignMutation(previous, mutation);
  assert.equal(applied.houseTasks?.length, 1);
  assert.equal(applied.houseTasks?.[0].id, "task_house-1");
  assert.equal(validateCampaignSnapshot(applied, previous.campaign.id).valid, true);
  assert.equal(authorizeSnapshotWrite(editor, previous, applied).allowed, true);
  assert.deepEqual(authorizeSnapshotWrite(viewer, previous, applied), {
    allowed: false,
    reason: "viewer_read_only",
  });
});

test("multiple reviewed Houses derive into one bounded atomic batch mutation", () => {
  const { previous, houses, mutation } = createHouseBatchMutation();
  assert.equal(validateCampaignMutation(mutation, previous.campaign.id).valid, true);
  const applied = applyCampaignMutation(previous, mutation);
  assert.deepEqual(applied.houseTasks?.map((house) => house.id), houses.map((house) => house.id));
  assert.equal(applied.revision, previous.revision + 1);
  assert.equal(validateCampaignSnapshot(applied, previous.campaign.id).valid, true);
  assert.equal(authorizeSnapshotWrite(editor, previous, applied).allowed, true);
});

test("House batch rejects duplicate IDs, cross-area parents and more than 50 entries", () => {
  const { previous, mutation } = createHouseBatchMutation();
  const duplicate = {
    ...mutation,
    payload: { houses: [mutation.payload.houses[0], mutation.payload.houses[0]] },
  };
  assert.equal(validateCampaignMutation(duplicate, previous.campaign.id).valid, false);

  const { mutation: fifty } = createHouseBatchMutation(50);
  const tooMany = {
    ...fifty,
    payload: {
      houses: [
        ...fifty.payload.houses,
        { ...fifty.payload.houses[0], taskId: "task_house-51" },
      ],
    },
  };
  assert.equal(validateCampaignMutation(tooMany, previous.campaign.id).valid, false);

  const crossAreaPrevious = structuredClone(previous);
  crossAreaPrevious.areas.push({
    ...crossAreaPrevious.areas[0],
    id: "area_b",
    teamId: "team_a",
    name: "Gebiet B",
  });
  crossAreaPrevious.tasks.push({
    ...crossAreaPrevious.tasks[0],
    id: "task_street-foreign",
    areaId: "area_b",
    label: "Fremde Straße",
  });
  const crossArea = {
    ...mutation,
    payload: {
      houses: mutation.payload.houses.map((house) => ({
        ...house,
        parentStreetTaskId: "task_street-foreign",
      })),
    },
  };
  assert.throws(
    () => applyCampaignMutation(crossAreaPrevious, crossArea),
    (error) => error instanceof Error && error.message === "house_parent_area_mismatch",
  );
});

test("House validation rejects multi-way provenance and missing/cross-area parents", () => {
  const { previous, mutation } = createHouseMutation();
  const invalidSource = {
    ...mutation,
    payload: {
      ...mutation.payload,
      source: { dataset: "OpenStreetMap", objectType: "way", objectIds: [501, 502] },
    },
  };
  assert.equal(validateCampaignMutation(invalidSource, previous.campaign.id).valid, false);

  const missingParent = structuredClone(previous);
  missingParent.houseTasks = [{ ...houseTask(), parentStreetTaskId: "task_missing" }];
  assert.equal(validateCampaignSnapshot(missingParent, previous.campaign.id).valid, false);

  const otherArea = structuredClone(previous);
  otherArea.areas.push({
    ...otherArea.areas[0],
    id: "area_b",
    name: "Gebiet B",
  });
  otherArea.houseTasks = [{ ...houseTask(), areaId: "area_b", parentStreetTaskId: "task_street-1" }];
  assert.equal(validateCampaignSnapshot(otherArea, previous.campaign.id).valid, false);
});

test("reviewed House geometry, source and parent cannot be silently rewritten", () => {
  const previous = baseSnapshot();
  previous.houseTasks = [houseTask()];
  const next: CampaignSnapshot = {
    ...previous,
    revision: previous.revision + 1,
    houseTasks: [{
      ...previous.houseTasks[0],
      geometry: {
        type: "Polygon",
        coordinates: [[[10.02, 50.002], [10.022, 50.002], [10.022, 50.004], [10.02, 50.002]]],
      },
    }],
  };

  assert.deepEqual(authorizeSnapshotWrite(admin, previous, next), {
    allowed: false,
    reason: "house_snapshot_immutable",
  });
});

test("deleting a parent Street clears the House relationship deterministically", () => {
  const previous = baseSnapshot();
  previous.houseTasks = [houseTask()];
  const mutation: CampaignMutation = {
    id: "mutation_delete-parent",
    campaignId: previous.campaign.id,
    type: "task.delete",
    payload: { taskId: "task_street-1", expectedUpdatedAt: createdAt },
    baseRevision: previous.revision,
    createdAt: "2026-08-26T19:10:00.000Z",
  };

  const next = applyCampaignMutation(previous, mutation);
  assert.equal(next.tasks.length, 0);
  assert.equal(next.houseTasks?.[0].parentStreetTaskId, null);
  assert.equal(validateCampaignSnapshot(next, previous.campaign.id).valid, true);
  assert.equal(authorizeSnapshotWrite(editor, previous, next).allowed, true);
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

  constructor(
    readonly supportsHouses: boolean,
    readonly supportsTaskSource = true,
  ) {}

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
    if (/PRAGMA table_info\(house_tasks\)/u.test(query)) {
      return this.supportsHouses ? [{ name: "id" }, { name: "source_json" }] : [];
    }
    return [];
  }
  async batch(statements: D1PreparedStatement[]) {
    this.lastBatch = statements as FakeStatement[];
    return this.lastBatch.map<D1RunResult>(() => ({ success: true, meta: { changes: 1 } }));
  }
}

class HouseReadDatabase extends CapturingDatabase {
  constructor() {
    super(true, true);
  }

  override firstForQuery(query: string): unknown | null {
    if (/FROM campaigns WHERE id = \?/u.test(query) && /SELECT id, name, status, revision/u.test(query)) {
      return {
        id: "campaign_house-test",
        name: "Aktion",
        status: "active",
        revision: 7,
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
    const pragma = super.allForQuery(query);
    if (pragma.length > 0 || /PRAGMA table_info/u.test(query)) return pragma;
    if (/FROM teams WHERE campaign_id/u.test(query)) {
      return [{
        id: "team_a",
        campaign_id: "campaign_house-test",
        name: "Team A",
        color: "#2563eb",
        created_at: createdAt,
        updated_at: createdAt,
      }];
    }
    if (/FROM areas WHERE campaign_id/u.test(query)) {
      return [{
        id: "area_a",
        campaign_id: "campaign_house-test",
        team_id: "team_a",
        name: "Gebiet A",
        geometry_json: JSON.stringify(baseSnapshot().areas[0].geometry),
        created_at: createdAt,
        updated_at: createdAt,
      }];
    }
    if (/FROM tasks WHERE campaign_id/u.test(query)) {
      const task = baseSnapshot().tasks[0];
      return [{
        id: task.id,
        campaign_id: task.campaignId,
        area_id: task.areaId,
        task_type: "street",
        label: task.label,
        geometry_json: JSON.stringify(task.geometry),
        source_json: null,
        status: task.status,
        completed_at: task.completedAt,
        created_at: task.createdAt,
        updated_at: task.updatedAt,
      }];
    }
    if (/FROM house_tasks WHERE campaign_id/u.test(query)) {
      const task = houseTask();
      return [{
        id: task.id,
        campaign_id: task.campaignId,
        area_id: task.areaId,
        parent_street_task_id: task.parentStreetTaskId,
        label: task.label,
        geometry_json: JSON.stringify(task.geometry),
        source_json: JSON.stringify(task.source),
        status: task.status,
        completed_at: task.completedAt,
        created_at: task.createdAt,
        updated_at: task.updatedAt,
      }];
    }
    return [];
  }
}

test("pre-0005 House mutation fails before claiming a Campaign revision", async () => {
  const { previous, mutation } = createHouseMutation();
  const db = new CapturingDatabase(false);

  const result = await persistCampaignMutation(db, mutation, previous.revision, "a".repeat(64));
  assert.deepEqual(result, {
    ok: false,
    currentRevision: previous.revision,
    reason: "schema_migration_required",
  });
  assert.equal(db.lastBatch.length, 0);
});

test("House create uses bound JSON and the additive house_tasks table", async () => {
  const { previous, mutation } = createHouseMutation();
  const db = new CapturingDatabase(true);

  const result = await persistCampaignMutation(db, mutation, previous.revision, "b".repeat(64));
  assert.deepEqual(result, { ok: true, revision: 8, alreadyApplied: false });
  assert.equal(db.lastBatch.length, 3);
  assert.match(db.lastBatch[1].query, /INSERT INTO house_tasks/u);
  assert.doesNotMatch(db.lastBatch[1].query, /OpenStreetMap/u);
  assert.equal(db.lastBatch[1].values.includes(JSON.stringify(mutation.payload.geometry)), true);
  assert.equal(db.lastBatch[1].values.includes(JSON.stringify(mutation.payload.source)), true);
});

test("House batch uses one bound JSON statement and never puts OSM into SQL", async () => {
  const { previous, mutation } = createHouseBatchMutation();
  const db = new CapturingDatabase(true);

  const result = await persistCampaignMutation(db, mutation, previous.revision, "c".repeat(64));
  assert.deepEqual(result, { ok: true, revision: 8, alreadyApplied: false });
  assert.equal(db.lastBatch.length, 3);
  assert.match(db.lastBatch[1].query, /INSERT INTO house_tasks/u);
  assert.match(db.lastBatch[1].query, /json_each\(\?\)/u);
  assert.doesNotMatch(db.lastBatch[1].query, /OpenStreetMap/u);
  assert.equal(db.lastBatch[1].values.includes(JSON.stringify(mutation.payload.houses)), true);
});

test("pre-0005 House batch fails before claiming a Campaign revision", async () => {
  const { previous, mutation } = createHouseBatchMutation();
  const db = new CapturingDatabase(false);

  const result = await persistCampaignMutation(db, mutation, previous.revision, "d".repeat(64));
  assert.deepEqual(result, {
    ok: false,
    currentRevision: previous.revision,
    reason: "schema_migration_required",
  });
  assert.equal(db.lastBatch.length, 0);
});

test("Campaign snapshot loading joins durable House Tasks only when 0005 exists", async () => {
  const snapshot = await loadCampaignSnapshot(new HouseReadDatabase(), "campaign_house-test");
  assert.ok(snapshot);
  assert.equal(snapshot.houseTasks?.length, 1);
  assert.equal(snapshot.houseTasks?.[0].id, "task_house-1");
  assert.equal(snapshot.houseTasks?.[0].parentStreetTaskId, "task_street-1");
  assert.equal(validateCampaignSnapshot(snapshot, "campaign_house-test").valid, true);
});

test("legacy snapshot replacement blocks House data before 0005 and persists it after 0005", async () => {
  const snapshot = baseSnapshot();
  snapshot.houseTasks = [houseTask()];

  const oldDb = new CapturingDatabase(false);
  const blocked = await replaceCampaignSnapshot(oldDb, snapshot, snapshot.revision - 1);
  assert.deepEqual(blocked, {
    ok: false,
    currentRevision: snapshot.revision - 1,
    reason: "schema_migration_required",
  });
  assert.equal(oldDb.lastBatch.length, 0);

  const newDb = new CapturingDatabase(true);
  const persisted = await replaceCampaignSnapshot(newDb, snapshot, snapshot.revision - 1);
  assert.deepEqual(persisted, { ok: true, revision: snapshot.revision });
  assert.equal(newDb.lastBatch.length, 9);
  assert.match(newDb.lastBatch.at(-1)!.query, /INSERT INTO house_tasks/u);
});

test("migration 0005 is additive and keeps House provenance parameterizable", () => {
  const sql = readFileSync(new URL("../migrations/0005_m6_house_tasks.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE house_tasks/u);
  assert.match(sql, /parent_street_task_id/u);
  assert.match(sql, /REFERENCES tasks\(id\) ON DELETE SET NULL/u);
  assert.match(sql, /source_json TEXT/u);
  assert.doesNotMatch(sql, /DROP TABLE tasks/u);
});
