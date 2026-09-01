import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAreaPreparationGenerations,
  type Area,
  type CampaignSnapshot,
  type LineStringGeometry,
  type PolygonGeometry,
} from "../src/domain/campaign.ts";
import {
  clipLineStringToPolygon,
  pointInOrOnPolygon,
  polygonRepresentativePoint,
} from "../src/domain/areaTaskPreparation.ts";
import { applyCampaignMutation, CampaignMutationConflictError } from "../src/domain/mutations.ts";
import {
  areaGeometryHash,
  chunkAreaPreparationRows,
  prepareTasksForArea,
} from "../worker/areaTaskPreparation.ts";
import { fetchOsmFeaturesForArea } from "../worker/offlineMap.ts";
import { validateCampaignMutation } from "../worker/mutationValidation.ts";

const timestamp = "2026-08-31T12:00:00.000Z";

function polygon(points: [number, number][]): PolygonGeometry {
  return { type: "Polygon", coordinates: [[...points, points[0]]] };
}

function line(points: [number, number][]): LineStringGeometry {
  return { type: "LineString", coordinates: points };
}

const square = polygon([
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]);

const concave = polygon([
  [0, 0],
  [10, 0],
  [10, 10],
  [6, 10],
  [6, 4],
  [4, 4],
  [4, 10],
  [0, 10],
]);

const area: Area = {
  id: "area_auto",
  campaignId: "campaign_auto",
  teamId: "team_auto",
  name: "Auto Area",
  geometry: square,
  createdAt: timestamp,
  updatedAt: timestamp,
};

test("road clipping keeps inside, crossing and boundary fragments without zero lengths", () => {
  assert.deepEqual(clipLineStringToPolygon(line([[1, 1], [9, 1]]), square), [
    line([[1, 1], [9, 1]]),
  ]);
  assert.deepEqual(clipLineStringToPolygon(line([[-2, 5], [12, 5]]), square), [
    line([[0, 5], [10, 5]]),
  ]);
  assert.deepEqual(clipLineStringToPolygon(line([[-2, -2], [-1, -1]]), square), []);
  assert.deepEqual(clipLineStringToPolygon(line([[0, 0], [10, 0]]), square), [
    line([[0, 0], [10, 0]]),
  ]);
  assert.deepEqual(clipLineStringToPolygon(line([[1, 1], [1, 1]]), square), []);
});

test("road clipping handles concave multiple exits and re-entries", () => {
  const fragments = clipLineStringToPolygon(line([[-1, 7], [11, 7]]), concave);
  assert.deepEqual(fragments, [line([[0, 7], [4, 7]]), line([[6, 7], [10, 7]])]);

  const twoCrossings = clipLineStringToPolygon(
    line([[-1, 2], [5, 2], [5, 8], [11, 8]]),
    concave,
  );
  assert.equal(twoCrossings.length, 2);
  assert.deepEqual(twoCrossings[0], line([[0, 2], [5, 2], [5, 4]]));
  assert.deepEqual(twoCrossings[1], line([[6, 8], [10, 8]]));
});

test("representative building point is deterministic and supports boundary ownership", () => {
  const representative = polygonRepresentativePoint(concave);
  assert.ok(representative);
  assert.equal(pointInOrOnPolygon(representative as [number, number], concave), true);
  assert.equal(pointInOrOnPolygon([0, 5], square), true);
});

test("preparation converts clipped OSM ways and owned buildings into normal tasks", () => {
  let counter = 0;
  const prepared = prepareTasksForArea({
    campaignId: "campaign_auto",
    area,
    generation: "123e4567-e89b-42d3-a456-426614174000",
    timestamp,
    randomUUID: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    roads: [
      {
        properties: { osmId: 100, tags: { name: "Ringstraße", highway: "residential" } },
        geometry: line([[-1, 5], [11, 5]]),
      },
      {
        properties: { osmId: 101, tags: { ref: "L 12", highway: "primary" } },
        geometry: line([[2, 2], [8, 2]]),
      },
    ],
    buildings: [
      {
        id: "way/200",
        properties: {
          osmId: 200,
          tags: { building: "house", "addr:street": "Ringstraße", "addr:housenumber": "4" },
        },
        geometry: polygon([[2, 2], [3, 2], [3, 3]]),
      },
      {
        id: "way/201",
        properties: { osmId: 201, tags: { building: "house" } },
        geometry: polygon([[9.5, 9.5], [11, 9.5], [11, 11]]),
      },
      {
        id: "way/202",
        properties: { osmId: 202, tags: { building: "house" } },
        geometry: { type: "Polygon", coordinates: [[[1, 1], [1, 1], [1, 1], [1, 1]]] },
      },
    ],
  });

  assert.equal(prepared.tasks.length, 2);
  assert.deepEqual(prepared.tasks.map((task) => task.label), ["Ringstraße", "L 12"]);
  assert.ok(prepared.tasks.every((task) => task.id.startsWith("task_")));
  assert.ok(prepared.tasks.every((task) => task.status === "open"));
  assert.ok(prepared.tasks.every((task) => task.areaPreparationGeneration));
  assert.deepEqual(prepared.tasks[0].source, {
    dataset: "OpenStreetMap",
    objectType: "way",
    objectIds: [100],
  });
  assert.equal(prepared.houseTasks.length, 1);
  assert.equal(prepared.houseTasks[0].label, "Ringstraße 4");
  assert.equal(prepared.houseTasks[0].parentStreetTaskId, null);
  assert.equal(prepared.houseTasks[0].areaPreparationGeneration, "123e4567-e89b-42d3-a456-426614174000");
});

