/** Pure helpers for Räume: the countdown to the end of the Aktion, clock and span texts, and the planning numbers of finished runs. */
export type Window = { startsAt: string | null; endsAt: string | null };

export type Countdown =
  | { phase: 'none' }
  | { phase: 'before'; ms: number; text: string; detail: string }
  | { phase: 'running'; ms: number; text: string; detail: string; elapsed: number | null; urgent: boolean }
  | { phase: 'over'; ms: number; text: string; detail: string };

const DAY = 86_400_000, HOUR = 3_600_000, MINUTE = 60_000;

/** "12 Tage 4 Std", "5 Std 12 Min", "42 Min": the two biggest units that still matter. */
export function span(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MINUTE));
  const days = Math.floor(total / 1440), hours = Math.floor((total % 1440) / 60), minutes = total % 60;
  if (days >= 1) return hours ? `${days} ${days === 1 ? 'Tag' : 'Tage'} ${hours} Std` : `${days} ${days === 1 ? 'Tag' : 'Tage'}`;
  if (hours >= 1) return minutes ? `${hours} Std ${minutes} Min` : `${hours} Std`;
  return `${minutes} Min`;
}

/** The running time of a room as a clock: "1:24" (hours:minutes) from an hour on, "12:05" (minutes:seconds) before. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return h >= 1 ? `${h}:${String(m).padStart(2, '0')} Std` : `${m}:${String(s).padStart(2, '0')} Min`;
}

const dateText = (iso: string) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function countdown(window: Window | null | undefined, now: number): Countdown {
  if (!window || (!window.startsAt && !window.endsAt)) return { phase: 'none' };
  const start = window.startsAt ? Date.parse(window.startsAt) : null, end = window.endsAt ? Date.parse(window.endsAt) : null;
  if (start !== null && now < start) return { phase: 'before', ms: start - now, text: `Startet in ${span(start - now)}`, detail: `ab ${dateText(window.startsAt!)}` };
  if (end === null) return { phase: 'none' };
  if (now >= end) return { phase: 'over', ms: now - end, text: `Zeitfenster vorbei seit ${span(now - end)}`, detail: `endete ${dateText(window.endsAt!)}` };
  const elapsed = start !== null ? Math.min(1, Math.max(0, (now - start) / (end - start))) : null;
  return { phase: 'running', ms: end - now, text: `Noch ${span(end - now)}`, detail: `bis ${dateText(window.endsAt!)}`, elapsed, urgent: end - now < 2 * DAY };
}

export type RoomRecord = {
  id: string; areaId: string; areaName: string; teamId: string; teamName: string; teamColor: string; status: 'active' | 'finished';
  headcount: number; joinMode: 'link' | 'team' | 'password' | 'open'; passwordSet: boolean; startedAt: string; endedAt: string | null; startedBy: string;
  housesTotal: number | null; housesDone: number | null; areaDone: number | null; joinSecret?: string;
};

export type RunFigures = { id: string; hours: number; personHours: number; houses: number; percent: number | null; perPersonHour: number | null };

/** The numbers of one finished (or running) run. `percent` is the share of the Gebiet's houses done in this run; null while the number of houses is unknown. */
export function runFigures(room: RoomRecord, now: number): RunFigures {
  const end = room.endedAt ? Date.parse(room.endedAt) : now;
  const hours = Math.max(0, end - Date.parse(room.startedAt)) / HOUR;
  const houses = room.housesDone ?? 0;
  const personHours = hours * room.headcount;
  return {
    id: room.id, hours, personHours, houses,
    percent: room.housesTotal && room.housesTotal > 0 ? (houses / room.housesTotal) * 100 : null,
    perPersonHour: personHours >= 0.05 ? houses / personHours : null,
  };
}

export type TeamStats = { teamId: string; name: string; color: string; runs: number; hours: number; personHours: number; houses: number; averagePeople: number; perPersonHour: number | null };

/** Per Gruppe: runs, time, people-hours, houses; for the feedback round after an Aktion and for planning the next Gebiete. */
export function teamStats(rooms: RoomRecord[], now: number): { total: TeamStats; teams: TeamStats[] } {
  const done = rooms.filter((r) => r.status === 'finished');
  const build = (teamId: string, name: string, color: string, list: RoomRecord[]): TeamStats => {
    const figures = list.map((r) => runFigures(r, now));
    const hours = figures.reduce((s, f) => s + f.hours, 0), personHours = figures.reduce((s, f) => s + f.personHours, 0), houses = figures.reduce((s, f) => s + f.houses, 0);
    return { teamId, name, color, runs: list.length, hours, personHours, houses, averagePeople: list.length ? list.reduce((s, r) => s + r.headcount, 0) / list.length : 0, perPersonHour: personHours >= 0.05 ? houses / personHours : null };
  };
  const byTeam = new Map<string, RoomRecord[]>();
  for (const r of done) byTeam.set(r.teamId, [...(byTeam.get(r.teamId) ?? []), r]);
  const teams = [...byTeam.entries()].map(([id, list]) => build(id, list[0].teamName, list[0].teamColor, list)).sort((a, b) => b.houses - a.houses);
  return { total: build('', 'Alle', '', done), teams };
}

export const hoursText = (hours: number) => (hours >= 1 ? `${hours.toFixed(1).replace('.', ',')} Std` : `${Math.round(hours * 60)} Min`);
export const percentText = (percent: number | null) => (percent === null ? '–' : `${percent >= 10 ? Math.round(percent) : percent.toFixed(1).replace('.', ',')} %`);

/** The address a guest opens: the app with the room in the query and the secret in the fragment (it never reaches a server log). */
export function roomLinkFor(origin: string, campaignId: string, roomId: string, secret: string | null): string {
  const query = new URLSearchParams({ campaign: campaignId, room: roomId }).toString();
  return `${origin}/v5?${query}${secret ? `#${new URLSearchParams({ j: secret }).toString()}` : ''}`;
}

export function roomIntent(search: string, hash: string): { campaignId: string; roomId: string; secret: string | null } | null {
  const q = new URLSearchParams(search);
  const campaignId = q.get('campaign'), roomId = q.get('room');
  if (!campaignId || !roomId || !/^[A-Za-z0-9._:-]{1,160}$/u.test(roomId)) return null;
  const j = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('j');
  return { campaignId, roomId, secret: j && j.length >= 16 && j.length <= 256 ? j : null };
}
