import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NetworkD1, seedNetwork } from "./helpers/networkD1.ts";
import type { AccessContext } from "../worker/access.ts";
import { handlePickupRoomAction, PICKUP_COMPLETION_CONFIRMATION } from "../worker/pickupRoomRuntime.ts";
import { handleCampaignMutation } from "../worker/mutationHandler.ts";
import { loadCampaignSnapshot } from "../worker/campaignRepository.ts";
import { RoadIndex, networkRoutes, roadLength } from "../src/domain/streetNetwork.ts";
import { createPickupRoadSectionFromSelection } from "../src/collection/pickupStreetEngineAdapter.ts";

const stamp = "2026-09-13T10:00:00.000Z";
const campaignId = "campaign_n";
const areaId = "collection_area_n";
const mainAreaId = "collection_main_n";

function database(actionType: "distribution" | "pickup" = "pickup") {
  const db = new NetworkD1(false, true);
  seedNetwork(db);
  db.sqlite.prepare("UPDATE campaigns SET action_type = ? WHERE id = ?").run(actionType, campaignId);
  db.sqlite.prepare(
    `INSERT INTO collection_main_areas (id, campaign_id, name, geometry_json, created_at, updated_at)
     VALUES (?, ?, 'Main', ?, ?, ?)`,
  ).run(mainAreaId, campaignId, JSON.stringify({ type: "Polygon", coordinates: [[[13, 51], [13.01, 51], [13.01, 51.01], [13, 51.01], [13, 51]]] }), stamp, stamp);
  db.sqlite.prepare(
    `INSERT INTO collection_areas
       (id, campaign_id, main_area_id, name, geometry_json, color, status,
        run_id, claimed_by_collector_id, claimed_by_label, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, 'Nord', ?, '#2563eb', 'open', NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(areaId, campaignId, mainAreaId, JSON.stringify({ type: "Polygon", coordinates: [[[13, 51], [13.01, 51], [13.01, 51.01], [13, 51.01], [13, 51]]] }), stamp, stamp);
  for (const [collectorId, label] of [["collector_n", "Nutzer 1"], ["collector_two", "Nutzer 2"]]) {
    const linkId = `link_${collectorId}`;
    db.sqlite.prepare(
      "INSERT INTO collection_access_links (id, campaign_id, token_hash, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL)",
    ).run(linkId, campaignId, `hash_${collectorId}`, stamp);
    db.sqlite.prepare(
      `INSERT INTO collection_collectors
         (id, campaign_id, access_link_id, label, revoked_at, can_create_pickups, can_edit_pickups, can_assign_pickups, created_at)
       VALUES (?, ?, ?, ?, NULL, 0, 1, 0, ?)`,
    ).run(collectorId, campaignId, linkId, label, stamp);
  }
  return db;
}

const collectorOne: AccessContext = {
  grantId: "collection:collector_n",
  campaignId,
  role: "collection-collector",
  teamId: null,
  label: "Nutzer 1",
  collectorId: "collector_n",
  collectionAccessId: "link_collector_n",
};
const collectorTwo: AccessContext = { ...collectorOne, grantId: "collection:collector_two", label: "Nutzer 2", collectorId: "collector_two", collectionAccessId: "link_collector_two" };
const admin: AccessContext = { grantId: "grant_admin", campaignId, role: "admin", teamId: null, label: "Admin" };

function roomRequest(action: string, body: Record<string, unknown>) {
  return new Request(`https://flyer.test/api/campaigns/${campaignId}/pickup-areas/${areaId}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://flyer.test", "idempotency-key": String(body.actionId) },
    body: JSON.stringify(body),
  });
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test("0024 defines action types, one active Room per Area, participant history and pickup sections", () => {
  const sql = readFileSync(new URL("../migrations/0024_pickup_area_rooms_progress.sql", import.meta.url), "utf8");
  assert.match(sql, /action_type TEXT NOT NULL DEFAULT 'distribution'/u);
  assert.match(sql, /collection_rooms_one_active_area_idx/u);
  assert.match(sql, /collection_room_participants/u);
  assert.match(sql, /collection_road_sections/u);
  assert.match(sql, /collection_room_events/u);
});

