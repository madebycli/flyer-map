import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Icon, Select } from '../../ui/index.ts';
import { SheetFrame } from './sheet.tsx';
import { fetchRoomInfo, joinRoomAsGuest, V5ApiError, type RoomInfo } from './api.ts';
import { useTick } from './useRooms.ts';
import { clock, countdown, hoursText, percentText, runFigures, teamStats, type RoomRecord, type Window } from './roomsLogic.ts';

type Mode = RoomRecord['joinMode'];

const MODES: { mode: Mode; icon: 'send' | 'users' | 'lock' | 'unlock'; label: string; hint: string }[] = [
  { mode: 'link', icon: 'send', label: 'Link / QR', hint: 'Wer den Link oder QR-Code hat, kann mitmachen, aber nur in diesem Gebiet.' },
  { mode: 'team', icon: 'users', label: 'Nur Gruppe', hint: 'Nur Leute, die schon zur Gruppe gehören. Niemand Neues kommt herein.' },
  { mode: 'password', icon: 'lock', label: 'Passwort', hint: 'Link oder QR-Code und zusätzlich ein Passwort, das du vergibst.' },
  { mode: 'open', icon: 'unlock', label: 'Offen', hint: 'Jede Person mit dem Link kommt herein, auch aus anderen Gruppen.' },
];

/** The way of joining, one of four, with what it means underneath. */
export function ModePicker({ value, onChange, disabled }: { value: Mode; onChange(mode: Mode): void; disabled?: boolean }) {
  const current = MODES.find((m) => m.mode === value)!;
  return (
    <>
      <div className="v5-seg" role="group" aria-label="Wer darf beitreten">
        {MODES.map((m) => (
          <button key={m.mode} type="button" className={`v5-seg-btn${m.mode === value ? ' on' : ''}`} style={{ '--c': 'var(--primary)' } as React.CSSProperties} aria-pressed={m.mode === value} disabled={disabled} onClick={() => onChange(m.mode)}>
            <Icon name={m.icon} size={24} /><span>{m.label}</span>
          </button>
        ))}
      </div>
      <p className="v5-hint" style={{ marginTop: 0 }}><Icon name="info" size={20} />{current.hint}</p>
    </>
  );
}

/** How many people take part: a slider and, next to it, a field to type the number (and plus/minus). By hand, never counted from devices. */
export function Headcount({ value, onChange, disabled, required }: { value: number | null; onChange(n: number): void; disabled?: boolean; required?: boolean }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => { setText(value === null ? '' : String(value)); }, [value]);
  const set = (n: number) => { if (Number.isInteger(n) && n >= 1 && n <= 1000) onChange(n); };
  return (
    <div className={`v5-headcount${value === null ? ' untouched' : ''}`}>
      <input type="range" min={1} max={60} step={1} value={Math.min(60, value ?? 8)} disabled={disabled} aria-label="Personenzahl (Schieberegler)" onChange={(e) => set(Number(e.target.value))} />
      <div className="v5-stepper">
        <button type="button" aria-label="Eine Person weniger" disabled={disabled || (value ?? 1) <= 1} onClick={() => set((value ?? 2) - 1)}>−</button>
        <input inputMode="numeric" pattern="[0-9]*" value={text} placeholder="–" disabled={disabled} aria-label="Personenzahl" aria-required={required}
          onChange={(e) => { const raw = e.target.value.replace(/\D/gu, '').slice(0, 4); setText(raw); if (raw) set(Number(raw)); }}
          onBlur={() => setText(value === null ? '' : String(value))} />
        <button type="button" aria-label="Eine Person mehr" disabled={disabled || (value ?? 0) >= 1000} onClick={() => set((value ?? 0) + 1)}>+</button>
      </div>
    </div>
  );
}

