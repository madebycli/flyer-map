import type { V5Options } from './api.ts';

/** Deployment settings of the field core. Everything third-party (basemap style, Overpass endpoint) is configurable here, never in the client. */
export type V5Env = { OSM_OVERPASS_URL?: string; V5_BASEMAP_DARK?: string; V5_BASEMAP_LIGHT?: string };

const DEFAULT_BASEMAP = { dark: 'https://tiles.openfreemap.org/styles/dark', light: 'https://tiles.openfreemap.org/styles/bright' };

/** A style URL must be https (or a same-origin path); anything else is ignored rather than handed to every client. */
export function safeStyleUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try { return new URL(trimmed).protocol === 'https:' ? trimmed : undefined; } catch { return undefined; }
}

/** `V5_BASEMAP_DARK` / `V5_BASEMAP_LIGHT` set a style; the literal value `off` serves no basemap at all (plain background). */
export function v5OptionsFromEnv(env: V5Env): V5Options {
  const pick = (value: string | undefined, fallback: string) => (value?.trim().toLowerCase() === 'off' ? undefined : safeStyleUrl(value) ?? fallback);
  const dark = pick(env.V5_BASEMAP_DARK, DEFAULT_BASEMAP.dark), light = pick(env.V5_BASEMAP_LIGHT, DEFAULT_BASEMAP.light);
  const overpass = env.OSM_OVERPASS_URL && env.OSM_OVERPASS_URL !== 'default' ? safeStyleUrl(env.OSM_OVERPASS_URL) : undefined;
  return { basemap: { dark, light }, ...(overpass ? { overpassUrl: overpass } : {}) };
}
