import { fold } from '../engine/search.ts';
import type { LngLat } from '../engine/types.ts';
import { areaSquareMeters, fromRing, toRing, validate, type Vertices } from './polygon.ts';

/**
 * An Aktion template: the whole map of an action — every Gebiet outline together with its Gruppen/Teams (name and colour) and
 * the marking rules — as one small JSON file, reusable for the next campaign. It carries no progress, no street data and no
 * people (no members, no links): the engine derives streets and houses again from the outlines, so a template never needs a
 * migration, and applying it to a changed map removes only what is no longer there.
 */
export const TEMPLATE_FORMAT = 'verteil-flyer-action-template';
export const TEMPLATE_VERSION = 1;
const MAX_BYTES = 512 * 1024;
const MAX_TEAMS = 40;
const MAX_AREAS = 300;
const COLOR = /^#[0-9a-fA-F]{6}$/u;

export type TemplateRules = {
  /** "Nur Straßen mit Häusern": streets without a house are neither shown nor marked. */
  housesOnly: boolean;
};
export type TemplateTeam = { name: string; color: string };
/** `team` is the name of one of the template's teams. `ring` is a closed ring in GeoJSON order [lng, lat]. */
export type TemplateArea = { name: string; team: string; ring: LngLat[] };
export type ActionTemplate = { format: typeof TEMPLATE_FORMAT; version: typeof TEMPLATE_VERSION; name: string; teams: TemplateTeam[]; areas: TemplateArea[]; rules: TemplateRules };

const clean = (text: string, fallback: string) => text.trim().slice(0, 80) || fallback;

export function makeTemplate(name: string, teams: TemplateTeam[], areas: TemplateArea[], rules: TemplateRules): ActionTemplate {
  return {
    format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, name: clean(name, 'Vorlage'),
    teams: teams.map((t) => ({ name: clean(t.name, 'Gruppe'), color: t.color })),
    areas: areas.map((a) => ({ name: clean(a.name, 'Gebiet'), team: clean(a.team, 'Gruppe'), ring: toRing(fromRing(a.ring)) })),
    rules: { housesOnly: !!rules.housesOnly },
  };
}

export const serializeTemplate = (template: ActionTemplate): string => JSON.stringify(template, null, 2);

/** A file name that is safe on every platform: "Frühjahr 2027/Nord" → "fruhjahr-2027-nord.aktion.json". */
export function templateFileName(name: string): string {
  const slug = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 40);
  return `${slug || 'aktion'}.aktion.json`;
}

export type TemplateResult = { ok: true; template: ActionTemplate } | { ok: false; reason: string };
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const bad = (reason: string): TemplateResult => ({ ok: false, reason });

/**
 * Untrusted input (a file someone sends around): shape, size, counts, names, colours, coordinate ranges and polygon validity are
 * all checked, and the result is rebuilt field by field so nothing unknown survives into the app.
 */
export function parseTemplate(text: string): TemplateResult {
  if (text.length > MAX_BYTES) return bad('Die Datei ist zu groß für eine Vorlage.');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return bad('Das ist keine gültige Vorlagen-Datei.'); }
  if (!raw || typeof raw !== 'object') return bad('Das ist keine gültige Vorlagen-Datei.');
  const t = raw as Record<string, unknown>;
  if (t.format !== TEMPLATE_FORMAT) return bad('Das ist keine Vorlage für eine Aktion.');
  if (t.version !== TEMPLATE_VERSION) return bad('Diese Vorlage stammt aus einer anderen Version.');
  if (!Array.isArray(t.teams) || t.teams.length < 1 || t.teams.length > MAX_TEAMS) return bad('Die Vorlage braucht mindestens eine Gruppe.');
  if (!Array.isArray(t.areas) || t.areas.length < 1 || t.areas.length > MAX_AREAS) return bad(`Die Vorlage braucht 1 bis ${MAX_AREAS} Gebiete.`);
  const teams: TemplateTeam[] = [];
  const teamNames = new Set<string>();
  for (const entry of t.teams) {
    const team = entry as Record<string, unknown> | null;
    if (!team || typeof team.name !== 'string' || !team.name.trim() || typeof team.color !== 'string' || !COLOR.test(team.color)) return bad('Eine Gruppe der Vorlage ist unvollständig.');
    const name = clean(team.name, 'Gruppe');
    if (teamNames.has(fold(name))) return bad(`Die Gruppe „${name}“ kommt doppelt vor.`);
    teamNames.add(fold(name));
    teams.push({ name, color: team.color.toLowerCase() });
  }
  const areas: TemplateArea[] = [];
  const areaNames = new Set<string>();
  for (const entry of t.areas) {
    const area = entry as Record<string, unknown> | null;
    if (!area || typeof area.name !== 'string' || !area.name.trim() || typeof area.team !== 'string' || !Array.isArray(area.ring)) return bad('Ein Gebiet der Vorlage ist unvollständig.');
    const name = clean(area.name, 'Gebiet'), team = clean(area.team, 'Gruppe');
    if (areaNames.has(fold(name))) return bad(`Das Gebiet „${name}“ kommt doppelt vor.`);
    areaNames.add(fold(name));
    if (!teamNames.has(fold(team))) return bad(`Das Gebiet „${name}“ gehört zu einer unbekannten Gruppe.`);
    if (area.ring.length < 4 || area.ring.length > 200) return bad(`Die Umrandung von „${name}“ ist unvollständig.`);
    const ring: LngLat[] = [];
    for (const p of area.ring) {
      if (!Array.isArray(p) || p.length < 2 || !isNum(p[0]) || !isNum(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) return bad(`Die Umrandung von „${name}“ enthält ungültige Koordinaten.`);
      ring.push([p[0], p[1]]);
    }
    const vertices: Vertices = fromRing(ring);
    const check = validate(vertices);
    if (!check.valid) return bad(`„${name}“: ${check.reason}`);
    if (areaSquareMeters(vertices) <= 0) return bad(`Die Umrandung von „${name}“ hat keine Fläche.`);
    areas.push({ name, team, ring: toRing(vertices) });
  }
  const rules = typeof t.rules === 'object' && t.rules !== null ? (t.rules as Record<string, unknown>) : {};
  return { ok: true, template: makeTemplate(typeof t.name === 'string' ? t.name : '', teams, areas, { housesOnly: rules.housesOnly === true }) };
}

