import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPackFor } from '../src/v5/app/api.ts';

const square = { id: 'area_x', geometry: { coordinates: [[[13, 51], [13.002, 51], [13.002, 51.002], [13, 51.002], [13, 51]] as [number, number][]] } };

test('two callers that want the same Gebiet built share one request, so the server never has to refuse the second one', async () => {
  const requests: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => { requests.push(String(url)); await gate; return new Response('{}', { status: 200 }); }) as typeof fetch;
  try {
    const first = buildPackFor('c1', square);
    const second = buildPackFor('c1', square); // e.g. the "Kartendaten laden" chip while the editor's own build runs
    release();
    await Promise.all([first, second]);
    assert.equal(requests.length, 1, 'one POST for both callers');
    // after it finished, a new build is a new request again
    release = () => {};
    await buildPackFor('c1', square);
    assert.equal(requests.length, 2);
    // another Gebiet or another Aktion is independent
    await Promise.all([buildPackFor('c1', { ...square, id: 'area_y' }), buildPackFor('c2', square)]);
    assert.equal(requests.length, 4);
  } finally { globalThis.fetch = realFetch; }
});
