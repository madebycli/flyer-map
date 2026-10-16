import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/v5/app/v5.css', import.meta.url), 'utf8');

test('section titles inside sheets are sentence case with an accent bar (a bad search-and-replace once merged these rules away)', () => {
  assert.match(css, /^\.v5-sheet-body h3 \{[^}]*text-transform: none[^}]*\}/mu);
  assert.match(css, /^\.v5-sheet-body h3::before \{[^}]*content: ''[^}]*\}/mu);
  assert.doesNotMatch(css, /h3, \.v5-sheet-body h3::before, :is\(/u, 'no selector list that joins the heading rules with the list-corner rule');
  assert.match(css, /^:is\(\.v5-results, \.v5-arealist, \.v5-list\) > :first-child \{/mu);
});
