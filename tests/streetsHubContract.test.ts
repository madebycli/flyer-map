import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/streets/StreetsHub.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../src/platform/PlatformShell.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("Streets hub uses the primary launcher name for its dialog", () => {
  assert.match(source, /<FieldHub open title="Streets"/u);
  assert.doesNotMatch(source, /<FieldHub open title="Straßen"/u);
});

test("manual Street creation stays visible and reuses the existing map draw flow", () => {
  assert.match(source, /Straße manuell hinzufügen/u);
  assert.match(source, /disabled=\{!canCreateManualStreet\}/u);
  assert.doesNotMatch(source, /context\?\.canCreateManualStreet \? <button/u);
  assert.match(shellSource, /onManualStreet=\{\(\) => dispatchSimpleCommand\("start-manual-street"\)\}/u);
  assert.match(appSource, /platformCommand\.type === "start-manual-street"[\s\S]*?startManualStreet\(\)/u);
  assert.match(appSource, /const startManualStreet = \(\) =>/u);
  assert.match(appSource, /setMode\("street-draw"\)/u);
});
