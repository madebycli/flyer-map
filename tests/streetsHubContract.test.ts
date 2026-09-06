import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/streets/StreetsHub.tsx", import.meta.url), "utf8");

test("Streets hub uses the primary launcher name for its dialog", () => {
  assert.match(source, /<FieldBottomSheet open title="Streets"/u);
  assert.doesNotMatch(source, /<FieldBottomSheet open title="Straßen"/u);
});
