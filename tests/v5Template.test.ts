import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTemplate, parseTemplate, serializeTemplate, templateFileName, TEMPLATE_FORMAT } from '../src/v5/areas/template.ts';
import type { LngLat } from '../src/v5/engine/types.ts';

const ring: LngLat[] = [[13, 51], [13.01, 51], [13.01, 51.01], [13, 51.01], [13, 51]];

test('a template survives the round trip exactly and carries no data besides outline, name and rules', () => {
  const t = makeTemplate('  Nord 1  ', ring, { housesOnly: true });
  const back = parseTemplate(serializeTemplate(t));
  assert.ok(back.ok);
  assert.deepEqual(back.ok && back.template, t);
  assert.deepEqual(Object.keys(t).sort(), ['format', 'name', 'ring', 'rules', 'version']);
  assert.equal(t.name, 'Nord 1');
});

test('an open or already closed ring is normalised to one closed ring', () => {
  const open = makeTemplate('x', ring.slice(0, -1), { housesOnly: false });
  assert.deepEqual(open.ring, ring);
  assert.deepEqual(makeTemplate('x', ring, { housesOnly: false }).ring, ring);
});

test('untrusted files are refused with a plain reason, unknown fields are dropped', () => {
  const t = makeTemplate('ok', ring, { housesOnly: false });
  const bad = (patch: object | string) => parseTemplate(typeof patch === 'string' ? patch : JSON.stringify({ ...t, ...patch }));
  for (const text of ['', '{', 'null', '[]', '"x"', JSON.stringify({ ...t, format: 'other' }), JSON.stringify({ ...t, version: 2 })]) assert.equal(parseTemplate(text).ok, false, text);
  assert.equal(bad({ ring: [[0, 0], [1, 1]] }).ok, false, 'too few points');
  assert.equal(bad({ ring: [[13, 51], [13.01, 51], [999, 51.01], [13, 51.01], [13, 51]] }).ok, false, 'coordinates out of range');
  assert.equal(bad({ ring: [[13, 51], [13.01, 51], ['x', 51.01], [13, 51.01], [13, 51]] }).ok, false, 'non-numeric');
  assert.equal(bad({ ring: [[13, 51], [13.01, 51.01], [13.01, 51], [13, 51.01], [13, 51]] }).ok, false, 'a self-crossing bow tie');
  assert.equal(bad({ ring: Array.from({ length: 300 }, (_, i) => [13 + i * 1e-5, 51]) }).ok, false, 'too many vertices');
  assert.equal(parseTemplate('x'.repeat(70_000)).ok, false, 'oversized');
  const extra = parseTemplate(JSON.stringify({ ...t, evil: '<script>', rules: { housesOnly: 'yes', other: 1 }, name: 5 }));
  assert.ok(extra.ok && !('evil' in extra.template) && extra.template.rules.housesOnly === false && extra.template.name === 'Vorlage', 'rebuilt field by field');
  assert.equal(JSON.parse(serializeTemplate(t)).format, TEMPLATE_FORMAT);
});

test('file names are safe', () => {
  assert.equal(templateFileName('Gebiet Nord/1'), 'gebiet-nord-1.vorlage.json');
  assert.match(templateFileName('Größenwahn Ü'), /^[a-z0-9-]+\.vorlage\.json$/u);
  assert.equal(templateFileName('../../etc/passwd'), 'etc-passwd.vorlage.json');
  assert.equal(templateFileName('///'), 'gebiet.vorlage.json');
});
