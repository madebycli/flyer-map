import type { FieldNetwork } from './types.ts';

/**
 * Street and address search, TypeScript reference of the Rust engine (`engine-rs/src/query.rs`): same folding, same ranking, same
 * tie-breaks, compared differentially in the tests. The app asks the engine (Rust); this runs when WebAssembly is not available.
 */
export type SearchEntry = {
  kind: 'street' | 'house';
  /** Segment id (street) or house id. */
  id: string;
  label: string;
  /** Houses along the street, or "Haus". */
  detail: string;
  norm: string;
};
export type SearchHit = Pick<SearchEntry, 'kind' | 'id' | 'label' | 'detail'>;

/** Case, umlauts and the many spellings of "Straße" must not matter while typing on a phone in the rain. */
export function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/gu, 'ss').replace(/\bstr\b\.?/gu, 'strasse').replace(/str\.(?=\s|$)/gu, 'strasse').replace(/strasse\b/gu, 'strasse').replace(/\s+/gu, ' ').trim();
}

/** Digit runs compare by value, everything else by code point (not UTF-16 unit): the same total order as the Rust side. */
export function naturalCompare(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  let i = 0, j = 0;
  const digit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
  while (i < x.length || j < y.length) {
    if (i >= x.length) return -1;
    if (j >= y.length) return 1;
    if (digit(x[i]) && digit(y[j])) {
      let dx = '', dy = '';
      while (digit(x[i])) dx += x[i++];
      while (digit(y[j])) dy += y[j++];
      const tx = dx.replace(/^0+/u, ''), ty = dy.replace(/^0+/u, '');
      if (tx.length !== ty.length) return tx.length < ty.length ? -1 : 1;
      if (tx !== ty) return tx < ty ? -1 : 1;
      if (dx.length !== dy.length) return dx.length < dy.length ? -1 : 1;
      continue;
    }
    if (x[i] !== y[j]) return x[i].codePointAt(0)! < y[j].codePointAt(0)! ? -1 : 1;
    i++; j++;
  }
  return 0;
}

const compareText = (a: string, b: string) => (a === b ? 0 : naturalCompare(a, b));

/** One entry per street name (pointing at its junction-to-junction street with the most houses, earliest on a tie) and one per house number. */
export function buildSearchIndex(network: Pick<FieldNetwork, 'segments' | 'houses'>): SearchEntry[] {
  const groupHouses = new Map<string, number>();
  for (const s of network.segments) groupHouses.set(s.group, (groupHouses.get(s.group) ?? 0) + s.houseCount);
  const streets = new Map<string, { id: string; houses: number; total: number; seen: Set<string> }>();
  for (const s of network.segments) {
    if (!s.visible || !s.name) continue;
    const houses = groupHouses.get(s.group) ?? 0;
    let street = streets.get(s.name);
    if (!street) { street = { id: s.id, houses: 0, total: 0, seen: new Set() }; streets.set(s.name, street); }
    if (street.seen.has(s.group)) continue;
    street.seen.add(s.group);
    street.total += houses;
    if (street.seen.size === 1 || houses > street.houses) { street.houses = houses; street.id = s.id; }
  }
  const entries: SearchEntry[] = [];
  for (const [name, s] of streets) entries.push({ kind: 'street', id: s.id, label: name, detail: `${s.total} Häuser`, norm: fold(name) });
  for (const h of network.houses) {
    if (!h.street || !h.number) continue;
    const label = `${h.street} ${h.number}`;
    entries.push({ kind: 'house', id: h.id, label, detail: 'Haus', norm: fold(label) });
  }
  return entries;
}

/** Every word of the query must occur; prefix matches and streets first, then the natural order of the folded text. */
export function searchEntries(entries: readonly SearchEntry[], query: string, limit = 30): SearchHit[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const scored: [number, SearchEntry][] = [];
  for (const entry of entries) {
    let score = 0;
    for (const word of words) {
      const at = entry.norm.indexOf(word);
      if (at < 0) { score = -1; break; }
      score += at === 0 ? 0 : entry.norm[at - 1] === ' ' ? 1 : 3;
    }
    if (score >= 0) scored.push([score * 2 + (entry.kind === 'street' ? 0 : 1), entry]);
  }
  scored.sort((a, b) => a[0] - b[0] || compareText(a[1].norm, b[1].norm) || compareText(a[1].label, b[1].label) || (a[1].id < b[1].id ? -1 : a[1].id > b[1].id ? 1 : 0));
  return scored.slice(0, limit).map(([, e]) => ({ kind: e.kind, id: e.id, label: e.label, detail: e.detail }));
}
