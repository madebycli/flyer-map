import assert from "node:assert/strict";
import test from "node:test";
import { isOfflineMapPackage } from "../src/domain/offlineMap.ts";
import { offlineMapCampaignRoute } from "../worker/indexM55.ts";
import { handleOfflineMapPackage } from "../worker/offlineMap.ts";

function request(body: unknown) {
  return new Request("https://flyer-map.test/api/campaigns/campaign_1/offline-map/package", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("offline map route accepts only a valid campaign id", () => {
  assert.equal(
    offlineMapCampaignRoute("/api/campaigns/campaign_1/offline-map/package"),
    "campaign_1",
  );
  assert.equal(offlineMapCampaignRoute("/api/campaigns/%2F/offline-map/package"), null);
  assert.equal(offlineMapCampaignRoute("/api/campaigns/campaign_1/snapshot"), null);
});

test("offline map package rejects radius beyond the 3 km server limit", async () => {
  let fetchCalls = 0;
  const response = await handleOfflineMapPackage(
    request({ center: { lat: 51.05, lng: 13.74 }, radiusMeters: 3_001 }),
    {
      fetchImpl: async () => {
        fetchCalls += 1;
        return Response.json({ elements: [] });
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(fetchCalls, 0);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "invalid_radius");
});

test("client query text is ignored and only the server-owned Overpass template is sent", async () => {
  const hostileQuery = "[out:json];node(0,0,90,180);out; // <script>alert(1)</script>";
  let upstreamBody = "";

  const response = await handleOfflineMapPackage(
    request({
      center: { lat: 51.0504, lng: 13.7373 },
      radiusMeters: 3_000,
      query: hostileQuery,
    }),
    {
      upstreamUrl: "https://osm.example.test/api/interpreter",
      now: () => new Date("2026-08-25T21:30:00.000Z"),
      fetchImpl: async (_input, init) => {
        upstreamBody = String(init?.body ?? "");
        return Response.json({ elements: [] });
      },
    },
  );

  assert.equal(response.status, 200);
  const form = new URLSearchParams(upstreamBody);
  const query = form.get("data") ?? "";
  assert.equal(query.includes(hostileQuery), false);
  assert.match(query, /way\(around:3000,51\.050400,13\.737300\)\["highway"\]/);
  assert.match(query, /way\(around:3000,51\.050400,13\.737300\)\["building"\]/);
});

test("Overpass ways normalize into a versioned package with whitelisted inert tags", async () => {
  const response = await handleOfflineMapPackage(
    request({ center: { lat: 51.05, lng: 13.74 }, radiusMeters: 3_000 }),
    {
      now: () => new Date("2026-08-25T21:30:00.000Z"),
      fetchImpl: async () =>
        Response.json({
          osm3s: { timestamp_osm_base: "2026-08-25T21:29:00Z" },
          elements: [
            {
              type: "way",
              id: 123,
              tags: {
                highway: "residential",
                name: "Teststraße <script>alert(1)</script>",
                source: "must-not-be-copied",
              },
              geometry: [
                { lat: 51.05, lon: 13.74 },
                { lat: 51.051, lon: 13.741 },
              ],
            },
            {
              type: "way",
              id: 456,
              tags: {
                building: "yes",
                "addr:housenumber": "7",
                note: "ignored",
              },
              geometry: [
                { lat: 51.05, lon: 13.74 },
                { lat: 51.05, lon: 13.741 },
                { lat: 51.051, lon: 13.741 },
              ],
            },
          ],
        }),
    },
  );

  assert.equal(response.status, 200);
  const pkg = await response.json();
  assert.equal(isOfflineMapPackage(pkg), true);
  if (!isOfflineMapPackage(pkg)) throw new Error("package validation failed");

  assert.equal(pkg.schemaVersion, 1);
  assert.equal(pkg.attribution, "© OpenStreetMap contributors");
  assert.equal(pkg.roads.features.length, 1);
  assert.equal(pkg.buildings.features.length, 1);
  assert.equal(pkg.roads.features[0].properties.osmId, 123);
  assert.equal(pkg.roads.features[0].properties.tags.source, undefined);
  assert.equal(
    pkg.roads.features[0].properties.tags.name,
    "Teststraße <script>alert(1)</script>",
  );
  assert.equal(pkg.buildings.features[0].geometry.coordinates[0].length, 4);
  assert.equal(pkg.buildings.features[0].properties.tags.note, undefined);
});

test("declared oversized OSM responses are rejected before parsing", async () => {
  const response = await handleOfflineMapPackage(
    request({ center: { lat: 51.05, lng: 13.74 }, radiusMeters: 3_000 }),
    {
      maxUpstreamBytes: 100,
      fetchImpl: async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": "101", "content-type": "application/json" },
        }),
    },
  );

  assert.equal(response.status, 413);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "osm_response_too_large");
});

test("OSM upstream timeouts surface as a bounded retryable gateway error", async () => {
  const response = await handleOfflineMapPackage(
    request({ center: { lat: 51.05, lng: 13.74 }, radiusMeters: 3_000 }),
    {
      timeoutMs: 1,
      fetchImpl: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    },
  );

  assert.equal(response.status, 504);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, "osm_upstream_timeout");
});
