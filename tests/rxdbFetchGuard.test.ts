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

test("RxDB Request cancellation propagates instead of being replaced by the deadline", async () => {
  const controller = new AbortController();
  const request = new Request('https://example.invalid/api/campaigns/c/rxdb/pull/areas', { signal: controller.signal });
  const reason = new Error('area_scope_changed');
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
  })) as typeof fetch;
  const result = fetchWithRxdbDeadline(fetchImpl, request, undefined, 500);
  controller.abort(reason);
  await assert.rejects(result, (error) => error === reason);
});

test("explicit init.signal overrides Request.signal, including an already aborted Request", async () => {
  const old = new AbortController();
  old.abort(new Error('old_request'));
  const request = new Request('https://example.invalid/api/campaigns/c/rxdb/pull/areas', { signal: old.signal });
  const current = new AbortController();
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.signal?.aborted, false);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  assert.equal((await fetchWithRxdbDeadline(fetchImpl, request, { signal: current.signal })).status, 204);
  assert.equal((await fetchWithRxdbDeadline(fetchImpl, request, { signal: null })).status, 204);
});

test("an already aborted Request keeps its cancellation reason", async () => {
  const controller = new AbortController();
  const reason = new Error('already_stopped');
  controller.abort(reason);
  const request = new Request('https://example.invalid/api/campaigns/c/rxdb/pull/areas', { signal: controller.signal });
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.signal?.aborted, true);
    throw init?.signal?.reason;
  }) as typeof fetch;
  await assert.rejects(fetchWithRxdbDeadline(fetchImpl, request), (error) => error === reason);
});
