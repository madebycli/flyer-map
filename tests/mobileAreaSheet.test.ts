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

test("Comment errors wrap and Area comments remain after primary actions", async () => {
  const commentsCss = await readFile("src/collaboration/comments-context-panel.css", "utf8");
  const app = await readFile("src/App.tsx", "utf8");
  assert.match(commentsCss, /\.comments-context-error\s*\{[\s\S]*?flex-wrap: wrap/u);
  assert.match(commentsCss, /\.comments-context-error span\s*\{[\s\S]*?overflow-wrap: anywhere/u);
  assert.ok(app.indexOf('t(language, "addSmartHouse")') < app.indexOf('targetType="area"'));
  assert.ok(app.indexOf('t(language, "addSmartStreet")') < app.indexOf('targetType="area"'));
});
