import assert from "node:assert/strict";
import test from "node:test";
import { resilientAreaPreparationOptions } from "../worker/areaTaskPreparationApi.ts";

test("known public Area Overpass configuration keeps the resilient public fallback pool", () => {
  assert.deepEqual(
    resilientAreaPreparationOptions({
      upstreamUrl: "https://overpass-api.de/api/interpreter",
      timeoutMs: 12_000,
    }),
    { timeoutMs: 12_000 },
  );
  assert.deepEqual(
    resilientAreaPreparationOptions({
      upstreamUrl: "https://overpass.private.coffee/api/interpreter",
      maxAggregateBytes: 20_000_000,
    }),
    { maxAggregateBytes: 20_000_000 },
  );
});

test("custom Area Overpass configuration remains explicit and single-source", () => {
  const options = {
    upstreamUrl: "https://overpass.example.test/api/interpreter",
    timeoutMs: 9_000,
  };
  assert.equal(resilientAreaPreparationOptions(options), options);
});

test("invalid configured Area Overpass URL remains fail-closed for downstream validation", () => {
  const options = { upstreamUrl: "not-a-url" };
  assert.equal(resilientAreaPreparationOptions(options), options);
});
