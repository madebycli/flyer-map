import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildResilientFieldMapStyle,
  fetchWithFieldMapStyleRecovery,
} from "../src/map/mapStyleRecovery.ts";

test("field map style keeps a raster basemap even if the provider style document is unusable", async () => {
  let upstreamCalls = 0;
  const upstream = (async () => {
    upstreamCalls += 1;
    throw new Error("provider style should not be fetched");
  }) as typeof fetch;

  const response = await fetchWithFieldMapStyleRecovery(
    upstream,
    "https://tiles.openfreemap.org/styles/bright",
  );
  const style = await response.json() as ReturnType<typeof buildResilientFieldMapStyle>;

  assert.equal(upstreamCalls, 0);
  assert.equal(response.status, 200);
  assert.equal(style.sources.osm.type, "raster");
  assert.equal(style.sources.openmaptiles.type, "vector");
  assert.equal(style.layers[0].id, "vf-osm-raster-basemap");
  assert.equal(style.layers[1].type, "symbol");
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
