import test from 'node:test';
import assert from 'node:assert/strict';
import { addTodo, isTodo, todoLines, todoProgress, toggleTodo } from '../src/v5/notes/todo.ts';
import { ALL_FLAGS, FLAGS, isFlag } from '../src/v5/notes/types.ts';

test('to-do notes: lines "- [ ] x" are boxes, a tick is a change of the text, other lines stay', () => {
  const text = 'Klingel defekt\n- [ ] Briefkasten prüfen\n- [x] Tor schließen\n- [ ] Nochmal kommen';
  assert.equal(isTodo(text), true);
  assert.equal(isTodo('nur Text'), false);
  assert.deepEqual(todoLines(text).map((l) => [l.index, l.text, l.done]), [[1, 'Briefkasten prüfen', false], [2, 'Tor schließen', true], [3, 'Nochmal kommen', false]]);
  assert.deepEqual(todoProgress(text), { done: 1, total: 3 });
  assert.equal(toggleTodo(text, 1), 'Klingel defekt\n- [x] Briefkasten prüfen\n- [x] Tor schließen\n- [ ] Nochmal kommen');
  assert.equal(toggleTodo(toggleTodo(text, 2), 2), text, 'ticking twice is a no-op');
  assert.equal(toggleTodo(text, 0), text, 'a plain line is not a box');
  assert.equal(toggleTodo(text, 99), text);
  assert.equal(todoProgress('nur Text'), null);
});

test('to-do notes: adding keeps the list, collapses whitespace, refuses past 500 characters and empty items', () => {
  assert.equal(addTodo('', '  Tor   prüfen '), '- [ ] Tor prüfen');
  assert.equal(addTodo('- [ ] a', 'b'), '- [ ] a\n- [ ] b');
  assert.equal(addTodo('- [ ] a', '   '), null);
  assert.equal(addTodo('x'.repeat(495), 'abc'), null);
});

test('flags: the picker offers five, the dog and the danger flag are gone from it but old notes with them are still accepted', () => {
  assert.deepEqual([...FLAGS], ['locked', 'nope', 'full', 'again', 'info']);
  assert.ok(isFlag('dog') && isFlag('danger') && isFlag('nope'));
  assert.ok(!isFlag('cat') && !isFlag(null));
  assert.ok(ALL_FLAGS.includes('dog') && ALL_FLAGS.includes('danger'));
});
