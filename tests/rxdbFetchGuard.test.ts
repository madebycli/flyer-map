import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithRxdbDeadline } from "../src/data/rxdbFetchGuard.ts";

test("RxDB requests are aborted when the server never settles", async () => {
  let aborted = false;
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      aborted = true;
      reject(new Error("aborted"));
    }, { once: true });
  })) as typeof fetch;

  await assert.rejects(
    fetchWithRxdbDeadline(fetchImpl, "/api/campaigns/campaign_one/rxdb/pull/areas", undefined, 10),
    /aborted/u,
  );
  assert.equal(aborted, true);
});

test("non-RxDB requests keep their original fetch path", async () => {
  let called = 0;
  const fetchImpl = (async () => {
    called += 1;
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const response = await fetchWithRxdbDeadline(fetchImpl, "/api/health", undefined, 10);
  assert.equal(response.status, 204);
  assert.equal(called, 1);
});