test("0025 adds independent Pickup section actor attribution and audit events", () => {
  const sql = readFileSync(new URL("../migrations/0025_pickup_section_actor_audit.sql", import.meta.url), "utf8");
  assert.match(sql, /created_by_kind TEXT NOT NULL/u);
  assert.match(sql, /updated_by_kind TEXT NOT NULL/u);
  assert.match(sql, /collection_road_section_events/u);
  assert.match(sql, /event_type TEXT NOT NULL CHECK/u);
});

test("Pickup Room claim is atomic, idempotent and exclusive across collectors", async () => {
  const db = database();
  const claim = { actionId: "pickup_action_claim_one", roomId: "collection_room_one", label: "Nutzer 1", participantId: "collection_participant_one" };
  const first = await handlePickupRoomAction(roomRequest("claim", claim), db, campaignId, areaId, "claim", collectorOne);
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal((await json(first)).alreadyApplied, false);
  const replay = await handlePickupRoomAction(roomRequest("claim", claim), db, campaignId, areaId, "claim", collectorOne);
  assert.equal(replay.status, 200);
  assert.equal((await json(replay)).alreadyApplied, true);
  const second = await handlePickupRoomAction(
    roomRequest("claim", { actionId: "pickup_action_claim_two", roomId: "collection_room_two", label: "Nutzer 2", participantId: "collection_participant_two" }),
    db,
    campaignId,
    areaId,
    "claim",
    collectorTwo,
  );
  assert.equal(second.status, 409);
  assert.equal(((await json(second)).error as { code: string }).code, "pickup_area_already_claimed");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM collection_rooms WHERE status = 'active'").get()?.n, 1);
  assert.equal(db.sqlite.prepare("SELECT status FROM collection_areas WHERE id = ?").get(areaId)?.status, "claimed");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM collection_room_events WHERE event_type = 'claim'").get()?.n, 1);
});

test("Room join is idempotent and release requires synchronized explicit confirmation", async () => {
  const db = database();
  const claim = { actionId: "pickup_action_join_claim", roomId: "collection_room_join", label: "Nutzer 1", participantId: "collection_participant_join_one" };
  assert.equal((await handlePickupRoomAction(roomRequest("claim", claim), db, campaignId, areaId, "claim", collectorOne)).status, 200);
  const join = { actionId: "pickup_action_join_two", roomId: claim.roomId, label: "Nutzer 2", participantId: "collection_participant_join_two" };
  assert.equal((await handlePickupRoomAction(roomRequest("join", join), db, campaignId, areaId, "join", collectorTwo)).status, 200);
  const revision = Number(db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision);
  const room = db.sqlite.prepare("SELECT updated_at FROM collection_rooms WHERE id = ?").get(claim.roomId) as { updated_at: string };
  const rejected = await handlePickupRoomAction(roomRequest("release", {
    actionId: "pickup_action_release_pending",
    roomId: claim.roomId,
    pendingSyncCount: 1,
    expectedRevision: revision,
    roomUpdatedAt: room.updated_at,
    completenessConfirmed: true,
    confirmationText: PICKUP_COMPLETION_CONFIRMATION,
  }), db, campaignId, areaId, "release", collectorTwo);
  assert.equal(rejected.status, 409);
  const release = await handlePickupRoomAction(roomRequest("release", {
    actionId: "pickup_action_release_ok",
    roomId: claim.roomId,
    pendingSyncCount: 0,
    expectedRevision: revision,
    roomUpdatedAt: room.updated_at,
    completenessConfirmed: true,
    confirmationText: PICKUP_COMPLETION_CONFIRMATION,
  }), db, campaignId, areaId, "release", collectorTwo);
  assert.equal(release.status, 200, await release.clone().text());
  assert.equal(db.sqlite.prepare("SELECT status FROM collection_rooms WHERE id = ?").get(claim.roomId)?.status, "released");
  assert.equal(db.sqlite.prepare("SELECT status FROM collection_areas WHERE id = ?").get(areaId)?.status, "open");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM collection_room_participants WHERE room_id = ?").get(claim.roomId)?.n, 2);
});

