import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STREET_ENGINE_V3_RUN_BUDGET,
  evaluateStreetEngineV3Budget,
  planStreetEngineV3ShardTransfer,
  type StreetEngineV3ResourceUsage,
} from '../src/domain/streetEngineV3Budget.ts';

const MIB = 1024 * 1024;
const baseUsage = (): StreetEngineV3ResourceUsage => ({
  workerRequests: 10,
  d1RowsRead: 1_000,
  d1RowsWritten: 20,
  durableObjectRequests: 10,
  durableObjectDurationGbSeconds: 5,
  r2ClassAOperations: 2,
  r2ClassBOriginReads: 20,
  browserDownloadBytes: 10 * MIB,
  browserUploadBytes: 1 * MIB,
});

test('Street Engine V3 budget accepts a run with large free-tier headroom', () => {
  assert.deepEqual(evaluateStreetEngineV3Budget(baseUsage()), { status: 'ok', findings: [] });
});

test('Street Engine V3 budget warns above preferred thresholds without crossing a hard stop', () => {
  const result = evaluateStreetEngineV3Budget({
    ...baseUsage(),
    d1RowsRead: 7_500,
    durableObjectDurationGbSeconds: 40,
    browserDownloadBytes: 25 * MIB,
    browserUploadBytes: 6 * MIB,
  });
  assert.equal(result.status, 'warn');
  assert.deepEqual(result.findings.map((finding) => [finding.resource, finding.kind]), [
    ['d1RowsRead', 'preferred'],
    ['durableObjectDurationGbSeconds', 'preferred'],
    ['browserDownloadBytes', 'preferred'],
    ['browserUploadBytes', 'preferred'],
  ]);
});

test('Street Engine V3 budget blocks before a subsystem engineering hard limit is exceeded', () => {
  const result = evaluateStreetEngineV3Budget({
    ...baseUsage(),
    workerRequests: STREET_ENGINE_V3_RUN_BUDGET.workerRequests.hard + 1,
    d1RowsRead: STREET_ENGINE_V3_RUN_BUDGET.d1RowsRead.hard + 1,
  });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.findings.map((finding) => [finding.resource, finding.kind]), [
    ['workerRequests', 'hard'],
    ['d1RowsRead', 'hard'],
  ]);
});

test('Street Engine V3 budget rejects invalid counters instead of silently coercing them', () => {
  assert.throws(
    () => evaluateStreetEngineV3Budget({ ...baseUsage(), d1RowsRead: Number.NaN }),
    /street_engine_v3_budget_invalid_d1RowsRead/,
  );
  assert.throws(
    () => evaluateStreetEngineV3Budget({ ...baseUsage(), workerRequests: -1 }),
    /street_engine_v3_budget_invalid_workerRequests/,
  );
});

test('Street Engine V3 transfer preflight de-duplicates immutable shard ids', () => {
  assert.deepEqual(planStreetEngineV3ShardTransfer([
    { id: 'a', compressedBytes: 4 * MIB },
    { id: 'b', compressedBytes: 5 * MIB },
    { id: 'a', compressedBytes: 4 * MIB },
  ]), { shardCount: 2, downloadBytes: 9 * MIB, status: 'ok' });
});

test('Street Engine V3 transfer preflight warns above 20 MiB and blocks above 40 MiB', () => {
  assert.equal(planStreetEngineV3ShardTransfer([
    { id: 'a', compressedBytes: 20 * MIB },
    { id: 'b', compressedBytes: 1 },
  ]).status, 'warn');
  assert.equal(planStreetEngineV3ShardTransfer([
    { id: 'a', compressedBytes: 40 * MIB },
    { id: 'b', compressedBytes: 1 },
  ]).status, 'blocked');
});

test('Street Engine V3 transfer preflight rejects inconsistent manifests', () => {
  assert.throws(
    () => planStreetEngineV3ShardTransfer([{ id: 'a', compressedBytes: -1 }]),
    /street_engine_v3_manifest_invalid_shard/,
  );
  assert.throws(
    () => planStreetEngineV3ShardTransfer([
      { id: 'a', compressedBytes: 1 },
      { id: 'a', compressedBytes: 2 },
    ]),
    /street_engine_v3_manifest_conflicting_shard/,
  );
});

test('50-run daily engineering envelope stays at or below the chosen 25 percent core limits', () => {
  const runs = 50;
  assert.ok(STREET_ENGINE_V3_RUN_BUDGET.workerRequests.hard * runs <= 25_000);
  assert.ok(STREET_ENGINE_V3_RUN_BUDGET.d1RowsRead.hard * runs <= 1_250_000);
  assert.ok(STREET_ENGINE_V3_RUN_BUDGET.d1RowsWritten.hard * runs <= 25_000);
  assert.ok(STREET_ENGINE_V3_RUN_BUDGET.durableObjectRequests.hard * runs <= 25_000);
  assert.ok(STREET_ENGINE_V3_RUN_BUDGET.durableObjectDurationGbSeconds.hard * runs <= 3_250);
});
