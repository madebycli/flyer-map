import { toneColor } from '../../ui/palette.ts';

/**
 * Colours for Gruppen. The map draws a Gebiet in its Gruppe's colour, so with fifteen or twenty Gruppen they have to stay apart from each other:
 * eight calm base colours, then twelve hues in two lightness bands (equal perceived lightness within a band, so none shouts), 32 in all. Anyone
 * can still pick a colour of their own.
 */
const BASE = ['#4f8cff', '#e5736b', '#e0a83a', '#8b7be8', '#38b8a6', '#d46fb0', '#7dbb4a', '#8a97a6'];
const RING = Array.from({ length: 12 }, (_, i) => i * 30 + 15);
export const GROUP_COLORS: string[] = [
  ...BASE,
  ...RING.map((hue) => toneColor(hue, 0.13, 66)),
  ...RING.map((hue) => toneColor((hue + 15) % 360, 0.12, 46)),
];

/** The first colour of the list nobody uses yet; past the list, a hue stepped by the golden angle. */
export function nextFreeColor(used: string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()));
  const free = GROUP_COLORS.find((c) => !taken.has(c.toLowerCase()));
  if (free) return free;
  for (let i = 0; i < 360; i++) {
    const candidate = toneColor((used.length * 137.5 + i * 7) % 360, 0.13, 56);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return '#8a97a6';
}
