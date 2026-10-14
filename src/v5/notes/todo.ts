import { NOTE_TEXT_MAX } from './types.ts';

/**
 * A to-do list is a note whose lines read `- [ ] text` or `- [x] text`. The note stays plain text (500 characters), so it is stored, synced and
 * merged like any other note; a tick is an edit of its text. Other lines of the note stay as they are.
 */
export type TodoLine = { index: number; text: string; done: boolean };
const LINE = /^- \[( |x|X)\] ?(.*)$/u;

export function todoLines(text: string): TodoLine[] {
  const out: TodoLine[] = [];
  text.split('\n').forEach((line, index) => { const m = LINE.exec(line.trimEnd()); if (m) out.push({ index, text: m[2], done: m[1] !== ' ' }); });
  return out;
}

export const isTodo = (text: string) => todoLines(text).length > 0;

/** The text with the box of line `index` ticked or unticked; unchanged when that line is not a to-do line. */
export function toggleTodo(text: string, index: number): string {
  const lines = text.split('\n');
  const m = LINE.exec((lines[index] ?? '').trimEnd());
  if (!m) return text;
  lines[index] = `- [${m[1] === ' ' ? 'x' : ' '}] ${m[2]}`;
  return lines.join('\n');
}

/** One more open item at the end, or null when the note would grow past its limit. */
export function addTodo(text: string, item: string): string | null {
  const clean = item.replace(/\s+/gu, ' ').trim();
  if (!clean) return null;
  const next = `${text ? `${text}\n` : ''}- [ ] ${clean}`;
  return next.length <= NOTE_TEXT_MAX ? next : null;
}

/** "2/5" for a list, null for a plain note. */
export function todoProgress(text: string): { done: number; total: number } | null {
  const lines = todoLines(text);
  return lines.length ? { done: lines.filter((l) => l.done).length, total: lines.length } : null;
}
