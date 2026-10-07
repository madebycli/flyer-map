import test from 'node:test';
import assert from 'node:assert/strict';
import { updateRendererFeatureDiagnostics } from '../src/map/rendererFeatureDiagnostics.ts';

const groups = [{ source: 'houses', layers: ['fill'], idProperty: 'houseTaskId', sourceCount: 'sourceHouses', renderedCount: 'renderedHouses' }];

test('ordinary map idle never requests source or rendered geometry for feature diagnostics', () => {
  const unexpected = () => { assert.fail('ordinary browse must not traverse renderer features'); };
  const map = { getSource: unexpected, getLayer: unexpected, querySourceFeatures: unexpected, queryRenderedFeatures: unexpected };
  const dataset = {};
  updateRendererFeatureDiagnostics(map as any, dataset, groups, false);
  assert.deepEqual(dataset, {});
});

test('opt-in renderer diagnostics still deduplicate tile copies and tolerate absent sources/layers', () => {
  let calls = 0;
  const features = [{ properties: { houseTaskId: 'h1' } }, { properties: { houseTaskId: 'h1' } }, { properties: { houseTaskId: 'h2' } }];
  const map = { getSource: () => true, getLayer: () => true,
    querySourceFeatures: () => { calls++; return features; },
    queryRenderedFeatures: () => { calls++; return features.slice(0, 2); } };
  const dataset: Record<string, string> = {};
  updateRendererFeatureDiagnostics(map as any, dataset, groups, true);
  assert.deepEqual(dataset, { sourceHouses: '2', renderedHouses: '1' });
  assert.equal(calls, 2);
  updateRendererFeatureDiagnostics({ ...map, getSource: () => undefined, getLayer: () => undefined } as any, dataset, groups, true);
  assert.deepEqual(dataset, { sourceHouses: '0', renderedHouses: '0' });
  assert.equal(calls, 2);
});
