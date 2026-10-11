import { applyPalette } from './palette.ts';

export type Theme = 'dark' | 'light';
const KEY = 'vf-v5-theme';

/** The theme chosen on this device (shared with the field shell); dark until someone picks light. */
export function readTheme(): Theme {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

export function applyTheme(theme: Theme = readTheme()) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f1514' : '#f5faf8');
  // the colours chosen on this device (Material You from a seed colour) replace the static ones of the stylesheet
  applyPalette(undefined, theme);
}
