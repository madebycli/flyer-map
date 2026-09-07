/** Returns the same opaque hex color mixed by `amount` towards black. */
export function darkenHexColor(color: string, amount: number): string {
  const normalized = color.trim();
  const match = /^#([0-9a-f]{6})$/iu.exec(normalized);
  if (!match) return color;

  const factor = 1 - Math.min(1, Math.max(0, amount));
  const value = Number.parseInt(match[1], 16);
  const channels = [
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ];
  return `#${channels
    .map((channel) => Math.round(channel * factor).toString(16).padStart(2, "0"))
    .join("")}`;
}
