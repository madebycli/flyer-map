import assert from 'node:assert/strict';
import test from 'node:test';
import { readCampaignDiagnosticData, safeDiagnosticValue } from '../src/diagnostics/streetEngineSnapshot.ts';
import { loadStreetEngineAreaDiagnostics } from '../src/diagnostics/streetEngineRemote.ts';

const polygon = {
  type: 'Polygon',
  coordinates: [[[7, 50], [8, 50], [8, 51], [7, 50]]],
};

function campaignData() {
  return readCampaignDiagnosticData(JSON.stringify({
    revision: 12,
    campaign: { id: 'campaign-1' },
    areas: [
      { id: 'area-1', name: 'Gebiet 3', teamId: 'team-1', geometry: polygon, updatedAt: '2026-09-16T10:00:00Z' },
      { id: 'area-2', name: 'Gebiet 3', teamId: 'team-1', geometry: polygon, updatedAt: '2026-09-16T11:00:00Z' },
    ],
    tasks: [
      { id: 'street-1', areaId: 'area-1', network: true, areaPreparationGeneration: 'generation-1' },
      { id: 'street-2', areaId: 'area-2' },
    ],
    houseTasks: [{ id: 'house-1', areaId: 'area-1' }],
  }));
}

test('street engine diagnostics expose ids, names, task counts and duplicate area names', () => {
  const data = campaignData();
  assert.equal(data.storageState, 'ok');
  assert.equal(data.campaignId, 'campaign-1');
  assert.equal(data.revision, 12);
  assert.deepEqual(data.totals, { areas: 2, streetTasks: 2, preparedStreetTasks: 1, houseTasks: 1 });
  assert.deepEqual(data.duplicateAreaNames, [{ name: 'Gebiet 3', areaIds: ['area-1', 'area-2'] }]);
  assert.equal(data.areas[0].polygonVertices, 3);
  assert.deepEqual(data.areas[0].bbox, [7, 50, 8, 51]);
  assert.equal(data.areas[0].houseTasks, 1);
});

test('street engine diagnostics fail closed on invalid local snapshot data', () => {
  assert.equal(readCampaignDiagnosticData(null).storageState, 'missing');
  assert.equal(readCampaignDiagnosticData('{broken').storageState, 'invalid');
});

test('diagnostic values redact token-like strings and sensitive keys', () => {
  const value = safeDiagnosticValue({
    status: 'pending',
    authorization: 'Bearer should-not-leak',
    detail: 'abcdefghijklmnopqrstuvwxyz0123456789_SECRET',
  });
  assert.deepEqual(value, { status: 'pending', detail: '[redacted]' });
});

test('v3 client diagnostics request the existing read-only ?diag=1 preparation payload', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const diagnostics = await loadStreetEngineAreaDiagnostics(campaignData(), async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({
      status: 'ready',
      diagnostics: {
        phase: 'ready',
        generation: 'generation-1',
        metrics: { requests: 40, fetchMs: 213991, graphMs: 4036 },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, '/api/campaigns/campaign-1/areas/area-1/preparation?diag=1');
  assert.equal(requests[0].init?.method, 'GET');
  assert.equal(requests[0].init?.cache, 'no-store');
  assert.equal(diagnostics[0].ok, true);
  assert.deepEqual(diagnostics[0].payload, {
    status: 'ready',
    diagnostics: {
      phase: 'ready',
      generation: 'generation-1',
      metrics: { requests: 40, fetchMs: 213991, graphMs: 4036 },
    },
  });
});
