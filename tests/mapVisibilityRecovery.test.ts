import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildResilientFieldMapStyle,
  fetchWithFieldMapStyleRecovery,
} from "../src/map/mapStyleRecovery.ts";

const BRIGHT_URL = "https://tiles.openfreemap.org/styles/bright";

function healthyBrightStyle() {
  return {
    version: 8,
    sources: { openmaptiles: { type: "vector", url: "https://example.test/tiles.json" } },
    layers: [
      { id: "background", type: "background" },
      { id: "road-label", type: "symbol", source: "openmaptiles", "source-layer": "transportation_name" },
    ],
  };
}

test("field map style guard preserves a healthy provider style and all of its layers", async () => {
  let upstreamCalls = 0;
  const providerStyle = healthyBrightStyle();
  const upstream = (async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify(providerStyle), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const response = await fetchWithFieldMapStyleRecovery(upstream, BRIGHT_URL);
  const style = await response.json() as typeof providerStyle;

  assert.equal(upstreamCalls, 1);
  assert.deepEqual(style.layers, providerStyle.layers);
  assert.equal(style.sources.openmaptiles.type, "vector");
});

test("field map style falls back only when the provider style document is unusable", async () => {
  let upstreamCalls = 0;
  const upstream = (async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify({ version: 8, sources: {}, layers: [] }), { status: 200 });
  }) as typeof fetch;

  const response = await fetchWithFieldMapStyleRecovery(upstream, BRIGHT_URL);
  const style = await response.json() as ReturnType<typeof buildResilientFieldMapStyle>;

  assert.equal(upstreamCalls, 1);
  assert.equal(response.status, 200);
  assert.equal(style.sources.osm.type, "raster");
  assert.equal(style.sources.openmaptiles.type, "vector");
  assert.equal(style.layers[0].id, "vf-osm-raster-basemap");
  assert.equal(style.layers[1].type, "symbol");
});

test("field map style falls back after a provider transport failure", async () => {
  const upstream = (async () => {
    throw new Error("provider unavailable");
  }) as typeof fetch;

  const response = await fetchWithFieldMapStyleRecovery(upstream, BRIGHT_URL);
  const style = await response.json() as ReturnType<typeof buildResilientFieldMapStyle>;
  assert.equal(style.layers[0].id, "vf-osm-raster-basemap");
});

test("field map style guard delegates unrelated fetches unchanged", async () => {
  const upstream = (async () => new Response("ok", { status: 204 })) as typeof fetch;
  const response = await fetchWithFieldMapStyleRecovery(upstream, "/api/runtime");
  assert.equal(response.status, 204);
});

test("field map recovery installs before the app mounts MapLibre", async () => {
  const source = await readFile("src/main.tsx", "utf8");
  const recovery = source.indexOf("installFieldMapStyleRecovery();");
  const root = source.indexOf("createRoot(");
  assert.ok(recovery >= 0);
  assert.ok(root > recovery);
});
