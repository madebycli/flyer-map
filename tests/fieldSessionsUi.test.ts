import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("real Einsätze history stays in the production launcher graph", async () => {
  const shell = await readFile("src/platform/PlatformShell.tsx", "utf8");
  const hub = await readFile("src/collaboration/FieldSessionsHub.tsx", "utf8");
  const history = await readFile("src/collaboration/FieldSessionHistory.tsx", "utf8");
  const api = await readFile("src/data/fieldSessionApi.ts", "utf8");
  const map = await readFile("src/map/MapView.tsx", "utf8");
  const worker = await readFile("worker/fieldSessions.ts", "utf8");
  const noteWorker = await readFile("worker/fieldSessionNote.ts", "utf8");
  const taskWorker = await readFile("worker/fieldSessionTasks.ts", "utf8");
  const workerEntry = await readFile("worker/indexM55.ts", "utf8");

  assert.match(shell, /import \{ FieldSessionsHub \} from "\.\.\/collaboration\/FieldSessionsHub\.tsx";/u);
  assert.match(shell, /<FieldSessionsHub/u);
  assert.match(shell, /SessionMapHighlightProvider/u);
  assert.match(shell, /Einsatz hervorgehoben/u);
  assert.match(hub, /fetchFieldSessions/u);
  assert.match(hub, /fetchAllFieldSessionTaskRefs/u);
  assert.match(hub, /updateFieldSessionNote/u);
  assert.match(hub, /canEditSessionNote/u);
  assert.match(hub, /Mehr laden/u);
  assert.match(hub, /Migration 0007/u);
  assert.match(history, /participantCount \?\? "–"/u);
  assert.match(history, /personSeconds/u);
  assert.match(history, /affectedTaskCount/u);
  assert.match(history, />Aufgaben</u);
  assert.match(history, />Notiz</u);
  assert.match(history, /FIELD_SESSION_NOTE_MAX_LENGTH/u);
  assert.match(history, /Auf Karte zeigen/u);
  assert.match(api, /note: string \| null/u);
  assert.match(api, /updateFieldSessionNote/u);
  assert.match(api, /method: "PATCH"/u);
  assert.match(api, /fetchFieldSessionTaskRefs/u);
  assert.match(api, /fetchAllFieldSessionTaskRefs/u);
  assert.match(api, /\/field-sessions/u);
  assert.match(
    worker,
    /COUNT\(DISTINCT e\.entity_type \|\| '\|' \|\| e\.entity_id\)/u,
  );
  assert.match(worker, /e\.event_type = 'task\.status\.changed'/u);
  assert.match(worker, /s\.note/u);
  assert.match(worker, /note: row\.note/u);
  assert.match(worker, /affectedTaskCount: row\.affected_task_count/u);
  assert.match(noteWorker, /MAX_NOTE_LENGTH = 1_000/u);
  assert.match(noteWorker, /access\.role === "admin"/u);
  assert.match(noteWorker, /access\.role === "team-editor"/u);
  assert.match(noteWorker, /SET note = \?, updated_at = \?/u);
  assert.match(taskWorker, /SELECT DISTINCT entity_type, entity_id/u);
  assert.match(taskWorker, /event_type = 'task\.status\.changed'/u);
  assert.match(workerEntry, /handleFieldSessionNoteApi/u);
  assert.match(workerEntry, /handleFieldSessionTasksApi/u);
  assert.match(map, /vf-streets-session-highlight/u);
  assert.match(map, /useSessionMapHighlight/u);
  assert.match(map, /sessionHighlightStreets/u);

  const combined = `${shell}\n${hub}\n${history}\n${api}\n${map}\n${worker}\n${noteWorker}\n${taskWorker}`;
  assert.doesNotMatch(combined, /session_hash|secret_hash|qrToken|roomCode|cf-connecting-ip/iu);
});