test("Admin force-release is audited and keeps room-owned progress rows", async () => {
  const db = database();
  const claim = { actionId: "pickup_action_force_claim", roomId: "collection_room_force", label: "Nutzer 1", participantId: "collection_participant_force" };
  assert.equal((await handlePickupRoomAction(roomRequest("claim", claim), db, campaignId, areaId, "claim", collectorOne)).status, 200);
  db.sqlite.prepare(
    `INSERT INTO collection_road_sections
       (id, campaign_id, area_id, label, geometry_json, status, coverage_json, source_task_id, source_generation, source_json, smart_marking_json, created_at, updated_at)
     VALUES ('collection_section_force', ?, ?, 'Abschnitt', '{"type":"LineString","coordinates":[[13,51],[13.001,51]]}', 'driven', '[]', NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(campaignId, areaId, stamp, stamp);
  const force = await handlePickupRoomAction(roomRequest("force-release", {
    actionId: "pickup_action_force_release",
    roomId: claim.roomId,
  }), db, campaignId, areaId, "force-release", admin);
  assert.equal(force.status, 200, await force.clone().text());
  assert.equal(db.sqlite.prepare("SELECT status FROM collection_rooms WHERE id = ?").get(claim.roomId)?.status, "force-released");
  assert.equal(db.sqlite.prepare("SELECT status FROM collection_areas WHERE id = ?").get(areaId)?.status, "open");
  assert.equal(db.sqlite.prepare("SELECT status FROM collection_road_sections WHERE id = 'collection_section_force'").get()?.status, "driven");
  assert.equal(db.sqlite.prepare("SELECT event_type FROM collection_room_events WHERE id = 'pickup_action_force_release'").get()?.event_type, "force-release");
});

test("Distribution campaigns reject Pickup Room and generic Pickup writes after action type migration", async () => {
  const db = database("distribution");
  const room = await handlePickupRoomAction(roomRequest("claim", {
    actionId: "pickup_action_distribution_claim",
    roomId: "collection_room_distribution",
    label: "Nutzer 1",
  }), db, campaignId, areaId, "claim", collectorOne);
  assert.equal(room.status, 409);
  assert.equal(((await json(room)).error as { code: string }).code, "pickup_action_required");
  assert.equal(db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision, 1);
});

test("loaded Pickup snapshot exposes Room, independent road sections and progress", async () => {
  const db = database();
  const snapshot = await loadCampaignSnapshot(db, campaignId);
  assert.ok(snapshot);
  assert.equal(snapshot!.campaign.actionType, "pickup");
  assert.deepEqual(snapshot!.collection?.rooms, []);
  assert.deepEqual(snapshot!.collection?.roadSections, []);
  assert.equal(snapshot!.collection?.progress?.[0]?.areaId, areaId);
});

test("Pickup section create and status writes use durable mutation validation", async () => {
  const db = database();
  const mutation = {
    id: "mutation_pickup_section_create",
    campaignId,
    type: "collection.pickup-section.create",
    baseRevision: 1,
    createdAt: "2026-09-13T10:01:00.000Z",
    payload: {
      sectionId: "collection_section_one",
      areaId,
      label: "Nordroute",
      geometry: { type: "LineString", coordinates: [[13, 51], [13.001, 51]] },
      sourceTaskId: null,
      sourceGeneration: null,
      source: null,
      smartMarking: null,
    },
  } as const;
  const request = new Request(`https://flyer.test/api/campaigns/${campaignId}/mutations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mutation }) });
  const created = await handleCampaignMutation(request, db, campaignId, admin);
  assert.equal(created.status, 200, await created.clone().text());
  assert.equal(db.sqlite.prepare("SELECT status FROM collection_road_sections WHERE id = ?").get("collection_section_one")?.status, "open");
  const createdActor = db.sqlite.prepare("SELECT created_by_kind, created_by_ref, updated_by_kind, updated_by_ref FROM collection_road_sections WHERE id = ?").get("collection_section_one") as Record<string, unknown>;
  assert.deepEqual({ ...createdActor }, {
    created_by_kind: "campaign-grant",
    created_by_ref: "grant_admin",
    updated_by_kind: "campaign-grant",
    updated_by_ref: "grant_admin",
  });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM collection_road_section_events WHERE section_id = ?").get("collection_section_one")?.n, 1);
  const changed = {
    ...mutation,
    id: "mutation_pickup_section_status",
    baseRevision: 2,
    createdAt: "2026-09-13T10:02:00.000Z",
    type: "collection.pickup-section.set-status",
    payload: { sectionId: "collection_section_one", areaId, status: "driven", expectedUpdatedAt: mutation.createdAt, roomId: null },
  } as const;
  const changedResponse = await handleCampaignMutation(new Request(`https://flyer.test/api/campaigns/${campaignId}/mutations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mutation: changed }) }), db, campaignId, admin);
  assert.equal(changedResponse.status, 200, await changedResponse.clone().text());
  assert.equal(db.sqlite.prepare("SELECT status FROM collection_road_sections WHERE id = ?").get("collection_section_one")?.status, "driven");
  assert.equal(db.sqlite.prepare("SELECT updated_by_ref FROM collection_road_sections WHERE id = ?").get("collection_section_one")?.updated_by_ref, "grant_admin");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM collection_road_section_events WHERE section_id = ?").get("collection_section_one")?.n, 2);
});

test("Collector section status requires active Room membership and records the collector actor", async () => {
  const db = database();
  const createMutation = {
    id: "mutation_pickup_collector_section_create",
    campaignId,
    type: "collection.pickup-section.create",
    baseRevision: 1,
    createdAt: "2026-09-13T10:01:00.000Z",
    payload: {
      sectionId: "collection_section_collector",
      areaId,
      label: "Collector route",
      geometry: { type: "LineString", coordinates: [[13, 51], [13.001, 51]] },
      sourceTaskId: null,
      sourceGeneration: null,
      source: null,
      smartMarking: null,
    },
  } as const;
  const createResponse = await handleCampaignMutation(new Request(`https://flyer.test/api/campaigns/${campaignId}/mutations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutation: createMutation }),
  }), db, campaignId, admin);
  assert.equal(createResponse.status, 200, await createResponse.clone().text());

  const claim = await handlePickupRoomAction(roomRequest("claim", {
    actionId: "pickup_action_collector_claim",
    roomId: "collection_room_collector",
    label: "Nutzer 1",
    participantId: "collection_participant_collector",
  }), db, campaignId, areaId, "claim", collectorOne);
  assert.equal(claim.status, 200, await claim.clone().text());
  const currentRevision = Number(db.sqlite.prepare("SELECT revision FROM campaigns WHERE id = ?").get(campaignId)?.revision);
  const section = db.sqlite.prepare("SELECT updated_at FROM collection_road_sections WHERE id = ?").get("collection_section_collector") as { updated_at: string };
  const statusMutation = {
    id: "mutation_pickup_collector_section_status",
    campaignId,
    type: "collection.pickup-section.set-status",
    baseRevision: currentRevision,
    createdAt: "2026-09-13T10:02:00.000Z",
    payload: {
      sectionId: "collection_section_collector",
      areaId,
      status: "driven",
      expectedUpdatedAt: section.updated_at,
      roomId: "collection_room_collector",
    },
  } as const;
  const statusResponse = await handleCampaignMutation(new Request(`https://flyer.test/api/campaigns/${campaignId}/mutations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutation: statusMutation }),
  }), db, campaignId, collectorOne);
  assert.equal(statusResponse.status, 200, await statusResponse.clone().text());
  assert.deepEqual({
    kind: db.sqlite.prepare("SELECT updated_by_kind FROM collection_road_sections WHERE id = ?").get("collection_section_collector")?.updated_by_kind,
    ref: db.sqlite.prepare("SELECT updated_by_ref FROM collection_road_sections WHERE id = ?").get("collection_section_collector")?.updated_by_ref,
  }, { kind: "collection-collector", ref: "collector_n" });
  assert.equal(db.sqlite.prepare("SELECT actor_kind FROM collection_road_section_events WHERE section_id = ? AND event_type = 'set-status'").get("collection_section_collector")?.actor_kind, "collection-collector");

  const outsider = await handleCampaignMutation(new Request(`https://flyer.test/api/campaigns/${campaignId}/mutations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutation: { ...statusMutation, id: "mutation_pickup_collector_outsider", baseRevision: currentRevision + 1 } }),
  }), db, campaignId, collectorTwo);
  assert.equal(outsider.status, 403);
  assert.equal(((await json(outsider)).error as { code: string }).code, "pickup_room_member_required");
});

