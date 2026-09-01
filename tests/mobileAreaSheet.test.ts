import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mobile Area and task sheets scroll vertically without horizontal overflow", async () => {
  const mobile = await readFile("src/mobile-stability.css", "utf8");
  const shared = await readFile("src/styles.css", "utf8");
  assert.match(mobile, /\.compact-sheet\s*\{[\s\S]*?max-height: min\(82dvh, 46rem\)[\s\S]*?overflow-x: hidden[\s\S]*?overflow-y: auto/u);
  assert.match(mobile, /\.task-sheet\s*\{[\s\S]*?max-height: min\(82dvh, 46rem\)[\s\S]*?overflow-x: hidden[\s\S]*?overflow-y: auto/u);
  assert.match(mobile, /\.compact-sheet > \.button\.full-width[\s\S]*?white-space: normal[\s\S]*?overflow-wrap: anywhere/u);
  assert.match(shared, /\.bottom-sheet\s*\{[\s\S]*?overflow-x: hidden[\s\S]*?overflow-y: auto/u);
});

test("Area Sheet stays compact and keeps preparation, manual work, and comments in order", async () => {
  const commentsCss = await readFile("src/collaboration/comments-context-panel.css", "utf8");
  const app = await readFile("src/App.tsx", "utf8");
  assert.match(commentsCss, /\.comments-context-error\s*\{[\s\S]*?flex-wrap: wrap/u);
  assert.match(commentsCss, /\.comments-context-error span\s*\{[\s\S]*?overflow-wrap: anywhere/u);
  assert.match(app, /area-preparation-status/u);
  assert.match(app, /t\(language, "addManualStreet"\)/u);
  assert.ok(app.indexOf('t(language, "areaPreparationPending")') < app.indexOf('t(language, "addManualStreet")'));
  assert.ok(app.indexOf('t(language, "addManualStreet")') < app.indexOf('targetType="area"'));
  assert.doesNotMatch(app, /addSmartHouse|addSmartStreet|smartMapRequestRef/u);
});