test("one OSM way split by a concave Area creates separate app-owned task fragments", () => {
  let counter = 0;
  const prepared = prepareTasksForArea({
    campaignId: "campaign_auto",
    area: { ...area, geometry: concave },
    generation: "123e4567-e89b-42d3-a456-426614174000",
    timestamp,
    randomUUID: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    roads: [{
      properties: { osmId: 777, tags: { highway: "residential" } },
      geometry: line([[-1, 7], [11, 7]]),
    }],
    buildings: [],
  });

  assert.deepEqual(prepared.tasks.map((task) => task.geometry), [
    line([[0, 7], [4, 7]]),
    line([[6, 7], [10, 7]]),
  ]);
  assert.notEqual(prepared.tasks[0].id, prepared.tasks[1].id);
  assert.deepEqual(prepared.tasks.map((task) => task.source), [
    { dataset: "OpenStreetMap", objectType: "way", objectIds: [777] },
    { dataset: "OpenStreetMap", objectType: "way", objectIds: [777] },
  ]);
});

test("feature caps and bounded json chunks fail before a partial publish", () => {
  assert.throws(() =>
    prepareTasksForArea({
      campaignId: "campaign_auto",
      area,
      generation: "123e4567-e89b-42d3-a456-426614174000",
      timestamp,
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
      maxRoadFragments: 1,
      roads: [
        { properties: { osmId: 1, tags: {} }, geometry: line([[1, 1], [2, 1]]) },
        { properties: { osmId: 2, tags: {} }, geometry: line([[3, 1], [4, 1]]) },
      ],
      buildings: [],
    }),
  );
  assert.deepEqual(chunkAreaPreparationRows([{ id: 1 }, { id: 2 }, { id: 3 }], 20), [
    [{ id: 1 }, { id: 2 }],
    [{ id: 3 }],
  ]);
});

test("canonical geometry hash is independent from object key order", async () => {
  const reordered = { coordinates: square.coordinates, type: "Polygon" as const };
  assert.equal(await areaGeometryHash(square), await areaGeometryHash(reordered));
});

test("server-side area fetch makes one bounded roads and buildings request", async () => {
  const requests: RequestInit[] = [];
  const boundedArea = polygon([
    [13.7, 51.0],
    [13.71, 51.0],
    [13.71, 51.01],
    [13.7, 51.01],
  ]);
  const result = await fetchOsmFeaturesForArea({
    geometry: boundedArea,
    upstreamUrl: "http://localhost/overpass",
    fetchImpl: async (_url, init) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({
        elements: [
          {
            type: "way",
            id: 10,
            tags: { highway: "residential", name: "Test" },
            geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }],
          },
          {
            type: "way",
            id: 11,
            tags: { building: "house" },
            geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 1 }],
          },
        ],
      }), { headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(requests.length, 1);
  const query = String(new URLSearchParams(String(requests[0].body)).get("data"));
  assert.match(query, /\["highway"\]/u);
  assert.match(query, /\["building"\]/u);
  assert.equal(result.roads.length, 1);
  assert.equal(result.buildings.length, 1);
});

function automaticSnapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 1,
    campaign: {
      id: "campaign_auto",
      name: "Auto",
      status: "active",
      defaultMapView: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    teams: [{ id: "team_auto", campaignId: "campaign_auto", name: "Team", color: "#2563eb", createdAt: timestamp, updatedAt: timestamp }],
    areas: [area],
    tasks: [{
      id: "task_auto",
      campaignId: "campaign_auto",
      areaId: "area_auto",
      taskType: "street",
      label: "Straße",
      geometry: line([[1, 1], [2, 1]]),
      source: { dataset: "OpenStreetMap", objectType: "way", objectIds: [1] },
      areaPreparationGeneration: "123e4567-e89b-42d3-a456-426614174000",
      status: "open",
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    houseTasks: [],
  };
}

test("legacy snapshots normalize missing automatic-generation fields to null", () => {
  const legacy = automaticSnapshot();
  const task = { ...legacy.tasks[0] };
  delete task.areaPreparationGeneration;
  const normalized = normalizeAreaPreparationGenerations({ ...legacy, tasks: [task] });
  assert.equal(normalized.tasks[0].areaPreparationGeneration, null);
});

test("automatic task deletion is rejected while status mutation remains possible", () => {
  const snapshot = automaticSnapshot();
  assert.throws(
    () => applyCampaignMutation(snapshot, {
      id: "mutation_delete-auto",
      campaignId: snapshot.campaign.id,
      baseRevision: 1,
      createdAt: timestamp,
      type: "task.delete",
      payload: { taskId: "task_auto", expectedUpdatedAt: timestamp },
    }),
    (error: unknown) => error instanceof CampaignMutationConflictError && error.reason === "auto_prepared_task_delete_forbidden",
  );
  const updated = applyCampaignMutation(snapshot, {
    id: "mutation_status-auto",
    campaignId: snapshot.campaign.id,
    baseRevision: 1,
    createdAt: "2026-08-31T12:01:00.000Z",
    type: "task.set-status",
    payload: {
      taskId: "task_auto",
      status: "later",
      completedAt: null,
      expectedUpdatedAt: timestamp,
    },
  });
  assert.equal(updated.tasks[0].status, "later");
});

test("client task create payload cannot invent a preparation generation", () => {
  assert.equal(validateCampaignMutation({
    id: "mutation_forged-generation",
    campaignId: "campaign_auto",
    baseRevision: 1,
    createdAt: timestamp,
    type: "task.create",
    payload: {
      taskId: "task_new",
      areaId: "area_auto",
      label: "Manual",
      geometry: line([[1, 1], [2, 1]]),
      areaPreparationGeneration: "123e4567-e89b-42d3-a456-426614174000",
    },
  }, "campaign_auto").valid, false);
});