test("Pickup Smart Marking is revalidated against the current StreetEngine state before D1 write", async () => {
  const db = database();
  const geometry = { type: "LineString", coordinates: [[13.001, 51.005], [13.009, 51.005]] } as const;
  const length = roadLength(geometry);
  db.sqlite.prepare(
    `INSERT INTO tasks
       (id, campaign_id, area_id, task_type, label, geometry_json, source_json,
        area_preparation_generation, status, completed_at, created_at, updated_at)
     VALUES ('task_pickup_server', ?, 'area_n', 'street', 'Nordstraße', ?, ?,
        '11111111-1111-4111-8111-111111111111', 'open', NULL, ?, ?)`,
  ).run(
    campaignId,
    JSON.stringify(geometry),
    JSON.stringify({ dataset: "OpenStreetMap", objectType: "way", objectIds: [9901] }),
    stamp,
    stamp,
  );
  db.sqlite.prepare("INSERT INTO street_network_state (task_id, network_json) VALUES (?, ?)").run(
    "task_pickup_server",
    JSON.stringify({ fromNode: "node_server_a", toNode: "node_server_b", length, coverage: [] }),
  );
  const before = (await loadCampaignSnapshot(db, campaignId))!;
  const task = before.tasks.find((candidate) => candidate.id === "task_pickup_server")!;
  const index = new RoadIndex([task]);
  const points = [13.002, 13.004, 13.007, 13.008].map((longitude) => index.candidates([longitude, 51.005])[0]);
  assert.ok(points.every(Boolean));
  const legs = points.slice(1).map((point, index) => ({
    routes: networkRoutes([task], points[index], point),
    selected: 0,
  }));
  const section = await createPickupRoadSectionFromSelection({
    campaignId,
    areaId,
    sectionId: "collection_section_server",
    label: "Server route",
    points,
    pickupAreaGeometry: before.collection!.areas[0].geometry,
    legs,
  }, [task]);
  const mutation = {
    id: "mutation_pickup_server_section",
    campaignId,
    type: "collection.pickup-section.create",
    baseRevision: before.revision,
    createdAt: "2026-09-13T10:03:00.000Z",
    payload: {
      sectionId: section.id,
      areaId: section.areaId,
      label: section.label,
      geometry: section.geometry,
      sourceTaskId: section.sourceTaskId,
      sourceGeneration: section.sourceGeneration,
      source: section.source,
      smartMarking: section.smartMarking,
    },
  } as const;
  const request = new Request(`https://flyer.test/api/campaigns/${campaignId}/mutations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutation }),
  });
  const created = await handleCampaignMutation(request, db, campaignId, admin);
  assert.equal(created.status, 200, await created.clone().text());

  db.sqlite.prepare("UPDATE street_network_state SET network_json = ? WHERE task_id = ?").run(
    JSON.stringify({ fromNode: "node_server_a", toNode: "node_server_b", length, coverage: [{ from: 0, to: length, status: "completed" }] }),
    "task_pickup_server",
  );
  const stale = {
    ...mutation,
    id: "mutation_pickup_server_stale",
    baseRevision: before.revision + 1,
    payload: { ...mutation.payload, sectionId: "collection_section_server_stale" },
  };
  const staleResponse = await handleCampaignMutation(new Request(`https://flyer.test/api/campaigns/${campaignId}/mutations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutation: stale }),
  }), db, campaignId, admin);
  assert.equal(staleResponse.status, 409);
  assert.equal(((await json(staleResponse)).error as { code: string }).code, "pickup_smart_marking_state_changed");
});