/** The time left in the Aktion, and how the work stands against it. Distribution only; nothing without a window. */
export function CountdownCard({ window, now, progress }: { window: Window | null; now: () => number; progress?: number | null }) {
  useTick(!!window, 30_000);
  const c = countdown(window, now());
  if (c.phase === 'none') return null;
  const elapsed = c.phase === 'running' ? c.elapsed : c.phase === 'over' ? 1 : null;
  const behind = elapsed !== null && progress != null && c.phase === 'running' && elapsed * 100 > progress + 5;
  return (
    <div className={`v5-countdown ${c.phase}${c.phase === 'running' && c.urgent ? ' urgent' : ''}`} role="status" aria-label="Zeitfenster der Aktion">
      <span className="v5-countdown-icon"><Icon name="later" size={26} /></span>
      <div>
        <b>{c.text}</b>
        <small>{c.detail}</small>
        {elapsed !== null && (
          <>
            <div className="v5-bar" style={{ '--p': elapsed } as React.CSSProperties} aria-hidden><i /></div>
            {progress != null && <small className={behind ? 'behind' : ''}>{Math.round(elapsed * 100)} % der Zeit · {Math.round(progress)} % der Häuser{c.phase === 'running' ? (behind ? ' · etwas hinterher' : ' · im Plan') : ''}</small>}
          </>
        )}
      </div>
    </div>
  );
}

const toLocalInput = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/** Admin: when the Aktion starts and when everything has to be done. Both optional. */
function WindowEditor({ window, busy, onSave }: { window: Window | null; busy: boolean; onSave(next: Window): void }) {
  const [start, setStart] = useState(toLocalInput(window?.startsAt ?? null)), [end, setEnd] = useState(toLocalInput(window?.endsAt ?? null));
  useEffect(() => { setStart(toLocalInput(window?.startsAt ?? null)); setEnd(toLocalInput(window?.endsAt ?? null)); }, [window?.startsAt, window?.endsAt]);
  const iso = (v: string) => (v ? new Date(v).toISOString() : null);
  const bad = !!start && !!end && new Date(end) <= new Date(start);
  return (
    <div className="v5-form">
      <label className="v5-field"><span>Start</span><input className="v5-input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start des Zeitfensters" disabled={busy} /></label>
      <label className="v5-field"><span>Ende</span><input className="v5-input" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Ende des Zeitfensters" disabled={busy} /></label>
      {bad && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />Das Ende muss nach dem Start liegen.</p>}
      <div className="v5-row">
        <button className="v5-btn primary" style={{ marginTop: 0 }} disabled={busy || bad || (!start && !end && !window)} onClick={() => onSave({ startsAt: iso(start), endsAt: iso(end) })}><Icon name="check" size={20} />Speichern</button>
        {window && <button className="v5-btn" style={{ marginTop: 0 }} disabled={busy} onClick={() => { setStart(''); setEnd(''); onSave({ startsAt: null, endsAt: null }); }}><Icon name="close" size={20} />Entfernen</button>}
      </div>
    </div>
  );
}

const dayText = (iso: string) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

type RoomsProps = {
  role: 'admin' | 'team-editor' | 'viewer' | 'collection-collector';
  window: Window | null;
  rooms: RoomRecord[];
  now: () => number;
  progress: number | null;
  /** May open rooms (an admin or a member of a Gruppe, not a guest or a reader). */
  staff: boolean;
  canStart: boolean;
  startHint: string | null;
  busy: boolean;
  error: string | null;
  onStart(): void;
  onOpen(room: RoomRecord): void;
  onDelete(room: RoomRecord): void;
  onWindow(next: Window): void;
  onClose(): void;
};

