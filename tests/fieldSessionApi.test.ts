import assert from "node:assert/strict";
import test from "node:test";
import {
  FIELD_SESSION_NOTE_MAX_LENGTH,
  updateFieldSessionNote,
} from "../src/data/fieldSessionApi.ts";

test("field session note client uses the narrow same-origin PATCH contract", async () => {
  const previousFetch = globalThis.fetch;
  let captured: { input: RequestInfo | URL; init?: RequestInit } | null = null;
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return Response.json({ note: "Treffpunkt", updatedAt: "2026-08-27T20:00:00.000Z" });
  };

  try {
    const result = await updateFieldSessionNote("campaign_a", "session_a", "Treffpunkt");
    assert.deepEqual(result, {
      note: "Treffpunkt",
      updatedAt: "2026-08-27T20:00:00.000Z",
    });
    assert.equal(captured?.input, "/api/campaigns/campaign_a/field-sessions/session_a/note");
    assert.equal(captured?.init?.method, "PATCH");
    assert.equal(captured?.init?.credentials, "same-origin");
    assert.equal(captured?.init?.body, JSON.stringify({ note: "Treffpunkt" }));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("field session note UI and server share the 1000 character product limit", () => {
  assert.equal(FIELD_SESSION_NOTE_MAX_LENGTH, 1_000);
});
