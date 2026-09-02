import assert from "node:assert/strict";
import test from "node:test";
import type { PolygonGeometry } from "../src/domain/campaign.ts";
import {
  buildAreaPreparationOverpassQueries,
  fetchOsmFeaturesForArea,
  OsmFeaturesForAreaError,
} from "../worker/offlineMap.ts";

const largeArea: PolygonGeometry = {
  type: "Polygon",
  coordinates: [[
    [13.68, 50.98],
    [13.78, 50.98],
    [13.78, 51.08],
    [13.68, 51.08],
    [13.68, 50.98],
  ]],
};

function tiledSuccessResponse() {
  return new Response(JSON.stringify({
    osm3s: { timestamp_osm_base: "2026-09-02T00:30:00.000Z" },
    elements: [
      {
        type: "way",
        id: 501,
        tags: { highway: "residential", name: "Große Teststraße" },
        geometry: [
          { lat: 51.02, lon: 13.71 },
          { lat: 51.04, lon: 13.75 },
        ],
      },
      {
        type: "way",
        id: 502,
        tags: { building: "house", "addr:housenumber": "12" },
        geometry: [
          { lat: 51.029, lon: 13.729 },
          { lat: 51.029, lon: 13.73 },
          { lat: 51.03, lon: 13.73 },
          { lat: 51.029, lon: 13.729 },
        ],
      },
    ],
  }), { headers: { "content-type": "application/json" } });
}

test("large Area preparation is tiled instead of inheriting the 3 km offline-package limit", async () => {
  const queries = buildAreaPreparationOverpassQueries(largeArea);
  assert.ok(queries.length > 1);
  assert.ok(queries.length <= 16);
  assert.ok(queries.every((query) => query.includes('way["highway"](')));
  assert.ok(queries.every((query) => query.includes('way["building"](')));
  assert.ok(queries.every((query) => !query.includes("around:")));

  const calls: Array<{ url: string; query: string }> = [];
  const result = await fetchOsmFeaturesForArea({
    geometry: largeArea,
    upstreamUrl: "http://localhost/overpass",
    fetchImpl: (async (input, init) => {
      const params = new URLSearchParams(String(init?.body ?? ""));
      calls.push({ url: String(input), query: params.get("data") ?? "" });
      return tiledSuccessResponse();
    }) as typeof fetch,
    now: () => new Date("2026-09-02T00:31:00.000Z"),
  });

  assert.equal(calls.length, queries.length);
  assert.ok(calls.length > 1);
  assert.ok(calls.every((call) => call.url === "http://localhost/overpass"));
  assert.ok(result.request.radiusMeters > 3_000);
  assert.equal(result.roads.length, 1, "same OSM way returned by several tiles must be deduplicated");
  assert.equal(result.buildings.length, 1, "same building returned by several tiles must be deduplicated");
  assert.equal(result.roads[0]?.properties.osmId, 501);
  assert.equal(result.buildings[0]?.properties.osmId, 502);
  assert.equal(result.sourceTimestamp, "2026-09-02T00:30:00.000Z");
  assert.equal(result.metrics.tileCount, queries.length);
  assert.equal(result.metrics.requestCount, queries.length);
  assert.equal(result.metrics.maxConcurrentRequests, Math.min(3, queries.length));
  assert.equal(result.metrics.parsedElementCount, queries.length * 2);
  assert.equal(result.metrics.normalizedRoadCount, 1);
  assert.equal(result.metrics.normalizedBuildingCount, 1);
  assert.ok(result.metrics.upstreamBytes > 0);
  assert.ok(result.metrics.packageBytes > 0);
});

test("large Area preparation caps tile fetch concurrency at three", async () => {
  const queries = buildAreaPreparationOverpassQueries(largeArea);
  let active = 0;
  let maxActive = 0;
  let calls = 0;

  await fetchOsmFeaturesForArea({
    geometry: largeArea,
    upstreamUrl: "http://localhost/overpass",
    fetchImpl: (async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return tiledSuccessResponse();
    }) as typeof fetch,
  });

  assert.equal(calls, queries.length);
  assert.equal(maxActive, Math.min(3, queries.length));
});

test("large Area preparation enforces aggregate upstream bytes before starting later batches", async () => {
  const queries = buildAreaPreparationOverpassQueries(largeArea);
  let calls = 0;

  await assert.rejects(
    fetchOsmFeaturesForArea({
      geometry: largeArea,
      upstreamUrl: "http://localhost/overpass",
      limits: {
        maxUpstreamBytes: 1_000_000,
        maxAggregateBytes: 100,
      },
      fetchImpl: (async () => {
        calls += 1;
        return tiledSuccessResponse();
      }) as typeof fetch,
    }),
    (error: unknown) => error instanceof OsmFeaturesForAreaError && error.code === "too_large",
  );

  assert.equal(calls, Math.min(3, queries.length));
});

test("large Area preparation is all-or-nothing when one required tile fails", async () => {
  const queries = buildAreaPreparationOverpassQueries(largeArea);
  let calls = 0;

  await assert.rejects(
    fetchOsmFeaturesForArea({
      geometry: largeArea,
      upstreamUrl: "http://localhost/overpass",
      fetchImpl: (async () => {
        calls += 1;
        if (calls === 2) return new Response("busy", { status: 503 });
        return tiledSuccessResponse();
      }) as typeof fetch,
    }),
    (error: unknown) => error instanceof OsmFeaturesForAreaError && error.code === "failed",
  );

  assert.equal(calls, Math.min(3, queries.length));
});