/** Runs: the time left, the rooms that are open, a way to open one, and the record of the finished ones (the numbers for the feedback round and for planning). */
export function RoomsSheet({ role, window, rooms, now, progress, staff, canStart, startHint, busy, error, onStart, onOpen, onDelete, onWindow, onClose }: RoomsProps) {
  useTick(true, 1000);
  const t = now();
  const active = rooms.filter((r) => r.status === 'active');
  const finished = rooms.filter((r) => r.status === 'finished');
  const { total, teams } = useMemo(() => teamStats(rooms, 0), [rooms]);
  return (
    <SheetFrame icon="later" title="Runs" onClose={onClose} meta={<span><Icon name="users" size={16} />{finished.length} {finished.length === 1 ? 'Run' : 'Runs'} beendet</span>}>
      {error && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />{error}</p>}
      <CountdownCard window={window} now={now} progress={progress} />
      {active.map((r) => (
        <button key={r.id} className="v5-roomcard" onClick={() => onOpen(r)} aria-label={`Raum ${r.areaName} öffnen`} style={{ '--c': r.teamColor } as React.CSSProperties}>
          <span className="dot" aria-hidden />
          <span className="body"><b>{r.areaName}</b><small>{r.teamName} · {r.headcount} {r.headcount === 1 ? 'Person' : 'Personen'} · {r.housesDone ?? 0} Häuser</small></span>
          <span className="time">{clock(t - Date.parse(r.startedAt))}</span>
        </button>
      ))}
      {staff && (
        <>
          <button className="v5-btn primary" style={{ marginTop: active.length ? 0 : undefined }} onClick={onStart} disabled={!canStart}><Icon name="plus" size={20} />Raum öffnen</button>
          {startHint && <p className="v5-hint"><Icon name="info" size={20} />{startHint}</p>}
        </>
      )}
      {finished.length > 0 && (
        <>
          <h3>Zahlen</h3>
          <div className="v5-stats">
            <div className="v5-stat"><b>{total.runs}</b><small>Runs</small></div>
            <div className="v5-stat"><b>{hoursText(total.hours)}</b><small>Zeit</small></div>
            <div className="v5-stat"><b>{total.houses.toLocaleString('de')}</b><small>Häuser</small></div>
            <div className="v5-stat"><b>{total.perPersonHour === null ? '–' : total.perPersonHour.toFixed(1).replace('.', ',')}</b><small>je Person und Std</small></div>
          </div>
          {teams.length > 1 || role === 'admin' ? (
            <div className="v5-list">
              {teams.map((t) => (
                <div key={t.teamId} className="v5-areabar" style={{ cursor: 'default' }}>
                  <div><b><span className="v5-dotc" style={{ background: t.color }} />{t.name}</b><span>{t.runs} {t.runs === 1 ? 'Run' : 'Runs'} · {hoursText(t.hours)} · Ø {t.averagePeople.toFixed(1).replace('.', ',')} Personen · {t.houses.toLocaleString('de')} Häuser</span></div>
                </div>
              ))}
            </div>
          ) : null}
          <h3>Alle Runs</h3>
          <div className="v5-list">
            {finished.map((r) => {
              const f = runFigures(r, t);
              return (
                <div key={r.id} className="v5-runrow" style={{ '--c': r.teamColor } as React.CSSProperties}>
                  <div className="head"><span className="dot" aria-hidden /><b>{r.areaName}</b><span className="team">{r.teamName}</span>
                    {role === 'admin' && <button className="v5-icon-btn" onClick={() => onDelete(r)} aria-label={`Run ${r.areaName} löschen`} title="Löschen"><Icon name="trash" size={18} /></button>}</div>
                  <small>{dayText(r.startedAt)}</small>
                  <div className="figures">
                    <span><b>{hoursText(f.hours)}</b>Zeit</span><span><b>{r.headcount}</b>Personen</span><span><b>{f.houses.toLocaleString('de')}</b>Häuser</span><span><b>{percentText(f.percent)}</b>vom Gebiet</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {role === 'admin' && (
        <>
          <h3>Zeitfenster der Aktion</h3>
          <p className="v5-hint" style={{ marginTop: 0 }}><Icon name="info" size={20} />Start und Ende der Aktion. Alle sehen den Countdown, auch im Menü.</p>
          <WindowEditor window={window} busy={busy} onSave={onWindow} />
        </>
      )}
    </SheetFrame>
  );
}

type StartProps = {
  areas: { id: string; name: string; teamName: string; teamColor: string }[];
  defaultAreaId: string;
  busy: boolean;
  error: string | null;
  onStart(input: { areaId: string; headcount: number; joinMode: Mode; password?: string }): void;
  onBack(): void;
};

/** Open a room: which Gebiet, how many people (required, by hand), who may join. */
export function RoomStartSheet({ areas, defaultAreaId, busy, error, onStart, onBack }: StartProps) {
  const [areaId, setAreaId] = useState(areas.some((a) => a.id === defaultAreaId) ? defaultAreaId : areas[0]?.id ?? '');
  const [count, setCount] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('link');
  const [password, setPassword] = useState('');
  const passwordOk = mode !== 'password' || (password.length >= 4 && password.length <= 64);
  const ready = !!areaId && count !== null && passwordOk && !busy;
  return (
    <SheetFrame icon="later" title="Raum öffnen" onClose={onBack}>
      {error && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />{error}</p>}
      <div className="v5-form">
        <label className="v5-field"><span>Gebiet</span>
          <Select value={areaId} onChange={(e) => setAreaId(e.target.value)} aria-label="Gebiet" disabled={busy || areas.length < 2}>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.teamName}</option>)}
          </Select>
        </label>
        <div className="v5-field"><span>Wie viele Personen sind dabei?</span><Headcount value={count} onChange={setCount} disabled={busy} required /></div>
        {count === null && <p className="v5-hint" style={{ margin: 0 }}><Icon name="info" size={20} />Das ist Pflicht. Du trägst die Zahl selbst ein, Geräte werden nicht gezählt.</p>}
        <div className="v5-field"><span>Wer darf beitreten?</span><ModePicker value={mode} onChange={setMode} disabled={busy} /></div>
        {mode === 'password' && (
          <label className="v5-field"><span>Passwort</span>
            <input className="v5-input" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value.slice(0, 64))} aria-label="Passwort für den Raum" placeholder="mindestens 4 Zeichen" disabled={busy} />
          </label>
        )}
        <button className="v5-btn primary" style={{ marginTop: 0 }} disabled={!ready} onClick={() => onStart({ areaId, headcount: count!, joinMode: mode, ...(mode === 'password' ? { password } : {}) })}><Icon name="check" size={20} />Raum öffnen</button>
      </div>
    </SheetFrame>
  );
}

type RoomProps = {
  room: RoomRecord;
  now: () => number;
  link: string | null;
  canManage: boolean;
  busy: boolean;
  error: string | null;
  summary: boolean;
  onHeadcount(n: number): void;
  onMode(mode: Mode, password?: string): void;
  onFinish(): void;
  onClose(): void;
};

/** One room: the clock, the people, the way to join (QR code and link), and the end. A finished room shows its result. */
export function RoomSheet({ room, now, link, canManage, busy, error, summary, onHeadcount, onMode, onFinish, onClose }: RoomProps) {
  useTick(room.status === 'active', 1000);
  const t = now();
  const [copied, setCopied] = useState(false);
  // the slider sends one change when it comes to rest, not one per pixel
  const [count, setCount] = useState(room.headcount);
  const pending = useRef<number | null>(null);
  useEffect(() => { if (pending.current === null) setCount(room.headcount); }, [room.headcount]);
  const changeCount = (n: number) => { setCount(n); if (pending.current !== null) window.clearTimeout(pending.current); pending.current = window.setTimeout(() => { pending.current = null; onHeadcount(n); }, 500); };
  useEffect(() => () => { if (pending.current !== null) window.clearTimeout(pending.current); }, []);
  const [mode, setMode] = useState<Mode>(room.joinMode);
  const [password, setPassword] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => { setMode(room.joinMode); }, [room.joinMode]);
  const f = runFigures(room, t);
  const finished = room.status === 'finished';
  const share = () => { if (link && typeof navigator.share === 'function') void navigator.share({ title: `Raum ${room.areaName}`, url: link }).catch(() => {}); };
  return (
    <SheetFrame icon="later" title={`Raum · ${room.areaName}`} onClose={onClose} meta={<span><span className="v5-dotc" style={{ background: room.teamColor }} />{room.teamName}</span>}>
      {error && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />{error}</p>}
      {finished ? (
        <div className="v5-summary" role="status">
          <h3 style={{ marginTop: 0 }}>{summary ? 'Run beendet' : 'Beendeter Run'}</h3>
          <div className="v5-stats">
            <div className="v5-stat"><b>{hoursText(f.hours)}</b><small>Zeit</small></div>
            <div className="v5-stat"><b>{room.headcount}</b><small>Personen</small></div>
            <div className="v5-stat"><b>{f.houses.toLocaleString('de')}</b><small>Häuser</small></div>
            <div className="v5-stat"><b>{percentText(f.percent)}</b><small>vom Gebiet</small></div>
          </div>
          <p className="v5-hint"><Icon name="info" size={20} />{f.perPersonHour === null ? 'Zu kurz für eine Rate.' : `${f.perPersonHour.toFixed(1).replace('.', ',')} Häuser je Person und Stunde.`} {room.areaDone !== null ? `Im Gebiet insgesamt ${room.areaDone.toLocaleString('de')} Häuser erledigt.` : ''}</p>
          <button className="v5-btn primary" onClick={onClose}><Icon name="check" size={20} />Fertig</button>
        </div>
      ) : (
        <>
          <div className="v5-roomclock" aria-label="Laufzeit des Raums" role="timer"><b>{clock(t - Date.parse(room.startedAt))}</b><small>seit {dayText(room.startedAt)} · {(room.housesDone ?? 0).toLocaleString('de')} Häuser</small></div>
          <h3>Personen</h3>
          <Headcount value={count} onChange={changeCount} disabled={busy} />
          <p className="v5-hint" style={{ marginTop: 0 }}><Icon name="info" size={20} />Die Zahl stimmst du selbst ab. Wer dazukommt oder geht, ändert sie nicht von allein.</p>
          <h3>Beitreten</h3>
          {room.joinMode === 'team' ? <p className="v5-hint" style={{ marginTop: 0 }}><Icon name="users" size={20} />Nur die Gruppe. Niemand Neues kommt herein.</p> : link && (
            <div className="v5-syncbox" aria-label="Beitrittslink">
              <div className="v5-qr"><QRCodeSVG value={link} size={176} level="M" /></div>
              {room.joinMode === 'password' && <small><Icon name="lock" size={16} /> Zusätzlich braucht man das Passwort.</small>}
              <input className="v5-input" readOnly value={link} aria-label="Beitrittslink" onFocus={(e) => e.currentTarget.select()} />
              <div className="v5-row">
                <button className="v5-btn primary" style={{ marginTop: 0 }} onClick={() => void navigator.clipboard.writeText(link).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2500); })}><Icon name="upload" size={20} />{copied ? 'Kopiert' : 'Link kopieren'}</button>
                {typeof navigator.share === 'function' && <button className="v5-btn" style={{ marginTop: 0 }} onClick={share}><Icon name="send" size={20} />Teilen</button>}
              </div>
            </div>
          )}
          {canManage && (
            <>
              <button className="v5-btn" onClick={() => setEditing((v) => !v)} aria-expanded={editing}><Icon name="lock" size={20} />Wer darf beitreten? ändern</button>
              {editing && (
                <div className="v5-form" style={{ marginTop: '0.8rem' }}>
                  <ModePicker value={mode} onChange={setMode} disabled={busy} />
                  {mode === 'password' && <input className="v5-input" type="text" autoComplete="off" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value.slice(0, 64))} placeholder={room.passwordSet ? 'neues Passwort (leer lassen: bleibt)' : 'mindestens 4 Zeichen'} aria-label="Passwort für den Raum" disabled={busy} />}
                  <button className="v5-btn primary" style={{ marginTop: 0 }} disabled={busy || (mode === room.joinMode && !password) || (mode === 'password' && !room.passwordSet && password.length < 4) || (password !== '' && password.length < 4)}
                    onClick={() => { onMode(mode, mode === 'password' && password ? password : undefined); setPassword(''); setEditing(false); }}><Icon name="check" size={20} />Übernehmen</button>
                </div>
              )}
              <button className="v5-btn danger" onClick={onFinish} disabled={busy}><Icon name="exit" size={20} />Run beenden</button>
              <p className="v5-hint"><Icon name="info" size={20} />Beim Beenden endet der Zugang aller Gäste. Zeit, Personen und geschaffte Häuser bleiben als Zahlen gespeichert.</p>
            </>
          )}
        </>
      )}
    </SheetFrame>
  );
}

