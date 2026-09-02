import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const campaignId = "campaign_access-race";
const accessToken = "a".repeat(64);

test("fresh Access-Link startup waits for redemption before operator recovery", async () => {
  const [gateSource, storeSource, apiSource] = await Promise.all([
    readFile(new URL("../src/access/AccessRecoveryGate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/data/campaignStore.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/data/campaignApi.ts", import.meta.url), "utf8"),
  ]);

  const accessUrl = new URL(
    "https://flyer.test/?campaign=" + campaignId + "#access=" + accessToken,
  );
  const accessHash = new URLSearchParams(accessUrl.hash.slice(1));
  assert.equal(accessUrl.searchParams.get("campaign"), campaignId);
  assert.equal(accessHash.get("access"), accessToken);

  assert.match(gateSource, /subscribeCampaignStore/u);
  assert.match(gateSource, /fieldGroupQrTokenFromUrl/u);
  assert.match(gateSource, /fieldGroupToken/u);
  assert.doesNotMatch(gateSource, /fetchCurrentAccess/u);
  assert.match(gateSource, /nextState === "idle" \|\| nextState === "pending"/u);
  assert.match(gateSource, /accessState !== "required"/u);

  const pendingIndex = storeSource.indexOf('runtime.accessState = "pending"');
  const redeemIndex = storeSource.indexOf(
    "redeemCampaignAccess(targetCampaignId, token)",
  );
  const removeIndex = storeSource.indexOf("removeAccessTokenFromUrl()", redeemIndex);
  assert.ok(pendingIndex >= 0);
  assert.ok(redeemIndex > pendingIndex);
  assert.ok(removeIndex > redeemIndex);

  assert.match(apiSource, /function accessTokenFromUrl\(\)/u);
  assert.match(apiSource, /function removeAccessTokenFromUrl\(\)/u);
});
