import assert from 'node:assert/strict';
import test from 'node:test';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { setCoverage, type CoverageRange } from '../src/domain/streetNetwork.ts';
import type { TaskStatus } from '../src/domain/campaign.ts';
import type { NetworkIntent } from '../src/domain/networkSelection.ts';
import { enqueueNetworkIntent, flushNetworkIntents, queuedNetworkIntents } from '../src/data/networkIntentQueue.ts';

const TOTAL = 100;
const STATUSES: TaskStatus[] = ['open', 'completed', 'later', 'not-deliverable'];

function compressReference(cells: TaskStatus[]): CoverageRange[] {
  const result: CoverageRange[] = [];
  let start = 0;
  while (start < cells.length) {
    const status = cells[start];
    let end = start + 1;
    while (end < cells.length && cells[end] === status) end += 1;
    if (status !== 'open') result.push({ from: start, to: end, status });
    start = end;
  }
  return result;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

test('independent interval oracle preserves untouched work across randomized operations', () => {
  const seed = 0x5eed2026;
  const random = mulberry32(seed);
  const reference: TaskStatus[] = Array.from({ length: TOTAL }, () => 'open' as const);
  let actual: CoverageRange[] = [];

  for (let step = 0; step < 2_000; step += 1) {
    const a = Math.floor(random() * TOTAL);
    const b = Math.floor(random() * TOTAL);
    if (a === b) continue;
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const status = STATUSES[Math.floor(random() * STATUSES.length)];
    const reverse = random() < 0.5;

    for (let index = from; index < to; index += 1) reference[index] = status;
    actual = setCoverage(actual, reverse ? to : from, reverse ? from : to, status, TOTAL);

    assert.deepEqual(
      actual,
      compressReference(reference),
      `seed=${seed} step=${step} operation=${reverse ? `${to}->${from}` : `${from}->${to}`} status=${status}`,
    );
  }
});

test('offline intent queue preserves user order when two actions share one millisecond', async (t) => {
  const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const originalDateNow = Date.now;
  t.after(() => {
    Date.now = originalDateNow;
    if (indexedDbDescriptor) Object.defineProperty(globalThis, 'indexedDB', indexedDbDescriptor);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
    if (fetchDescriptor) Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
    else Reflect.deleteProperty(globalThis, 'fetch');
  });

  Object.defineProperty(globalThis, 'indexedDB', { value: fakeIndexedDB, configurable: true, writable: true });
  Date.now = () => 1_700_000_000_000;

  const scope = 'independent-audit:same-tick-order';
  const campaignId = 'campaign_audit';
  const intent = (id: string, status: TaskStatus): NetworkIntent => ({
    id,
    areaId: 'area_audit',
    generation: 'generation_audit',
    start: { point: [13, 51], taskId: 'street_audit' },
    end: { point: [13.001, 51], taskId: 'street_audit' },
    selectedPath: ['street_audit'],
    expectedState: '0'.repeat(64),
    status,
  });

  // The first action deliberately sorts after the second random-looking ID.
  // The second action represents a follow-up whose expected state depends on
  // the first action having reached the server first.
  await enqueueNetworkIntent(scope, campaignId, intent('z-first-action', 'completed'));
  await enqueueNetworkIntent(scope, campaignId, intent('a-second-action', 'later'));

  const calls: string[] = [];
  let firstApplied = false;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as NetworkIntent;
      calls.push(body.id);
      if (body.id === 'a-second-action' && !firstApplied) {
        return Response.json({ code: 'network_work_changed' }, { status: 409 });
      }
      if (body.id === 'z-first-action') firstApplied = true;
      return Response.json({ code: 'applied' }, { status: 200 });
    },
  });

  await flushNetworkIntents(scope, async () => {});
  const remaining = await queuedNetworkIntents(scope);

  assert.deepEqual(
    { calls, remaining: remaining.map((item) => ({ id: item.intent.id, blocked: item.blocked ?? null })) },
    { calls: ['z-first-action', 'a-second-action'], remaining: [] },
    'FIFO must follow user enqueue order even when Date.now() collides; a dependent later action may not block its predecessor',
  );
});
