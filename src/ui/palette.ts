/**
 * Material You colours from one seed colour: tonal palettes (primary, secondary, tertiary, neutral, neutral variant, error) and the Material 3
 * roles for light and dark, written to the CSS tokens of `tokens.css`. The web cannot read the phone's wallpaper the way Android does, so the seed
 * is a choice on this device (`SEEDS`, or any colour).
 *
 * Tones follow Material's idea: a tone is a CIE lightness (L*), so two tones 40 apart (primary 40 on 100, primary 80 on 20 …) keep their contrast
 * whatever the hue. The colour for a tone is found in OKLCH: the hue and chroma of the palette, the lightness searched until the relative luminance
 * matches the tone, the chroma pulled back until the colour fits into sRGB. No dependency, a few kilobytes.
 */
export type Mode = 'dark' | 'light';
export type Seed = { id: string; name: string; hex: string };

/** The colours offered in the menu; the first one is what the app looked like before and stays the default. */
export const SEEDS: Seed[] = [
  { id: 'smaragd', name: 'Smaragd', hex: '#1f8a70' },
  { id: 'blau', name: 'Blau', hex: '#2f6bd8' },
  { id: 'violett', name: 'Violett', hex: '#7a4fd3' },
  { id: 'rosa', name: 'Rosa', hex: '#c8498a' },
  { id: 'rot', name: 'Rot', hex: '#d2453b' },
  { id: 'orange', name: 'Orange', hex: '#d9791f' },
  { id: 'gold', name: 'Gold', hex: '#a98a1f' },
  { id: 'gruen', name: 'Grün', hex: '#4a9a3a' },
];
export const DEFAULT_SEED = SEEDS[0].hex;

// ── colour maths (sRGB, OKLab) ───────────────────────────────────
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

type Rgb = [number, number, number];
function oklchToLinear(L: number, C: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
const inGamut = (rgb: Rgb) => rgb.every((c) => c >= -0.0005 && c <= 1.0005);
const luminance = (rgb: Rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
/** Relative luminance Y (0..1) of CIE lightness L* (the tone). */
const toneToY = (tone: number) => (tone > 8 ? ((tone + 16) / 116) ** 3 : tone / 903.2963);

/** The largest chroma ≤ `chroma` that is inside sRGB at this lightness and hue. */
function fitChroma(L: number, chroma: number, hue: number): number {
  if (inGamut(oklchToLinear(L, chroma, hue))) return chroma;
  let lo = 0, hi = chroma;
  for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (inGamut(oklchToLinear(L, mid, hue))) lo = mid; else hi = mid; }
  return lo;
}

function hex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, c))))) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** The colour of a palette (hue, chroma) at a tone 0..100. */
export function toneColor(hue: number, chroma: number, tone: number): string {
  if (tone <= 0) return '#000000';
  if (tone >= 100) return '#ffffff';
  const target = toneToY(tone);
  let lo = 0, hi = 1;
  let best: Rgb = [0, 0, 0];
  for (let i = 0; i < 26; i++) {
    const L = (lo + hi) / 2;
    best = oklchToLinear(L, fitChroma(L, chroma, hue), hue);
    if (luminance(best) < target) lo = L; else hi = L;
  }
  return hex(best);
}

export function parseHex(value: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
}

/** Hue (degrees) and chroma of a colour in OKLCH. */
function oklch(rgb: Rgb): { h: number; c: number } {
  const [r, g, b] = rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360, c: Math.hypot(a, bb) };
}

// ── the roles ────────────────────────────────────────────────────
export type Scheme = Record<string, string>;

/** Material 3 roles for one seed and mode, named as the CSS tokens of `tokens.css` (without the leading `--`). */
export function schemeFor(seedHex: string, mode: Mode): Scheme {
  const rgb = parseHex(seedHex) ?? (parseHex(DEFAULT_SEED) as Rgb);
  const { h, c } = oklch(rgb);
  const primary = (t: number) => toneColor(h, Math.min(0.2, Math.max(0.11, c)), t);
  const secondary = (t: number) => toneColor(h, 0.04, t);
  const tertiary = (t: number) => toneColor((h + 60) % 360, 0.075, t);
  const neutral = (t: number) => toneColor(h, 0.008, t);
  const variant = (t: number) => toneColor(h, 0.016, t);
  const error = (t: number) => toneColor(29, 0.2, t);
  const dark = mode === 'dark';
  const surface = neutral(dark ? 6 : 98);
  const glass = (() => { const v = parseHex(neutral(dark ? 12 : 94)) as Rgb; const q = (x: number) => Math.round(fromLinear(x) * 255); return `rgb(${q(v[0])} ${q(v[1])} ${q(v[2])} / ${dark ? 94 : 95}%)`; })();
  return dark ? {
    surface, 'surface-1': neutral(10), 'surface-2': neutral(12), 'surface-3': neutral(17), 'surface-4': neutral(22), glass,
    on: neutral(90), 'on-var': variant(80), outline: variant(60), 'outline-var': variant(30),
    primary: primary(80), 'on-primary': primary(20), 'primary-container': primary(30), 'on-primary-container': primary(90),
    secondary: secondary(80), 'on-secondary': secondary(20), 'secondary-container': secondary(30), 'on-secondary-container': secondary(90),
    tertiary: tertiary(80), 'on-tertiary': tertiary(20), 'tertiary-container': tertiary(30), 'on-tertiary-container': tertiary(90),
    error: error(80), 'on-error': error(20), 'error-container': error(30), 'on-error-container': error(90),
    inverse: neutral(90), 'on-inverse': neutral(20),
  } : {
    surface, 'surface-1': neutral(96), 'surface-2': neutral(94), 'surface-3': neutral(92), 'surface-4': neutral(90), glass,
    on: neutral(10), 'on-var': variant(30), outline: variant(50), 'outline-var': variant(80),
    primary: primary(40), 'on-primary': '#ffffff', 'primary-container': primary(90), 'on-primary-container': primary(10),
    secondary: secondary(40), 'on-secondary': '#ffffff', 'secondary-container': secondary(90), 'on-secondary-container': secondary(10),
    tertiary: tertiary(40), 'on-tertiary': '#ffffff', 'tertiary-container': tertiary(90), 'on-tertiary-container': tertiary(10),
    error: error(40), 'on-error': '#ffffff', 'error-container': error(90), 'on-error-container': error(10),
    inverse: neutral(20), 'on-inverse': neutral(95),
  };
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const ya = luminance(parseHex(a) as Rgb), yb = luminance(parseHex(b) as Rgb);
  return (Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05);
}

// ── on this device ───────────────────────────────────────────────
const KEY = 'vf-v5-seed';
export function readSeed(): string {
  try { const v = localStorage.getItem(KEY); return v && parseHex(v) ? v : DEFAULT_SEED; } catch { return DEFAULT_SEED; }
}
export function saveSeed(hexValue: string) {
  try { if (hexValue.toLowerCase() === DEFAULT_SEED) localStorage.removeItem(KEY); else localStorage.setItem(KEY, hexValue); } catch { /* private mode */ }
}

/** Write the roles of the seed for this mode into the page's tokens (inline on `<html>`, so they win over the stylesheet's static fallback). */
export function applyPalette(seedHex: string = readSeed(), mode: Mode = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark') {
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(schemeFor(seedHex, mode))) style.setProperty(`--${name}`, value);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', schemeFor(seedHex, mode).surface);
}
