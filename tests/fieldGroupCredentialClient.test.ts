import assert from "node:assert/strict";
import test from "node:test";
import { revealFieldGroupCredentials } from "../src/data/fieldGroupApi.ts";

test("current room credential reveal uses POST and same-origin auth", async () => {
  const originalFetch = globalThis.fetch;
  let capturedInput: RequestInfo | URL | null = null;
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = async (input, init) => {
    capturedInput = input;
    capturedInit = init;
    return Response.json({
      credentials: {
        roomCode: "ABCD-EFGH",
        qrToken: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12",
      },
    });
  };

  try {
    const credentials = await revealFieldGroupCredentials("campaign a", "group/1");
    assert.deepEqual(credentials, {
      roomCode: "ABCD-EFGH",
      qrToken: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12",
    });
    assert.equal(
      capturedInput,
      "/api/campaigns/campaign%20a/field-groups/group%2F1/credentials/current",
    );
    assert.equal(capturedInit?.method, "POST");
    assert.equal(capturedInit?.credentials, "same-origin");
    assert.equal(capturedInit?.cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