/** The chip next to the menu while a room is open: the running clock, a tap opens the room (or the list when there are several). */
export function RoomChip({ rooms, now, onClick }: { rooms: RoomRecord[]; now: () => number; onClick(): void }) {
  useTick(rooms.length > 0, 1000);
  if (!rooms.length) return null;
  const first = rooms[0];
  const t = now();
  return (
    <button className="v5-roomchip" onClick={onClick} aria-label={rooms.length === 1 ? `Raum ${first.areaName}, läuft seit ${clock(t - Date.parse(first.startedAt))}` : `${rooms.length} Räume laufen`} title="Raum">
      <i aria-hidden />{rooms.length === 1 ? clock(t - Date.parse(first.startedAt)) : `${rooms.length} Räume`}
    </button>
  );
}

const JOIN_ERRORS: Record<string, string> = {
  wrong_password: 'Das Passwort stimmt nicht.', room_locked: 'Zu viele Versuche. Bitte in ein paar Minuten noch einmal.', room_finished: 'Dieser Raum ist beendet.',
  team_only: 'In diesen Raum kommen nur Mitglieder der Gruppe.', room_full: 'In diesem Raum sind zu viele Gäste.', not_found: 'Diesen Raum gibt es nicht, oder der Link stimmt nicht.',
};

