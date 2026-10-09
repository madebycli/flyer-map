import { useCallback, useState, useSyncExternalStore } from 'react';
import type { Feature, FeatureCollection } from 'geojson';
import type { LngLat } from '../engine/types.ts';
import { FLAGS, FLAG_LABEL, NOTE_TEXT_MAX, type Flag, type Note, type NoteKey } from '../notes/types.ts';
import type { NoteStore } from '../notes/store.ts';
import type { Meta } from './api.ts';
import type { Index } from './mark.ts';
import { Icon, type IconName } from '../../ui/index.ts';

export const FLAG_ICON: Record<Flag, IconName> = { dog: 'paw', locked: 'lock', nope: 'noAds', full: 'mailbox', again: 'repeat', danger: 'warning', info: 'info' };
/** Same hue on dark and light basemaps; danger/locked read as "stop", the rest as information. */
export const FLAG_COLOR: Record<Flag, string> = { dog: '#ffb74d', locked: '#ff6b5e', nope: '#c77dff', full: '#4dabf7', again: '#69db7c', danger: '#ff2d55', info: '#b0bec5' };
/** When one place carries several flags, the most important one colours the marker. */
const PRIORITY: Flag[] = ['danger', 'locked', 'dog', 'nope', 'again', 'full', 'info'];

/** Notes on a whole street piece are keyed by its junction segment, so chunks never split a remark. */
export const segmentNoteKey = (group: string): NoteKey => `s:${group}`;
export const houseNoteKey = (id: string): NoteKey => `h:${id}`;
export const areaNoteKey = (id: string): NoteKey => `a:${id}`;

export function useNotesVersion(store: NoteStore | null): number {
  return useSyncExternalStore(
    useCallback((listener) => (store ? store.subscribe(() => listener()) : () => {}), [store]),
    () => (store ? store.version : 0),
  );
}

export function useNotesFor(store: NoteStore | null, key: NoteKey | null): Note[] {
  useNotesVersion(store);
  return store && key ? store.forKey(key) : [];
}

/** Where a note's marker sits: house centre, middle of the street piece, centre of the Area's box. */
export function notePosition(key: NoteKey, index: Index, areas: Meta['areas']): LngLat | null {
  const id = key.slice(2);
  if (key.startsWith('h:')) return index.houses.get(id)?.center ?? null;
  if (key.startsWith('s:')) {
    const chunks = index.chunksByGroup.get(id) ?? (index.segments.get(id) ? [index.segments.get(id)!] : null);
    if (!chunks?.length) return null;
    return chunks[Math.floor((chunks.length - 1) / 2)].mid;
  }
  const area = areas.find((a) => a.id === id);
  if (!area) return null;
  const ring = area.geometry.coordinates[0];
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [(w + e) / 2, (s + n) / 2];
}

/** One marker per annotated place. Places that no longer exist (an Area was removed) simply have no marker. */
export function noteFeatures(notes: Note[], index: Index, areas: Meta['areas']): FeatureCollection {
  const byKey = new Map<NoteKey, Note[]>();
  for (const note of notes) {
    const list = byKey.get(note.key);
    if (list) list.push(note); else byKey.set(note.key, [note]);
  }
  const features: Feature[] = [];
  for (const [key, list] of byKey) {
    const at = notePosition(key, index, areas);
    if (!at) continue;
    const flags = list.map((n) => n.flag ?? 'info');
    const top = PRIORITY.find((f) => flags.includes(f)) ?? 'info';
    features.push({ type: 'Feature', properties: { key, count: list.length, flag: top, color: FLAG_COLOR[top] }, geometry: { type: 'Point', coordinates: at } });
  }
  return { type: 'FeatureCollection', features };
}

const ago = (rev: string): string => {
  const wall = parseInt(rev.slice(0, 11), 36);
  const minutes = Math.max(0, Math.round((Date.now() - wall) / 60000));
  if (minutes < 1) return 'jetzt';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
};

/**
 * Notes for one place. The flag row works as toggles (one tap = "Hund hier", tap again = gone); typing a text first
 * and then tapping a flag attaches both. Everything is local-first and synced like a status.
 */
