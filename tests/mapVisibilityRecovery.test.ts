import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fetchWithBasemapFailover } from "../src/map/basemapFailover.ts";

const BRIGHT_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";

function healthyBrightStyle() {
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      openmaptiles: {
        type: "vector",
        tiles: ["https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf"],
      },
    },
    layers: [
      { id: "background", type: "background" },
      { id: "place-label", type: "symbol", source: "openmaptiles", "source-layer": "place" },
    ],
  };
}

test("healthy OpenFreeMap Bright startup stays on the established fast path", async () => {
  let calls = 0;
  const expected = new Response(JSON.stringify(healthyBrightStyle()), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const fetchImpl = (async () => {
    calls += 1;
    return expected;
  }) as typeof fetch;

  const response = await fetchWithBasemapFailover(fetchImpl, BRIGHT_STYLE_URL, undefined, 25);

  assert.equal(response, expected);
  assert.equal(calls, 1);
});

test("basemap failover never touches unrelated requests", async () => {
  const expected = new Response("ok", { status: 200 });
  const fetchImpl = (async () => expected) as typeof fetch;

  const response = await fetchWithBasemapFailover(fetchImpl, "/api/rxdb/pull", undefined, 25);

  assert.equal(response, expected);
});

test("successful Bright response missing openmaptiles is normalized without replacing provider layers", async () => {
  const style = healthyBrightStyle();
  style.sources = {} as typeof style.sources;
  const fetchImpl = (async () => new Response(JSON.stringify(style), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;

  const response = await fetchWithBasemapFailover(fetchImpl, BRIGHT_STYLE_URL, undefined, 25);
  const normalized = await response.json() as {
    sources: Record<string, { type?: string; tiles?: string[] }>;
    layers: Array<{ id: string; type: string }>;
  };

  assert.equal(normalized.sources.openmaptiles?.type, "vector");
  assert.match(normalized.sources.openmaptiles?.tiles?.[0] ?? "", /planet\/latest/);
  assert.deepEqual(normalized.layers.map((layer) => layer.id), ["background", "place-label"]);
});

test("successful Bright response missing labels gains only an insertion anchor", async () => {
  const style = healthyBrightStyle();
  style.layers = [{ id: "background", type: "background" }];
  const fetchImpl = (async () => new Response(JSON.stringify(style), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;

  const response = await fetchWithBasemapFailover(fetchImpl, BRIGHT_STYLE_URL, undefined, 25);
  const normalized = await response.json() as {
    sources: Record<string, { type?: string }>;
    layers: Array<{ id: string; type: string }>;
  };

  assert.equal(normalized.sources.openmaptiles?.type, "vector");
  assert.deepEqual(normalized.layers.map((layer) => layer.id), [
    "background",
    "vf-emergency-label-anchor",
  ]);
  assert.equal(normalized.layers.at(-1)?.type, "symbol");
});

test("failed Bright style preserves the MapView source/layer insertion contract", async () => {
  const fetchImpl = (async () => new Response("upstream unavailable", { status: 503 })) as typeof fetch;

  const response = await fetchWithBasemapFailover(fetchImpl, BRIGHT_STYLE_URL, undefined, 25);
  const style = await response.json() as {
    version: number;
    glyphs?: string;
    sources: Record<string, { type?: string; tiles?: string[] }>;
    layers: Array<{ id: string; type: string }>;
  };

  assert.equal(response.status, 200);
  assert.equal(style.version, 8);
  assert.equal(style.sources.openmaptiles?.type, "vector");
  assert.match(
    style.sources.openmaptiles?.tiles?.[0] ?? "",
    /tiles\.openfreemap\.org\/planet\/latest\/\{z\}\/\{x\}\/\{y\}\.pbf/,
  );
  assert.match(style.glyphs ?? "", /tiles\.openfreemap\.org\/fonts/);
  assert.equal(style.sources["vf-emergency-osm"]?.type, "raster");
  assert.match(style.sources["vf-emergency-osm"]?.tiles?.[0] ?? "", /tile\.openstreetmap\.org/);
  assert.equal(style.layers[0]?.type, "raster");
  assert.equal(style.layers.at(-1)?.type, "symbol");
});

test("hung Bright style cannot keep every campaign layer permanently uninstalled", async () => {
  const fetchImpl = (() => new Promise<Response>(() => {})) as typeof fetch;

  const response = await fetchWithBasemapFailover(fetchImpl, BRIGHT_STYLE_URL, undefined, 1);
  const style = await response.json() as {
    sources: Record<string, { type?: string }>;
    layers: Array<{ type: string }>;
  };

  assert.equal(response.status, 200);
  assert.equal(style.sources.openmaptiles?.type, "vector");
  assert.equal(style.layers.at(-1)?.type, "symbol");
});

test("fallback contract matches MapView while Street Engine rendering stays untouched", async () => {
  const mainSource = await readFile("src/main.tsx", "utf8");
  const mapSource = await readFile("src/map/MapView.tsx", "utf8");

  assert.match(mainSource, /installBasemapFailover\(\);\s*installRxdbFetchGuard\(\);/);
  assert.match(
    mapSource,
    /export const OPENFREE_MAP_STYLE_URL = "https:\/\/tiles\.openfreemap\.org\/styles\/bright";/,
  );
  assert.match(mapSource, /export const BASEMAP_VECTOR_SOURCE_ID = "openmaptiles";/);
  assert.match(mapSource, /style:\s*OPENFREE_MAP_STYLE_URL/);
  assert.match(mapSource, /const AREA_SOURCE_ID = "vf-areas";/);
  assert.match(mapSource, /const STREET_SOURCE_ID = "vf-streets";/);
  assert.match(mapSource, /HOUSE_SOURCE_ID/);
  assert.match(mapSource, /roadSlice\(task\.geometry/);
});
