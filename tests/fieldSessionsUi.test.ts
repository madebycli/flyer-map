import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("real Einsätze history stays in the production launcher graph", async () => {
  const shell = await readFile("src/platform/PlatformShell.tsx", "utf8");
  const hub = await readFile("src/collaboration/FieldSessionsHub.tsx", "utf8");
  const history = await readFile("src/collaboration/FieldSessionHistory.tsx", "utf8");
  const api = await readFile("src/data/fieldSessionApi.ts", "utf8");

  assert.match(shell, /import \{ FieldSessionsHub \} from "\.\.\/collaboration\/FieldSessionsHub\.tsx";/u);
  assert.match(shell, /<FieldSessionsHub/u);
  assert.match(hub, /fetchFieldSessions/u);
  assert.match(hub, /Mehr laden/u);
  assert.match(hub, /Migration 0007/u);
  assert.match(history, /participantCount \?\? "–"/u);
  assert.match(history, /personSeconds/u);
  assert.match(api, /\/field-sessions/u);

  const combined = `${hub}\n${history}\n${api}`;
  assert.doesNotMatch(combined, /affectedTaskCount|session_hash|secret_hash|qrToken|roomCode|cf-connecting-ip/iu);
});
