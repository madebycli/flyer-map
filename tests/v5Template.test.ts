import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTemplate, parseTemplate, planIsEmpty, planTemplate, serializeTemplate, templateFileName, TEMPLATE_FORMAT, type ActionTemplate } from '../src/v5/areas/template.ts';
import type { LngLat } from '../src/v5/engine/types.ts';

const box = (x: number, y = 51, size = 0.01): LngLat[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
const template = (): ActionTemplate => makeTemplate('  Frühjahr 2027  ', [{ name: 'Nord', color: '#2563eb' }, { name: 'Süd', color: '#15803d' }], [
  { name: 'Gebiet 1', team: 'Nord', ring: box(13) }, { name: 'Gebiet 2', team: 'Süd', ring: box(13.02) },
], { housesOnly: true });

test('a template is the whole map: teams, areas and rules, and survives the round trip exactly', () => {
  const t = template();
  const back = parseTemplate(serializeTemplate(t));
  assert.ok(back.ok);
  assert.deepEqual(back.ok && back.template, t);
  assert.deepEqual(Object.keys(t).sort(), ['areas', 'format', 'name', 'rules', 'teams', 'version']);
  assert.equal(t.name, 'Frühjahr 2027');
  assert.deepEqual(makeTemplate('x', [{ name: 'A', color: '#000000' }], [{ name: 'g', team: 'A', ring: box(13).slice(0, -1) }], { housesOnly: false }).areas[0].ring, box(13), 'open rings are closed');
});

test('untrusted files are refused with a plain reason and rebuilt field by field', () => {
  const t = template();
  const patch = (p: object) => parseTemplate(JSON.stringify({ ...t, ...p }));
  for (const text of ['', '{', 'null', '[]', '"x"', JSON.stringify({ ...t, format: 'other' }), JSON.stringify({ ...t, version: 2 }), 'x'.repeat(600_000)]) assert.equal(parseTemplate(text).ok, false, text.slice(0, 20));
  assert.equal(patch({ teams: [] }).ok, false, 'needs a team');
  assert.equal(patch({ areas: [] }).ok, false, 'needs an area');
  assert.equal(patch({ teams: [{ name: 'Nord', color: 'red' }, { name: 'Süd', color: '#15803d' }] }).ok, false, 'colour must be #rrggbb');
  assert.equal(patch({ teams: [{ name: 'Nord', color: '#2563eb' }, { name: 'nord ', color: '#15803d' }] }).ok, false, 'duplicate team (folded)');
  assert.equal(patch({ areas: [{ name: 'A', team: 'Nord', ring: box(13) }, { name: ' a', team: 'Nord', ring: box(13.02) }] }).ok, false, 'duplicate area (folded)');
  assert.equal(patch({ areas: [{ name: 'A', team: 'Ost', ring: box(13) }] }).ok, false, 'area of an unknown team');
  assert.equal(patch({ areas: [{ name: 'A', team: 'Nord', ring: [[13, 51], [13.01, 51.01], [13.01, 51], [13, 51.01], [13, 51]] }] }).ok, false, 'bow tie');
  assert.equal(patch({ areas: [{ name: 'A', team: 'Nord', ring: [[13, 51], [13.01, 51], [999, 51.01], [13, 51.01], [13, 51]] }] }).ok, false, 'coordinates out of range');
  assert.equal(patch({ areas: Array.from({ length: 301 }, (_, i) => ({ name: `G${i}`, team: 'Nord', ring: box(13) })) }).ok, false, 'too many areas');
  const extra = parseTemplate(JSON.stringify({ ...t, evil: '<script>', rules: { housesOnly: 'yes', x: 1 }, name: 5, teams: [{ name: 'Nord', color: '#2563EB', extra: 1 }, { name: 'Süd', color: '#15803d' }] }));
  assert.ok(extra.ok && !('evil' in extra.template) && extra.template.rules.housesOnly === false && extra.template.name === 'Vorlage' && extra.template.teams[0].color === '#2563eb' && !('extra' in extra.template.teams[0]));
  assert.equal(JSON.parse(serializeTemplate(t)).format, TEMPLATE_FORMAT);
});

test('file names are safe', () => {
  assert.equal(templateFileName('Frühjahr 2027/Nord'), 'fruhjahr-2027-nord.aktion.json');
  assert.equal(templateFileName('../../etc/passwd'), 'etc-passwd.aktion.json');
  assert.equal(templateFileName('///'), 'aktion.aktion.json');
});

const current = { teams: [{ id: 't1', name: 'Nord' }], areas: [{ id: 'a1', name: 'gebiet 1', teamId: 't1', ring: box(13) }, { id: 'a9', name: 'Altes Gebiet', teamId: 't1', ring: box(13.05) }] };

test('plan (admin): creates missing teams and areas, reshapes changed ones, never deletes or moves anything', () => {
  const t = template();
  const same = planTemplate(t, current, { role: 'admin', teamId: null });
  assert.deepEqual(same.createTeams.map((x) => x.name), ['Süd'], 'only the missing team, used by a new area');
  assert.deepEqual(same.createAreas.map((x) => x.name), ['Gebiet 2']);
  assert.deepEqual(same.unchanged, ['Gebiet 1'], 'matched by folded name, identical outline');
  assert.deepEqual(same.reshapeAreas, []);
  assert.deepEqual(same.keep, ['Altes Gebiet'], 'what the template does not know stays');
  const moved = { ...t, areas: [{ ...t.areas[0], ring: box(13, 51.001) }, t.areas[1]] };
  const p = planTemplate(moved, current, { role: 'admin', teamId: null });
  assert.deepEqual(p.reshapeAreas.map((x) => [x.id, x.name]), [['a1', 'gebiet 1']], 'the existing name and id are kept');
  assert.equal(planIsEmpty(planTemplate({ ...t, areas: [t.areas[0]], teams: [t.teams[0]] }, current, { role: 'admin', teamId: null })), true, 'nothing to do');
});

test('plan (team editor): only their own group, no new groups', () => {
  const t = template();
  const p = planTemplate(t, current, { role: 'team-editor', teamId: 't1' });
  assert.deepEqual(p.createTeams, []);
  assert.deepEqual(p.createAreas, [], 'Gebiet 2 belongs to Süd');
  assert.deepEqual(p.skipped, [{ name: 'Gebiet 2', reason: 'Gehört nicht zu deiner Gruppe' }]);
  const mine = planTemplate({ ...t, areas: [{ name: 'Neu', team: 'Nord', ring: box(13.1) }] }, current, { role: 'team-editor', teamId: 't1' });
  assert.deepEqual(mine.createAreas.map((x) => x.name), ['Neu']);
  const foreign = planTemplate(t, { teams: current.teams, areas: [{ id: 'a2', name: 'Gebiet 2', teamId: 'tx', ring: box(13.5) }] }, { role: 'team-editor', teamId: 't1' });
  assert.ok(foreign.skipped.some((s) => s.name === 'Gebiet 2') && !foreign.reshapeAreas.length, 'an editor cannot reshape another group’s area');
});
