import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("clean browser startup preserves the absence of an explicit Campaign until bootstrap", async () => {
  const source = await readFile(new URL("../src/data/campaignStore.ts", import.meta.url), "utf8");
  const explicitIndex = source.indexOf("const explicitCampaignId = campaignIdFromUrl();");
  const normalizeIndex = source.indexOf("setCampaignIdInUrl(targetCampaignId);");
  const bootstrapIndex = source.indexOf("!loadedExistingSnapshot && !explicitCampaignId");
  const createIndex = source.indexOf("createCampaignSnapshot(local)");

  assert.ok(explicitIndex >= 0, "explicit Campaign URL state must be captured before URL normalization");
  assert.ok(normalizeIndex > explicitIndex, "URL normalization must happen after capturing explicit Campaign state");
  assert.ok(bootstrapIndex > normalizeIndex, "fresh bootstrap decision must use the captured pre-normalization state");
  assert.ok(createIndex > bootstrapIndex, "fresh clean browsers must still reach initial Campaign creation");
  assert.doesNotMatch(source, /!loadedExistingSnapshot && !campaignIdFromUrl\(\)/u);
});
