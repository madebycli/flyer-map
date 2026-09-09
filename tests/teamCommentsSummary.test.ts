import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Team comment Area rename advances the snapshot revision before RxDB save", async () => {
  const source = await readFile(new URL("../src/team/TeamCommentsSummary.tsx", import.meta.url), "utf8");
  assert.match(source, /revision: loaded\.revision \+ 1/u);
  assert.match(source, /campaign: \{ \.\.\.loaded\.campaign, updatedAt: now \}/u);
  assert.match(source, /if \(normalized === currentArea\.name\)/u);
});
