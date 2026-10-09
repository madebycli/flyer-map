import { decodeClock } from '../store/hlc.ts';
import type { EntityKey, OverlayEntry, Status } from '../store/types.ts';

/** One person's houses, split by what they did and when. Counts are houses, like the rest of the progress. */
export type PersonStats = { name: string; completed: number; later: number; blocked: number; today: number; week: number; lastAt: number };
export type FeedItem = { key: EntityKey; status: Status; by: string; at: number };
export type Activity = { people: PersonStats[]; feed: FeedItem[]; todayTotal: number; weekTotal: number };

const DAY = 86_400_000;

/** Start of the local day of `now` (the "today" a person means, not a rolling 24 h). */
export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Who did what, derived from the status overlay: every entry already carries its author and a hybrid-logical-clock stamp whose wall
 * part is the edit time, so no extra server data and no extra storage is needed. The overlay keeps only the *latest* write per place,
 * so this is "current state by author", which is what a team lead wants ("who brought in how many houses"), not an audit log.
 * `alias` maps the random device id that local edits carry to the person's label, so one person is not listed twice.
 * Only houses count toward the numbers; the feed also shows streets.
 */
export function deriveActivity(entries: Iterable<[EntityKey, OverlayEntry]>, now: number, feedSize = 40, alias: ReadonlyMap<string, string> = new Map()): Activity {
  const today = startOfDay(now), week = now - 7 * DAY;
  const people = new Map<string, PersonStats>();
  const feed: FeedItem[] = [];
  let todayTotal = 0, weekTotal = 0;
  for (const [key, entry] of entries) {
    if (entry.status === 'open') continue;
    const at = decodeClock(entry.at)?.wall ?? 0;
    if (!at) continue;
    const by = alias.get(entry.by) ?? entry.by;
    feed.push({ key, status: entry.status, by, at });
    if (!key.startsWith('h:')) continue;
    let p = people.get(by);
    if (!p) { p = { name: by, completed: 0, later: 0, blocked: 0, today: 0, week: 0, lastAt: 0 }; people.set(by, p); }
    if (entry.status === 'completed') {
      p.completed++;
      if (at >= today) { p.today++; todayTotal++; }
      if (at >= week) { p.week++; weekTotal++; }
    } else if (entry.status === 'later') p.later++;
    else p.blocked++;
    if (at > p.lastAt) p.lastAt = at;
  }
  feed.sort((a, b) => b.at - a.at || (a.key < b.key ? -1 : 1));
  return {
    people: [...people.values()].sort((a, b) => b.completed - a.completed || b.lastAt - a.lastAt || (a.name < b.name ? -1 : 1)),
    feed: feed.slice(0, feedSize),
    todayTotal,
    weekTotal,
  };
}
