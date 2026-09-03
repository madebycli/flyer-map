import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("prepared Street realtime notification stays inside the Worker lifetime", async () => {
  const source = await readFile("worker/areaTaskPreparation.ts", "utf8");

  assert.match(source, /await options\.onCommitted\?\.\(\)/u);
  assert.doesNotMatch(
    source,
    /void Promise\.resolve\(options\.onCommitted\?\.\(\)\)/u,
    "Realtime notification must not become a detached fire-and-forget promise after the D1 commit.",
  );
});

test("Street sync exposes payload-free client diagnostics for wakeup, pull, and manual refresh", async () => {
  const [syncSource, storeSource] = await Promise.all([
    readFile("src/data/rxdbMissionSync.ts", "utf8"),
    readFile("src/data/campaignStore.ts", "utf8"),
  ]);

  assert.match(syncSource, /event: "realtime-change"/u);
  assert.match(syncSource, /event: "pull-complete"/u);
  assert.match(syncSource, /collectionName === "streetTasks"/u);
  assert.match(storeSource, /event: "manual-refresh-start"/u);
  assert.match(storeSource, /event: "manual-refresh-complete"/u);
});
