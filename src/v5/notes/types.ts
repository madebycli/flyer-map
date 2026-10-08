/** Quick flags: one tap says what a free-text comment would say in ten seconds. Order = order of the picker. */
export const FLAGS = ['dog', 'locked', 'nope', 'full', 'again', 'danger', 'info'] as const;
export type Flag = (typeof FLAGS)[number];
export const FLAG_LABEL: Record<Flag, string> = {
  dog: 'Hund', locked: 'Kein Zutritt', nope: 'Keine Werbung', full: 'Briefkasten voll', again: 'Nochmal kommen', danger: 'Gefahr', info: 'Hinweis',
};
export const NOTE_TEXT_MAX = 500;

/** `s:`/`h:` derived entities and `a:<areaId>` for a whole Area. */
export type NoteKey = string;

/** One note. `id` is the creation timestamp (stable identity); `rev` the timestamp of the latest edit (LWW). */
export type Note = {
  id: string;
  key: NoteKey;
  area: string;
  flag: Flag | null;
  text: string;
  rev: string;
  deleted: boolean;
  by: string;
};

export type NotePersisted = { version: 1; clock: { wall: number; counter: number; node: string }; notes: Note[]; pending: Note[]; cursor: number };
export interface NotePersistence {
  load(): Promise<NotePersisted | null>;
  save(data: NotePersisted): Promise<void>;
}

export const isFlag = (value: unknown): value is Flag => typeof value === 'string' && (FLAGS as readonly string[]).includes(value);
/** Control characters out, whitespace trimmed, length capped: the same rule on device and server. */
export const cleanText = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim().slice(0, NOTE_TEXT_MAX);
export const NOTE_KEY = /^[sha]:[A-Za-z0-9#:._~@-]{1,80}$/u;
