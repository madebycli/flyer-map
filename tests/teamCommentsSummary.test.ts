import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Team comment summary does not mount the legacy area rename composer", async () => {
  const source = await readFile(new URL("../src/team/TeamCommentsSummary.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /autoFocus/u);
  assert.doesNotMatch(source, /editingAreaId|startRename|commitRename|Umbenennen/u);
  assert.match(source, /<strong>\{group\.areaName\}<\/strong>/u);
});