/** What a person sees who opens a room link without having an access yet (or with another one): the room, a name, a password if needed, and in. */
export function JoinRoom({ roomId, secret, campaignId }: { roomId: string; secret: string | null; campaignId: string }) {
  const [info, setInfo] = useState<RoomInfo | 'missing' | null>(null);
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchRoomInfo(roomId, secret).then(setInfo, () => setInfo('missing')); }, [roomId, secret]);
  const toApp = (id: string) => location.replace(`/v5?campaign=${encodeURIComponent(id)}`);
  const join = async () => {
    setBusy(true); setError(null);
    try { const reply = await joinRoomAsGuest(roomId, { label: label.trim(), j: secret, ...(password ? { password } : {}) }); toApp(reply.campaignId); }
    catch (failure) {
      if (failure instanceof V5ApiError && (failure.code === 'already_member' || failure.code === 'already_signed_in')) { toApp(campaignId); return; }
      setError(failure instanceof V5ApiError ? JOIN_ERRORS[failure.code] ?? failure.message : 'Keine Verbindung. Bitte noch einmal versuchen.'); setBusy(false);
    }
  };
  if (info === null) return <div className="v5-overlay"><div className="v5-card"><h2>Raum</h2><p>Wird geladen …</p></div></div>;
  if (info === 'missing') return <div className="v5-overlay"><div className="v5-card"><h2>Raum nicht gefunden</h2><p>{JOIN_ERRORS.not_found}</p></div></div>;
  if (!info.canJoin) return (
    <div className="v5-overlay"><div className="v5-card"><h2>{info.status === 'finished' ? 'Raum beendet' : 'Kein Beitritt per Link'}</h2><p>{JOIN_ERRORS[info.reason === 'finished' ? 'room_finished' : 'team_only'] ?? 'Hier geht es nicht weiter.'}</p>
      <button className="v5-btn primary" onClick={() => toApp(campaignId)}><Icon name="back" size={20} />Zur Karte</button></div></div>
  );
  return (
    <div className="v5-overlay">
      <div className="v5-card v5-join">
        <h2>Raum beitreten</h2>
        <p><b>{info.areaName}</b><br />{info.campaignName}</p>
        <input className="v5-input" value={label} onChange={(e) => setLabel(e.target.value.slice(0, 40))} placeholder="Dein Name (freiwillig)" aria-label="Dein Name" autoComplete="given-name" disabled={busy} />
        {info.passwordRequired && <input className="v5-input" type="password" value={password} onChange={(e) => setPassword(e.target.value.slice(0, 64))} placeholder="Passwort" aria-label="Passwort" autoComplete="off" disabled={busy} />}
        {error && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />{error}</p>}
        <p className="v5-hint" style={{ margin: 0 }}><Icon name="info" size={20} />Du arbeitest nur in diesem Gebiet, solange der Raum läuft.</p>
        <button className="v5-btn primary" onClick={() => void join()} disabled={busy || (info.passwordRequired && !password)}><Icon name="check" size={20} />Beitreten</button>
      </div>
    </div>
  );
}

/** The time left, as one line for the menu. */
export function CountdownLine({ window, now }: { window: Window | null; now: () => number }) {
  useTick(!!window, 30_000);
  const c = countdown(window, now());
  return c.phase === 'none' ? null : <span className={c.phase === 'over' || (c.phase === 'running' && c.urgent) ? 'v5-late' : undefined}><Icon name="later" size={16} />{c.text}</span>;
}
