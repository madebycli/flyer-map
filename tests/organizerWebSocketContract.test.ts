import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const organizerSource = new URL("../worker/indexOrganizer.ts", import.meta.url);
const durableObjectSource = new URL("../worker/campaignSyncDurableObject.ts", import.meta.url);

test("organizer hardening forwards the Cloudflare websocket object instead of rebuilding a plain response", async () => {
  const source = await readFile(organizerSource, "utf8");
  assert.match(source, /const webSocket = \(response as WorkerWebSocketResponse\)\.webSocket/u);
  assert.match(source, /if \(webSocket\)/u);
  assert.match(source, /new Response\(null,/u);
  assert.match(source, /webSocket,/u);
});

test("campaign sync durable object still returns the accepted websocket on status 101", async () => {
  const source = await readFile(durableObjectSource, "utf8");
  assert.match(source, /status: 101/u);
  assert.match(source, /webSocket: pair\[0\]/u);
  assert.match(source, /acceptWebSocket\(pair\[1\]\)/u);
});
