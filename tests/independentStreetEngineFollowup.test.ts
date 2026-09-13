import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import type { TaskStatus } from '../src/domain/campaign.ts';
import type { NetworkIntent } from '../src/domain/networkSelection.ts';
import { enqueueNetworkIntent, queuedNetworkIntents } from '../src/data/networkIntentQueue.ts';

const QUEUE_DATABASE = 'flyer-map-network-intents';

function intent(id: string, status: TaskStatus = 'completed'): NetworkIntent {
  return {
    id,
    areaId: 'area_followup',
    generation: 'generation_followup',
    start: { point: [13, 51], taskId: 'street_followup' },
    end: { point: [13.001, 51], taskId: 'street_followup' },
    selectedPath: ['street_followup'],
    expectedState: '0'.repeat(64),
    status,
  };
}

function installFakeIndexedDb(t: test.TestContext) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { value: fakeIndexedDB, configurable: true, writable: true });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });
}

async function writeLegacyIntent(scope: string, campaignId: string, entry: NetworkIntent, enqueuedAt: number) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(QUEUE_DATABASE, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('intents')) database.createObjectStore('intents', { keyPath: 'key' });
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'scope' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('intents', 'readwrite');
      tx.objectStore('intents').put({
        key: `${scope}:${entry.id}`,
        scope,
        campaignId,
        intent: entry,
        enqueuedAt,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

test('accepted renderer baseline is exactly MapLibre 6.9.0 with strict dependency auditing', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const stack = await readFile('docs/architecture/STACK.md', 'utf8');
  const ci = await readFile('.github/workflows/ci.yml', 'utf8');
  const map = await readFile('src/map/MapView.tsx', 'utf8');

  assert.equal(packageJson.dependencies['maplibre-gl'], '6.9.0');
  assert.equal(packageJson.scripts['audit:dependencies'], 'npm audit --audit-level=high');
  assert.equal(lock.packages[''].dependencies['maplibre-gl'], '6.9.0');
  assert.equal(lock.packages['node_modules/maplibre-gl'].version, '6.9.0');
  assert.equal(lock.packages[''].dependencies['@mapbox/unitbezier'], undefined);
  assert.match(stack, /MapLibre GL JS \*\*6\.9\.0 pinned\*\*/u);
  assert.doesNotMatch(stack, /5\.7\.1 pinned/u);
  assert.doesNotMatch(ci, /MapLibre 5\.7\.1 isolation exception/u);

  // Guard the actual 6.9 visibility fix: sources are seeded with current data,
  // app geometry is inserted above opaque provider geometry, and state changes
  // still drive setData for Areas, Streets and Houses.
  assert.match(map, /installApplicationMapStyle\(map: Map, initialData\?: InitialApplicationSourceData\)/u);
  assert.match(map, /const applicationStyle = buildApplicationMapStyle\(initialData\)/u);
  assert.match(map, /map\.addSource\(sourceId, source as SourceSpecification\)/u);
  assert.match(map, /const basemapLabelInsertionLayerId = \[\.\.\.map\.getStyle\(\)\.layers\]\.reverse\(\)\.find/u);
  assert.match(map, /areaSource\.setData\(areasToGeoJson\(areas\)\)/u);
  assert.match(map, /streetSource\.setData\(streetsToGeoJson\(tasks\)\)/u);
  assert.match(map, /houseSource\.setData\(housesToGeoJson\(houses\)\)/u);
});

test('offline intent FIFO survives wall-clock rollback across IndexedDB reopen cycles', async (t) => {
  installFakeIndexedDb(t);
  const originalNow = Date.now;
  const ticks = [2_000, 1_000];
  Date.now = () => ticks.shift() ?? 0;
  t.after(() => { Date.now = originalNow; });

  const scope = 'followup:clock-rollback';
  await enqueueNetworkIntent(scope, 'campaign_followup', intent('first'));
  await enqueueNetworkIntent(scope, 'campaign_followup', intent('second', 'later'));

  const queued = await queuedNetworkIntents(scope);
  assert.deepEqual(queued.map((item) => item.intent.id), ['first', 'second']);
  assert.ok((queued[0].sequence ?? 0) < (queued[1].sequence ?? 0));
  assert.ok(queued[0].enqueuedAt > queued[1].enqueuedAt, 'fixture must actually roll the wall clock backwards');
});

test('legacy version-1 queue rows drain before new sequenced rows', async (t) => {
  installFakeIndexedDb(t);
  const originalNow = Date.now;
  Date.now = () => 1;
  t.after(() => { Date.now = originalNow; });

  const scope = 'followup:legacy-before-sequence';
  await writeLegacyIntent(scope, 'campaign_followup', intent('legacy-first'), 9_999_999);
  await enqueueNetworkIntent(scope, 'campaign_followup', intent('new-second'));

  const queued = await queuedNetworkIntents(scope);
  assert.deepEqual(
    queued.map((item) => ({ id: item.intent.id, sequence: item.sequence ?? null })),
    [
      { id: 'legacy-first', sequence: null },
      { id: 'new-second', sequence: 1 },
    ],
  );
});
