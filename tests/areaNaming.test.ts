import assert from 'node:assert/strict';
import test from 'node:test';
import { nextNumberedName } from '../src/domain/areaNaming.ts';

test('numbered area names start at one', () => {
  assert.equal(nextNumberedName([], 'Gebiet'), 'Gebiet 1');
});

test('numbered area names advance from the highest existing suffix, not the array length', () => {
  assert.equal(nextNumberedName(['Gebiet 1', 'Gebiet 2', 'Gebiet 3', 'Gebiet 3'], 'Gebiet'), 'Gebiet 4');
  assert.equal(nextNumberedName(['Gebiet 1', 'Gebiet 3'], 'Gebiet'), 'Gebiet 4');
});

test('custom names and malformed suffixes do not create collisions', () => {
  assert.equal(nextNumberedName(['Nord', 'Gebiet X', 'Gebiet 8', 'gebiet 4'], 'Gebiet'), 'Gebiet 9');
});

test('numbered area names support the translated base label', () => {
  assert.equal(nextNumberedName(['Area 1', 'Area 4'], 'Area'), 'Area 5');
});
