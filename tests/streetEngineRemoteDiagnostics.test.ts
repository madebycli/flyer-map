import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampaignDiagnosticData, DiagnosticAreaSummary } from '../src/diagnostics/streetEngineSnapshot.ts';
import { loadStreetEngineAreaDiagnostics, selectStreetEngineDiagnosticAreas } from '../src/diagnostics/streetEngineRemote.ts';

function area(index: number, updatedAt: string | null): DiagnosticAreaSummary {
  return {
    id: `area_${index}`,
    name: `Area ${index}`,
    teamId: null,
    updatedAt,
    polygonVertices: 4,
    bbox: [13, 51, 13.01, 51.01],
    streetTasks: 0,
    preparedStreetTasks: 0,
    houseTasks: 0,
  };
}

function campaign(areas: DiagnosticAreaSummary[]): CampaignDiagnosticData {
  return {
    storageState: 'ok',
    campaignId: 'campaign_diag',
    revision: 1,
    totals: { areas: areas.length, streetTasks: 0, preparedStreetTasks: 0, houseTasks: 0 },
    duplicateAreaNames: [],
    areas,
  };
}

test('Street Engine diagnostic cap keeps the newest Area instead of arbitrary first-N entries', async () => {
  const areas = Array.from({ length: 25 }, (_, index) => area(index, `2026-09-17T${String(index % 20).padStart(2, '0')}:00:00.000Z`));
  areas[24] = area(24, '2026-09-17T23:59:59.000Z');
  const fetchedAreaIds: string[] = [];

  const diagnostics = await loadStreetEngineAreaDiagnostics(campaign(areas), async (input) => {
    const url = new URL(String(input), 'https://example.test');
    const parts = url.pathname.split('/');
    fetchedAreaIds.push(decodeURIComponent(parts[5]));
    return Response.json({ status: 'pending', diagnostics: { generation: 'g1' } });
  });

  assert.equal(diagnostics.length, 20);
  assert.equal(diagnostics[0].areaId, 'area_24');
  assert.equal(fetchedAreaIds.includes('area_24'), true);
  assert.equal(fetchedAreaIds.includes('area_0'), false);
  assert.deepEqual(diagnostics[0].selection, {
    totalAreas: 25,
    requestedAreas: 20,
    omittedAreas: 5,
    truncated: true,
    newestAreaId: 'area_24',
    newestAreaIncluded: true,
  });
});

test('Street Engine diagnostic selection prefers newly appended Area when timestamps are missing or tied', () => {
  const areas = Array.from({ length: 25 }, (_, index) => area(index, null));
  const selected = selectStreetEngineDiagnosticAreas(areas);
  assert.equal(selected.length, 20);
  assert.equal(selected[0].id, 'area_24');
  assert.equal(selected.some((entry) => entry.id === 'area_24'), true);
  assert.equal(selected.some((entry) => entry.id === 'area_0'), false);
});
