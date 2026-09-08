import assert from "node:assert/strict";
import test from "node:test";
import { NetworkD1, seedNetwork } from "./helpers/networkD1.ts";
import { prepareAreaTasks } from "../worker/areaTaskPreparation.ts";
import { loadCampaignSnapshot } from "../worker/campaignRepository.ts";
import { stablePreparedStreetTaskId } from "../worker/streetNetwork/reconcile.ts";

test("prepared Street ids are deterministic across line direction", async () => {
  const forward = { type: "LineString" as const, coordinates: [[13.001, 51.001], [13.009, 51.009]] as [number, number][] };
  const reversed = { ...forward, coordinates: [...forward.coordinates].reverse() };
  const common = { campaignId: "campaign_n", areaId: "area_n", sourceOsmWayId: 42 };
  assert.equal(
    await stablePreparedStreetTaskId({ ...common, geometry: forward }),
    await stablePreparedStreetTaskId({ ...common, geometry: reversed }),
  );
  assert.notEqual(
    await stablePreparedStreetTaskId({ ...common, geometry: forward }),
    await stablePreparedStreetTaskId({ ...common, sourceOsmWayId: 43, geometry: forward }),
  );
});

test("10k-house Street pipeline stays bounded and emits runner diagnostics", async (t) => {
  const count = 10_000;
  const roadCount = 40;
  const db = new NetworkD1();
  seedNetwork(db);
  const roads = Array.from({ length: roadCount }, (_, i) => ({
    type: "way",
    id: 10 + i,
    tags: { highway: "residential", name: `Road ${i}` },
    geometry: [
      { lon: 13.0001 + i * 0.00024, lat: 51.0001 },
      { lon: 13.0001 + i * 0.00024, lat: 51.0099 },
    ],
  }));
  const buildings = Array.from({ length: count }, (_, i) => {
    const x = 13.00012 + (i % roadCount) * 0.00024;
    const y = 51.00012 + Math.floor(i / roadCount) * 0.000038;
    return {
      type: "way",
      id: 1000 + i,
      tags: { building: "house", "addr:street": `Road ${i % roadCount}`, "addr:housenumber": String(i + 1) },
      geometry: [
        { lon: x, lat: y },
        { lon: x + 0.000008, lat: y },
        { lon: x + 0.000008, lat: y + 0.000008 },
        { lon: x, lat: y },
      ],
    };
  });

  let requests = 0;
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const result = await prepareAreaTasks(db, "campaign_n", "area_n", {
    maxBuildings: count,
    fetchImpl: async (_url, init) => {
      requests += 1;
      const query = String(init?.body ?? "");
      const elements = query.includes("highway") ? roads : buildings;
      return new Response(JSON.stringify({ osm3s: { timestamp_osm_base: "2026-09-08T11:00:00Z" }, elements }));
    },
  });
  const totalMs = performance.now() - startedAt;
  const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;

  assert.equal(result.outcome, "ready", JSON.stringify(result));
  const snapshot = (await loadCampaignSnapshot(db, "campaign_n"))!;
  assert.equal(snapshot.tasks.length, roadCount);
  assert.equal(snapshot.houseTasks?.length, count);
  assert.equal(snapshot.houseTasks?.filter((house) => house.parentStreetTaskId).length, count);
  assert.equal(requests, 2);
  assert.ok(Math.max(...db.batchSizes) < 50);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM campaign_sync_changes WHERE collection_name = 'houseTasks'").get()?.count, count);
  assert.equal(db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);

  const metricsRow = db.sqlite.prepare("SELECT metrics_json FROM street_network_jobs").get() as { metrics_json?: string } | undefined;
  t.diagnostic(JSON.stringify({
    pipelineHouses: count,
    roads: roadCount,
    requests,
    totalMs,
    heapDeltaBytes,
    maxBatchStatements: Math.max(...db.batchSizes),
    metrics: metricsRow?.metrics_json ? JSON.parse(metricsRow.metrics_json) : null,
  }));
});
