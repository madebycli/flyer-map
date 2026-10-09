import type { Index } from './mark.ts';

export type SearchEntry = {
  kind: 'street' | 'house';
  /** Segment id (street) or house id. */
  id: string;
  label: string;
  /** Houses along the street, or the street of a house number. */
  detail: string;
  norm: string;
};

/** Case, umlauts and the many spellings of "Straße" must not matter while typing on a phone in the rain. */
export function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/gu, 'ss').replace(/\bstr\b\.?/gu, 'strasse').replace(/str\.(?=\s|$)/gu, 'strasse').replace(/strasse\b/gu, 'strasse').replace(/\s+/gu, ' ').trim();
}

/** Streets (one entry per name, pointing at the piece with the most houses) and house numbers. */
export function buildSearchIndex(index: Index): SearchEntry[] {
  const streets = new Map<string, { id: string; name: string; houses: number; best: number }>();
  for (const segment of index.segments.values()) {
    if (!segment.visible || !segment.name) continue;
    const houses = index.groupHouses.get(segment.group) ?? 0;
    const entry = streets.get(segment.name);
    if (!entry) streets.set(segment.name, { id: segment.id, name: segment.name, houses, best: houses });
    else if (entry.houses < houses && segment.chunk === 0) { entry.houses = houses; entry.id = segment.id; }
  }
  // house totals per street name: sum each group once
  const seen = new Set<string>();
  const totals = new Map<string, number>();
  for (const segment of index.segments.values()) {
    if (!segment.name || seen.has(segment.group)) continue;
    seen.add(segment.group);
    totals.set(segment.name, (totals.get(segment.name) ?? 0) + (index.groupHouses.get(segment.group) ?? 0));
  }
  const entries: SearchEntry[] = [];
  for (const s of streets.values()) entries.push({ kind: 'street', id: s.id, label: s.name, detail: `${totals.get(s.name) ?? 0} Häuser`, norm: fold(s.name) });
  for (const house of index.houses.values()) {
    if (!house.street || !house.number) continue;
    const label = `${house.street} ${house.number}`;
    entries.push({ kind: 'house', id: house.id, label, detail: 'Haus', norm: fold(label) });
  }
  return entries;
}

/** Every word of the query must occur; prefix matches and streets come first, ties alphabetical. */
export function searchEntries(entries: readonly SearchEntry[], query: string, limit = 30): SearchEntry[] {
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
  scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label, 'de', { numeric: true }));
  return scored.slice(0, limit).map(([, entry]) => entry);
}
