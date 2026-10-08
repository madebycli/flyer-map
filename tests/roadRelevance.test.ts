import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeliveryRelevantRoad } from '../src/domain/roadRelevance.ts';

test('forest, field and bike infrastructure is never a delivery street', () => {
  for (const highway of ['track', 'bridleway', 'cycleway', 'motorway', 'construction']) {
    assert.equal(isDeliveryRelevantRoad({ highway, name: 'Waldweg' }), false, highway);
  }
});

test('unpaved or restricted paths and sidewalks are excluded, named paved paths stay', () => {
  assert.equal(isDeliveryRelevantRoad({ highway: 'path', name: 'Waldpfad', surface: 'ground' }), false);
  assert.equal(isDeliveryRelevantRoad({ highway: 'footway', footway: 'sidewalk' }), false);
  assert.equal(isDeliveryRelevantRoad({ highway: 'footway', footway: 'crossing' }), false);
  assert.equal(isDeliveryRelevantRoad({ highway: 'path', access: 'forestry' }), false);
  assert.equal(isDeliveryRelevantRoad({ highway: 'footway', name: 'Gartenweg', surface: 'asphalt' }), true);
  assert.equal(isDeliveryRelevantRoad({ highway: 'pedestrian' }), true);
});

test('ordinary streets and unnamed service accesses stay deliverable', () => {
  assert.equal(isDeliveryRelevantRoad({ highway: 'residential' }), true);
  assert.equal(isDeliveryRelevantRoad({ highway: 'service' }), true);
  assert.equal(isDeliveryRelevantRoad({ highway: 'service', surface: 'gravel' }), true);
  assert.equal(isDeliveryRelevantRoad({ highway: 'service', service: 'parking_aisle' }), false);
});