export function NotesPane({ store, target, area, canWrite, onUndo }: {
  store: NoteStore | null; target: NoteKey; area: string; canWrite: boolean; onUndo: (label: string, revert: () => void) => void;
}) {
  const notes = useNotesFor(store, target);
  const [draft, setDraft] = useState('');
  if (!store) return null;
  const quick = (flag: Flag) => {
    const existing = notes.find((n) => n.flag === flag && n.text === '');
    if (existing && draft.trim() === '') { store.remove(existing.id); return; }
    store.add(target, area, flag, draft);
    setDraft('');
  };
  const send = () => { if (store.add(target, area, null, draft)) setDraft(''); };
  const active = new Set(notes.map((n) => n.flag).filter(Boolean));
  return (
    <div className="v5-notes">
      {canWrite && (
        <div className="v5-flags" role="group" aria-label="Schnellnotiz">
          {FLAGS.map((flag) => (
            <button key={flag} className={`v5-flag${active.has(flag) ? ' on' : ''}`} style={{ '--c': FLAG_COLOR[flag] } as React.CSSProperties}
              onClick={() => quick(flag)} aria-pressed={active.has(flag)} aria-label={FLAG_LABEL[flag]} title={FLAG_LABEL[flag]}>
              <Icon name={FLAG_ICON[flag]} size={24} />
            </button>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <ul className="v5-note-list">
          {notes.map((note) => (
            <li key={note.id} className="v5-note" style={{ '--c': FLAG_COLOR[note.flag ?? 'info'] } as React.CSSProperties}>
              <span className="v5-note-ico"><Icon name={note.flag ? FLAG_ICON[note.flag] : 'message'} size={20} /></span>
              <div className="v5-note-body">
                <span>{note.text || (note.flag ? FLAG_LABEL[note.flag] : '')}</span>
                <small>{note.by === store.actor ? 'Ich' : note.by} · {ago(note.rev)}</small>
              </div>
              {canWrite && <button className="v5-icon-btn" aria-label="Notiz löschen" title="Notiz löschen" onClick={() => { store.remove(note.id); onUndo('Notiz gelöscht', () => { store.restore(note.id); }); }}><Icon name="trash" size={20} /></button>}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form className="v5-note-form" onSubmit={(event) => { event.preventDefault(); send(); }}>
          <input value={draft} onChange={(event) => setDraft(event.target.value.slice(0, NOTE_TEXT_MAX))} placeholder="Notiz" aria-label="Notiz" maxLength={NOTE_TEXT_MAX} enterKeyHint="send" autoComplete="off" />
          <button type="submit" className="v5-icon-btn tonal" disabled={draft.trim() === ''} aria-label="Notiz speichern" title="Notiz speichern"><Icon name="send" size={22} /></button>
        </form>
      )}
    </div>
  );
}

/** All notes of the Aktion, newest first, with a one-tap filter by flag; tapping a row jumps to the place. */
export function NotesOverview({ store, index, areas, onOpen }: { store: NoteStore | null; index: Index | null; areas: Meta['areas']; onOpen: (key: NoteKey) => void }) {
  useNotesVersion(store);
  const [filter, setFilter] = useState<Flag | null>(null);
  if (!store || !index) return null;
  const all = store.all().filter((n) => notePosition(n.key, index, areas) !== null).reverse();
  const counts = new Map<Flag, number>();
  for (const n of all) if (n.flag) counts.set(n.flag, (counts.get(n.flag) ?? 0) + 1);
  const shown = (filter ? all.filter((n) => n.flag === filter) : all).slice(0, 80);
  return (
    <div className="v5-notes">
      <div className="v5-flags" role="group" aria-label="Filter">
        {FLAGS.filter((f) => counts.has(f)).map((flag) => (
          <button key={flag} className={`v5-flag${filter === flag ? ' on' : ''}`} style={{ '--c': FLAG_COLOR[flag] } as React.CSSProperties}
            onClick={() => setFilter(filter === flag ? null : flag)} aria-pressed={filter === flag} aria-label={`${FLAG_LABEL[flag]} (${counts.get(flag)})`} title={FLAG_LABEL[flag]}>
            <Icon name={FLAG_ICON[flag]} size={22} /><b>{counts.get(flag)}</b>
          </button>
        ))}
      </div>
      {shown.length === 0 ? <p className="v5-hint"><Icon name="message" size={22} /></p> : (
        <ul className="v5-note-list">
          {shown.map((note) => (
            <li key={note.id}>
              <button className="v5-note v5-note-open" style={{ '--c': FLAG_COLOR[note.flag ?? 'info'] } as React.CSSProperties} onClick={() => onOpen(note.key)}>
                <span className="v5-note-ico"><Icon name={note.flag ? FLAG_ICON[note.flag] : 'message'} size={20} /></span>
                <div className="v5-note-body"><span>{note.text || (note.flag ? FLAG_LABEL[note.flag] : '')}</span><small>{note.by === store.actor ? 'Ich' : note.by} · {ago(note.rev)}</small></div>
                <Icon name={note.key.startsWith('h:') ? 'house' : note.key.startsWith('s:') ? 'road' : 'polygon'} size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
