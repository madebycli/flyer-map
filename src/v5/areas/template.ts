import type { LngLat } from '../engine/types.ts';
import { areaSquareMeters, fromRing, toRing, validate, type Vertices } from './polygon.ts';

/**
 * An Area template: the outline and the marking rules of a district, saved as a small JSON file and reusable in any later
 * Aktion. It carries no progress and no street data: the engine derives streets and houses again from the outline, so applying
 * a template to a changed outline needs no migration (status is keyed by derived ids; what is now outside is pruned).
 */
export const TEMPLATE_FORMAT = 'verteil-flyer-area-template';
export const TEMPLATE_VERSION = 1;
const MAX_BYTES = 64 * 1024;

export type TemplateRules = {
  /** "Nur Straßen mit Häusern": streets without a house are neither shown nor marked. */
  housesOnly: boolean;
};

export type AreaTemplate = {
  format: typeof TEMPLATE_FORMAT;
  version: typeof TEMPLATE_VERSION;
  name: string;
  /** Closed ring, GeoJSON order [lng, lat]. */
  ring: LngLat[];
  rules: TemplateRules;
};

export function makeTemplate(name: string, ring: LngLat[], rules: TemplateRules): AreaTemplate {
  return { format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, name: name.trim().slice(0, 80) || 'Vorlage', ring: toRing(fromRing(ring)), rules: { housesOnly: !!rules.housesOnly } };
}

export const serializeTemplate = (template: AreaTemplate): string => JSON.stringify(template, null, 2);

/** A file name that is safe on every platform: "Gebiet Nord/1" → "gebiet-nord-1.vorlage.json". */
export function templateFileName(name: string): string {
  const slug = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 40);
  return `${slug || 'gebiet'}.vorlage.json`;
}

export type TemplateResult = { ok: true; template: AreaTemplate } | { ok: false; reason: string };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Untrusted input (a file someone sends around): shape, size, coordinate ranges and polygon validity are all checked, and the
 * result is rebuilt field by field so nothing unknown survives into the app.
 */
export function parseTemplate(text: string): TemplateResult {
  if (text.length > MAX_BYTES) return { ok: false, reason: 'Die Datei ist zu groß für eine Vorlage.' };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, reason: 'Das ist keine gültige Vorlagen-Datei.' }; }
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'Das ist keine gültige Vorlagen-Datei.' };
  const t = raw as Record<string, unknown>;
  if (t.format !== TEMPLATE_FORMAT) return { ok: false, reason: 'Das ist keine Vorlage für Gebiete.' };
  if (t.version !== TEMPLATE_VERSION) return { ok: false, reason: 'Diese Vorlage stammt aus einer anderen Version.' };
  if (!Array.isArray(t.ring) || t.ring.length < 4 || t.ring.length > 200) return { ok: false, reason: 'Die Umrandung der Vorlage ist unvollständig.' };
  const ring: LngLat[] = [];
  for (const p of t.ring) {
    if (!Array.isArray(p) || p.length < 2 || !isNum(p[0]) || !isNum(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) return { ok: false, reason: 'Die Umrandung enthält ungültige Koordinaten.' };
    ring.push([p[0], p[1]]);
  }
  const vertices: Vertices = fromRing(ring);
  const check = validate(vertices);
  if (!check.valid) return { ok: false, reason: check.reason };
  if (areaSquareMeters(vertices) <= 0) return { ok: false, reason: 'Die Umrandung hat keine Fläche.' };
  const rules = typeof t.rules === 'object' && t.rules !== null ? (t.rules as Record<string, unknown>) : {};
  const name = typeof t.name === 'string' ? t.name.trim().slice(0, 80) : '';
  return { ok: true, template: makeTemplate(name, toRing(vertices), { housesOnly: rules.housesOnly === true }) };
}
