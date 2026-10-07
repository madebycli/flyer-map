import assert from 'node:assert/strict';
import test from 'node:test';
import { colorAreaEntities, createAreaRenderIndex } from '../src/map/renderModel.ts';
import type { Area, Team } from '../src/domain/campaign.ts';
import { darkenHexColor } from '../src/domain/color.ts';

test('indexed map joins preserve fallback colors, geometry, ordering and source records', () => {
  const teams = [{ id: 't', color: '#2563eb' }, { id: 'empty', color: '' }] as Team[];
  const areas = [{ id: 'a', teamId: 't' }, { id: 'orphan', teamId: 'missing' }, { id: 'e', teamId: 'empty' }] as Area[];
  const geometry = { type: 'LineString', coordinates: [[13, 51], [13.1, 51.1]] };
  const entities = ['a', 'orphan', 'missing', 'e'].map((areaId, i) => Object.freeze({ id: `task_${i}`, areaId, geometry, status: 'open' }));
  const expected = entities.map((entity) => {
    const area = areas.find((candidate) => candidate.id === entity.areaId);
    const color = teams.find((team) => team.id === area?.teamId)?.color ?? '#64748b';
    return { ...entity, color, completedColor: darkenHexColor(color, 0.25) };
  });
  const actual = colorAreaEntities(entities, createAreaRenderIndex(areas, teams));
  assert.deepEqual(actual, expected);
  assert.equal(actual[0].geometry, geometry);
  assert.equal('color' in entities[0], false);
  const changed = colorAreaEntities(entities, createAreaRenderIndex(areas, [{ id: 't', color: '#ff0000' }] as Team[]));
  assert.equal(changed[0].color, '#ff0000', 'a changed Team color must invalidate the palette');
});

test('indexed joins keep the first-match behavior of legacy Array.find', () => {
  const teams = [{ id: 't', color: '#111111' }, { id: 't', color: '#ffffff' }] as Team[];
  const areas = [{ id: 'a', teamId: 't' }, { id: 'a', teamId: 'missing' }] as Area[];
  const index = createAreaRenderIndex(areas, teams);
  assert.equal(index.get('a')?.area, areas[0]);
  assert.equal(index.get('a')?.team, teams[0]);
});