export type PlanCurrent = { teams: { id: string; name: string }[]; areas: { id: string; name: string; teamId: string; ring: LngLat[] }[] };
export type PlanActor = { role: 'admin' | 'team-editor'; teamId: string | null };
export type TemplatePlan = {
  createTeams: TemplateTeam[];
  createAreas: TemplateArea[];
  /** Existing Gebiete (matched by name) whose outline differs: they keep their Gruppe and their progress where it still lies inside. */
  reshapeAreas: { id: string; name: string; ring: LngLat[] }[];
  unchanged: string[];
  /** Existing Gebiete that are not in the template: never deleted. */
  keep: string[];
  skipped: { name: string; reason: string }[];
};

const sameRing = (a: LngLat[], b: LngLat[]) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);

/**
 * What applying a template to the current Aktion would do, computed without touching anything. Names decide what is "the same"
 * Gebiet or Gruppe. Nothing is ever deleted or moved to another Gruppe; a Gruppen-Editor can only touch their own Gruppe, and only
 * an admin creates Gruppen.
 */
export function planTemplate(template: ActionTemplate, current: PlanCurrent, actor: PlanActor): TemplatePlan {
  const plan: TemplatePlan = { createTeams: [], createAreas: [], reshapeAreas: [], unchanged: [], keep: [], skipped: [] };
  const teamByName = new Map(current.teams.map((t) => [fold(t.name), t]));
  const ownTeam = actor.teamId ? current.teams.find((t) => t.id === actor.teamId) : undefined;
  const areaByName = new Map(current.areas.map((a) => [fold(a.name), a]));
  const used = new Set<string>();
  const wantedTeams = new Set<string>();
  for (const area of template.areas) {
    const existing = areaByName.get(fold(area.name));
    const templateTeam = fold(area.team);
    if (actor.role === 'team-editor') {
      const mine = ownTeam && (existing ? existing.teamId === ownTeam.id : fold(ownTeam.name) === templateTeam);
      if (!mine) { plan.skipped.push({ name: area.name, reason: 'Gehört nicht zu deiner Gruppe' }); if (existing) used.add(existing.id); continue; }
    }
    if (existing) {
      used.add(existing.id);
      if (sameRing(toRing(fromRing(existing.ring)), area.ring)) plan.unchanged.push(area.name); else plan.reshapeAreas.push({ id: existing.id, name: existing.name, ring: area.ring });
    } else {
      plan.createAreas.push(area);
      if (!teamByName.has(templateTeam)) wantedTeams.add(templateTeam);
    }
  }
  for (const team of template.teams) if (wantedTeams.has(fold(team.name))) plan.createTeams.push(team);
  for (const area of current.areas) if (!used.has(area.id)) plan.keep.push(area.name);
  return plan;
}

export const planIsEmpty = (plan: TemplatePlan) => !plan.createAreas.length && !plan.reshapeAreas.length && !plan.createTeams.length;
