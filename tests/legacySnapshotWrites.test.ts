import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import baseWorker, { legacySnapshotWriteResponse } from "../worker/index.ts";

test("the retired Snapshot PUT contract is explicit and side-effect free", async () => {
  const response = legacySnapshotWriteResponse();

  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    error: {
      code: "legacy_snapshot_write_retired",
      message: "Campaign-Änderungen müssen über den Mutationspfad gespeichert werden.",
    },
  });
});

test("the retired Snapshot PUT route does not require access or D1", async () => {
  const response = await baseWorker.fetch(
    new Request("https://example.test/api/campaigns/campaign_test-1/snapshot", {
      method: "PUT",
      body: "not-json",
    }),
    {} as never,
  );

  assert.equal(response.status, 410);
  assert.match(await response.text(), /legacy_snapshot_write_retired/u);
});

test("campaign client and synchronization source contain no legacy Snapshot PUT path", async () => {
  const paths = [
    "src/data/campaignApi.ts",
    "src/data/campaignStore.ts",
    "worker/campaignRepository.ts",
    "worker/index.ts",
    "worker/indexM55.ts",
  ];
  const source = (
    await Promise.all(paths.map(async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")))
  ).join("\n");

  assert.doesNotMatch(source, /putCampaignSnapshot|recoverLegacyOptimisticSnapshot|replaceCampaignSnapshot/u);
  assert.doesNotMatch(source, /method:\s*["']PUT["']/u);
  assert.match(source, /legacy_snapshot_write_retired/u);
});
