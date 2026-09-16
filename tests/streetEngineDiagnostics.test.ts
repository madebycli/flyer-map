import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccessContext } from '../worker/access.ts';
import {
  beginAreaTaskPreparation,
  runAreaTaskPreparation,
} from '../worker/areaTaskPreparation.ts';
import { handleAreaTaskPreparationApi } from '../worker/areaTaskPreparationApi.ts';
import { NetworkD1, networkOsm, seedNetwork } from './helpers/networkD1.ts';

const access: AccessContext = {
  grantId: 'diag-admin',
  campaignId: 'campaign_n',
  role: 'admin',
  teamId: null,
  label: null,
};
const route = { campaignId: 'campaign_n', areaId: 'area_n' };
const preparationUrl = 'https://diag.test/api/campaigns/campaign_n/areas/area_n/preparation';

test('Street Engine diag is read-only and exposes only allowlisted durable timing data', async (t) => {
  const db = new NetworkD1(true);
  t.after(() => db.sqlite.close());
  seedNetwork(db);

  const options = {
    upstreamUrl: 'http://localhost/private-overpass?secret=must-not-leak',
    fetchImpl: async () => networkOsm(),
  };
  const started = await beginAreaTaskPreparation(db, 'campaign_n', 'area_n', options);
  assert.equal(started.outcome, 'run');
  if (started.outcome !== 'run') return;

  let schedules = 0;
  const normalPending = await handleAreaTaskPreparationApi(
    new Request(preparationUrl),
    db,
    route,
    access,
    undefined,
    { schedule: async () => { schedules += 1; } },
  );
  assert.equal(normalPending.status, 200);
  assert.equal(schedules, 1, 'normal pending GET retains the recovery wake-up');
  const normalPendingBody = await normalPending.json() as Record<string, unknown>;
  assert.equal('diagnostics' in normalPendingBody, false);

  const diagPending = await handleAreaTaskPreparationApi(
    new Request(`${preparationUrl}?diag=1`),
    db,
    route,
    access,
    undefined,
    { schedule: async () => { schedules += 1; } },
  );
  assert.equal(diagPending.status, 200);
  assert.equal(schedules, 1, 'diag polling must not schedule or mutate the runner');
  const diagPendingBody = await diagPending.json() as any;
  assert.equal(diagPendingBody.status, 'pending');
  assert.equal(diagPendingBody.diagnostics?.generation, started.run.generation);
  assert.equal(diagPendingBody.diagnostics?.phase, 'queued');

  let result: Awaited<ReturnType<typeof runAreaTaskPreparation>> = { outcome: 'pending' };
  for (let step = 0; step < 64 && result.outcome === 'pending'; step += 1) {
    result = await runAreaTaskPreparation(db, started.run, options);
  }
  assert.equal(result.outcome, 'ready');

  const normalReady = await handleAreaTaskPreparationApi(
    new Request(preparationUrl),
    db,
    route,
    access,
    undefined,
  );
  const normalReadyBody = await normalReady.json() as Record<string, unknown>;
  assert.equal(normalReadyBody.status, 'ready');
  assert.equal('diagnostics' in normalReadyBody, false, 'normal beta payload stays unchanged');

  const diagReady = await handleAreaTaskPreparationApi(
    new Request(`${preparationUrl}?diag=1`),
    db,
    route,
    access,
    undefined,
  );
  assert.equal(diagReady.status, 200);
  const body = await diagReady.json() as any;
  const diagnostic = body.diagnostics;
  assert.equal(body.status, 'ready');
  assert.equal(diagnostic.generation, started.run.generation);
  assert.equal(diagnostic.status, 'ready');
  assert.equal(diagnostic.phase, 'ready');
  assert.equal(diagnostic.metrics.tiles, 1);
  assert.equal(diagnostic.metrics.requests, 2);
  assert.equal(diagnostic.metrics.tileTimings.length, 2);
  assert.deepEqual(diagnostic.metrics.tileTimings.map((tile: { kind: string }) => tile.kind), ['roads', 'buildings']);
  assert.ok(diagnostic.metrics.fetchMs >= 0);
  assert.ok(diagnostic.metrics.parseMs >= 0);
  assert.ok(diagnostic.metrics.normalizationMs >= 0);
  assert.ok(diagnostic.metrics.graphMs >= 0);
  assert.ok(diagnostic.metrics.addressMs >= 0);
  assert.ok(diagnostic.metrics.linkMs >= 0);
  assert.ok(diagnostic.metrics.publishMs >= 0);
  assert.equal(diagnostic.metrics.lastSourceAttempts.length, 1);
  assert.equal(diagnostic.metrics.lastSourceAttempts[0].endpoint, 'configured-upstream');
  assert.equal(diagnostic.metrics.lastSourceAttempts[0].kind, 'buildings');
  assert.equal(diagnostic.metrics.lastSourceAttempts[0].status, 200);

  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(serialized, /private-overpass|secret=must-not-leak|geometry_json|\[out:json|cookie|authorization/i);
  assert.match(serialized, /configured-upstream/);
});
