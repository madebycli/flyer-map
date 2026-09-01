import assert from "node:assert/strict";
import test from "node:test";
import type { PolygonGeometry } from "../src/domain/campaign.ts";
import {
  buildAreaPreparationOverpassQuery,
  fetchOsmFeaturesForArea,
} from "../worker/offlineMap.ts";

const area: PolygonGeometry = {
  type: "Polygon",
  coordinates: [[
    [13.7, 51.0],
    [13.71, 51.0],
    [13.71, 51.01],
    [13.7, 51.01],
    [13.7, 51.0],
  ]],
};

function successResponse() {
  return new Response(JSON.stringify({
    osm3s: { timestamp_osm_base: "2026-09-01T20:00:00.000Z" },
    elements: [
      {
        type: "way",
        id: 10,
        tags: { highway: "residential", name: "Teststraße" },
        geometry: [
          { lat: 51.004, lon: 13.699 },
          { lat: 51.004, lon: 13.711 },
        ],
      },
      {
        type: "way",
        id: 11,
        tags: { building: "house" },
        geometry: [
          { lat: 51.003, lon: 13.703 },
          { lat: 51.003, lon: 13.704 },
          { lat: 51.004, lon: 13.704 },
          { lat: 51.003, lon: 13.703 },
        ],
      },
    ],
  }), { headers: { "content-type": "application/json" } });
}

test("Area preparation query uses a narrow buffered BBox instead of the offline around-radius query", () => {
  const query = buildAreaPreparationOverpassQuery(area);
  assert.ok(query);
  assert.match(query, /way\["highway"\]\([-0-9.,]+\);/u);
  assert.match(query, /way\["building"\]\([-0-9.,]+\);/u);
  assert.doesNotMatch(query, /around:/u);
});

test("custom Area Overpass upstream remains single-attempt and receives the BBox query", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await fetchOsmFeaturesForArea({
    geometry: area,
    upstreamUrl: "http://localhost/overpass",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return successResponse();
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost/overpass");
  const query = String(new URLSearchParams(String(calls[0].init?.body)).get("data"));
  assert.doesNotMatch(query, /around:/u);
  assert.equal(result.roads.length, 1);
  assert.equal(result.buildings.length, 1);
});

test("default Area preparation fails over once after a transient primary Overpass error", async () => {
  const urls: string[] = [];
  const result = await fetchOsmFeaturesForArea({
    geometry: area,
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (urls.length === 1) return new Response("busy", { status: 503 });
      return successResponse();
    },
  });

  assert.deepEqual(urls, [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ]);
  assert.equal(result.roads.length, 1);
  assert.equal(result.buildings.length, 1);
});

test("non-retryable Area package-size failures do not hammer fallback instances", async () => {
  const urls: string[] = [];
  await assert.rejects(
    fetchOsmFeaturesForArea({
      geometry: area,
      limits: { maxUpstreamBytes: 10 },
      fetchImpl: async (url) => {
        urls.push(String(url));
        return successResponse();
      },
    }),
    (error: unknown) => error instanceof Error && error.name === "OsmFeaturesForAreaError",
  );
  assert.deepEqual(urls, ["https://overpass-api.de/api/interpreter"]);
});
