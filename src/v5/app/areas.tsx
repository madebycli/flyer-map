import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Feature } from 'geojson';
import type { FieldNetwork as Network, LngLat } from '../engine/types.ts';
import type { AreaShape, FieldMap } from '../map/fieldMap.ts';
import { areaSquareMeters, fromRing, insertVertex, midpoints, moveVertex, MAX_VERTICES, removeVertex, seedSquare, toPolygon, toRing, validate, type Vertices } from '../areas/polygon.ts';
import type { AreaTemplate } from '../areas/template.ts';
import { buildPack, createArea, saveAreaGeometry, type Meta } from './api.ts';
import { Icon } from './ui.tsx';

export type AreaEdit = {
  /** null = a new Area that does not exist on the server yet */
  id: string | null;
  vertices: Vertices;
  selected: number | null;
  history: Vertices[];
  teamId: string;
  name: string;
  saving: boolean;
  error: string | null;
};

export type AreaContext = {
  campaignId: string;
  fieldMap: React.MutableRefObject<FieldMap | null>;
  meta: Meta | null;
  network: Network | null;
  reload(): Promise<void>;
  /** Outline colour override (collection Areas are coloured by what is happening in them, not by team). */
  colorFor?: (area: Meta['areas'][number]) => string | undefined;
  /** Runs after a save and the reload that followed it (the app prunes what the new outline left outside). */
  onSaved?: (areaId: string, wasEdit: boolean) => Promise<void> | void;
};

export const sizeLabel = (m2: number) => (m2 >= 1e6 ? `${(m2 / 1e6).toFixed(2).replace('.', ',')} km²` : `${Math.round(m2 / 100) / 100} ha`.replace('.', ','));
const colorOf = (meta: Meta, teamId: string) => meta.teams.find((t) => t.id === teamId)?.color ?? '#7aa8ff';

/** Area outlines, selection, and the vertex editor (drag, insert on edge midpoints, delete, undo, save). */
export function useAreaTool(ctx: AreaContext, active: boolean) {
  const { meta, fieldMap } = ctx;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edit, setEditState] = useState<AreaEdit | null>(null);
  const editRef = useRef<AreaEdit | null>(null);
  const setEdit = useCallback((next: AreaEdit | null | ((current: AreaEdit | null) => AreaEdit | null)) => {
    const value = typeof next === 'function' ? next(editRef.current) : next;
    editRef.current = value; setEditState(value);
  }, []);

  const canEdit = useCallback((teamId: string) => !!meta && (meta.role === 'admin' || (meta.role === 'team-editor' && meta.teamId === teamId)), [meta]);

  const shapes: AreaShape[] = useMemo(() => (meta?.areas ?? [])
    .filter((a) => a.id !== edit?.id)
    .map((a) => ({ id: a.id, name: a.name, color: ctx.colorFor?.(a) ?? colorOf(meta!, a.teamId), ring: a.geometry.coordinates[0] as LngLat[] })), [meta, edit?.id, ctx.colorFor]);
  useEffect(() => { fieldMap.current?.setAreas(shapes, active ? selectedId : null); }, [shapes, selectedId, active, fieldMap]);

  // overlay for the polygon being edited
  useEffect(() => {
    const fm = fieldMap.current;
    if (!fm) return;
    if (!edit || !meta) { fm.setDraw({ type: 'FeatureCollection', features: [] }); return; }
    const color = colorOf(meta, edit.teamId);
    const ring = toRing(edit.vertices);
    const features: Feature[] = [];
    if (edit.vertices.length >= 3) features.push({ type: 'Feature', properties: { kind: 'fill', color }, geometry: { type: 'Polygon', coordinates: [ring] } });
    if (edit.vertices.length >= 2) features.push({ type: 'Feature', properties: { kind: 'line', color }, geometry: { type: 'LineString', coordinates: ring } });
    for (const m of midpoints(edit.vertices)) features.push({ type: 'Feature', properties: { kind: 'mid', edge: m.edge, color }, geometry: { type: 'Point', coordinates: m.point } });
    edit.vertices.forEach((v, index) => features.push({ type: 'Feature', properties: { kind: 'vertex', index, selected: edit.selected === index ? 1 : 0, color }, geometry: { type: 'Point', coordinates: v } }));
    fm.setDraw({ type: 'FeatureCollection', features });
  }, [edit, meta, fieldMap]);

  // dragging handles; anything that is not a handle stays a normal map pan
  useEffect(() => {
    const fm = fieldMap.current;
    if (!fm || !active || !edit) return;
    let drag: number | null = null, snapshot: Vertices | null = null, changed = false;
    fm.setGesture({
      down: (p) => {
        const current = editRef.current;
        const handle = fm.hitHandle(p);
        if (!current || !handle) return false;
        snapshot = current.vertices; changed = false;
        if (handle.kind === 'vertex') { drag = handle.index; setEdit({ ...current, selected: handle.index }); return true; }
        const mid = midpoints(current.vertices).find((m) => m.edge === handle.index);
        const inserted = mid ? insertVertex(current.vertices, handle.index, mid.point) : null;
        if (!inserted) { setEdit({ ...current, error: `Höchstens ${MAX_VERTICES} Eckpunkte` }); return false; }
        drag = inserted.index; changed = true;
        setEdit({ ...current, vertices: inserted.vertices, selected: inserted.index, history: [...current.history, current.vertices].slice(-50), error: null });
        return true;
      },
      move: (_p, lngLat) => {
        const current = editRef.current;
        if (drag === null || !current) return;
        if (!changed && snapshot) { changed = true; setEdit({ ...current, history: [...current.history, snapshot].slice(-50), vertices: moveVertex(current.vertices, drag, lngLat), error: null }); return; }
        setEdit({ ...current, vertices: moveVertex(current.vertices, drag, lngLat), error: null });
      },
      up: () => { drag = null; snapshot = null; },
      cancel: () => { drag = null; snapshot = null; },
    });
    return () => fm.setGesture(null);
  }, [active, edit?.id, !!edit, fieldMap, setEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = (areaId: string) => {
    const area = meta?.areas.find((a) => a.id === areaId);
    if (!area || !canEdit(area.teamId)) return;
    setSelectedId(areaId);
    setEdit({ id: areaId, vertices: fromRing(area.geometry.coordinates[0] as LngLat[]), selected: null, history: [], teamId: area.teamId, name: area.name, saving: false, error: null });
  };

  const startNew = () => {
    const fm = fieldMap.current;
    if (!fm || !meta) return;
    const teamId = meta.role === 'team-editor' && meta.teamId ? meta.teamId : meta.teams[0]?.id;
    if (!teamId) return;
    const c = fm.map.getCenter();
    setSelectedId(null);
    setEdit({ id: null, vertices: seedSquare([c.lng, c.lat], 120), selected: null, history: [], teamId, name: `Gebiet ${(meta.areas.length + 1)}`, saving: false, error: null });
  };

  /** A template's outline goes into the editor (new Area, or replacing the outline of `targetId`): checked and confirmed with ✓ like any edit. */
  const loadTemplate = (template: AreaTemplate, targetId: string | null) => {
    const fm = fieldMap.current;
    if (!fm || !meta) return false;
    const target = targetId ? meta.areas.find((a) => a.id === targetId) : null;
    if (targetId && (!target || !canEdit(target.teamId))) return false;
    const teamId = target?.teamId ?? (meta.role === 'team-editor' && meta.teamId ? meta.teamId : meta.teams[0]?.id);
    if (!teamId) return false;
    const vertices = fromRing(template.ring);
    setSelectedId(targetId);
    setEdit({ id: targetId, vertices, selected: null, history: target ? [fromRing(target.geometry.coordinates[0] as LngLat[])] : [], teamId, name: target?.name ?? template.name, saving: false, error: null });
    const lngs = vertices.map((v) => v[0]), lats = vertices.map((v) => v[1]);
    fm.fitTo([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], 80);
    return true;
  };

  const cancelEdit = () => setEdit(null);
  const undo = () => setEdit((c) => (c && c.history.length ? { ...c, vertices: c.history[c.history.length - 1], history: c.history.slice(0, -1), selected: null, error: null } : c));
  const deleteSelected = () => setEdit((c) => {
    if (!c || c.selected === null) return c;
    const next = removeVertex(c.vertices, c.selected);
    return next ? { ...c, vertices: next, selected: null, history: [...c.history, c.vertices].slice(-50), error: null } : { ...c, error: 'Mindestens 3 Eckpunkte' };
  });
  const setName = (name: string) => setEdit((c) => (c ? { ...c, name: name.slice(0, 80) } : c));
  const setTeam = (teamId: string) => setEdit((c) => (c ? { ...c, teamId } : c));

  const validity = edit ? validate(edit.vertices) : null;
  const save = async () => {
    const current = editRef.current;
    if (!current || !meta || current.saving) return;
    const check = validate(current.vertices);
    if (!check.valid) { setEdit({ ...current, error: check.reason }); return; }
    setEdit({ ...current, saving: true, error: null });
    try {
      const geometry = toPolygon(current.vertices);
      let id = current.id;
      if (id) await saveAreaGeometry(ctx.campaignId, { id, updatedAt: meta.areas.find((a) => a.id === id)!.updatedAt }, geometry);
      else { id = `area_${crypto.randomUUID()}`; await createArea(ctx.campaignId, { id, teamId: current.teamId, name: current.name.trim() || 'Gebiet', geometry }); }
      // the data pack covers the old outline: fetch fresh map data for the new one (a cooldown refusal just leaves it for the "Laden" chip)
      if (meta.canBuildPack) { try { await buildPack(ctx.campaignId, id); } catch { /* offered again after reload */ } }
      setEdit(null); setSelectedId(id);
      await ctx.reload();
      try { await ctx.onSaved?.(id, !!current.id); } catch { /* the clean-up is offered again from the Area sheet */ }
    } catch (error) {
      setEdit({ ...current, saving: false, error: error instanceof Error ? error.message : 'Speichern fehlgeschlagen' });
    }
  };

  const onMapTap = useCallback((point: { x: number; y: number }): boolean => {
    if (!active || editRef.current) return false;
    setSelectedId(fieldMap.current?.hitArea(point) ?? null);
    return true;
  }, [active, fieldMap]);

  return { selectedId, setSelectedId, edit, canEdit, startEdit, startNew, loadTemplate, cancelEdit, undo, deleteSelected, setName, setTeam, save, validity, onMapTap };
}

export type AreaTool = ReturnType<typeof useAreaTool>;

export function AreaEditBar({ tool, meta }: { tool: AreaTool; meta: Meta }) {
  const edit = tool.edit!;
  const valid = tool.validity?.valid ?? false;
  const choosesTeam = edit.id === null && meta.role === 'admin' && meta.teams.length > 1;
  return (
    <section className="v5-markbar" aria-label="Gebiet bearbeiten">
      {(edit.error || (!valid && tool.validity && !tool.validity.valid)) && (
        <div className="v5-markinfo"><span className="warn"><Icon name="warning" size={18} />{edit.error ?? (tool.validity && !tool.validity.valid ? tool.validity.reason : '')}</span></div>
      )}
      {edit.id === null && (
        <div className="v5-barrow">
          <input className="v5-input" value={edit.name} onChange={(e) => tool.setName(e.target.value)} aria-label="Name des Gebiets" placeholder="Name" maxLength={80} />
          {choosesTeam && (
            <div className="v5-teams" role="group" aria-label="Team">
              {meta.teams.map((t) => <button key={t.id} className={`v5-team${edit.teamId === t.id ? ' on' : ''}`} style={{ '--c': t.color } as React.CSSProperties} aria-pressed={edit.teamId === t.id} aria-label={t.name} title={t.name} onClick={() => tool.setTeam(t.id)} />)}
            </div>
          )}
        </div>
      )}
      <div className="v5-barrow">
        <div className="v5-modes" role="group" aria-label="Eckpunkte">
          <button className="v5-mode" onClick={tool.undo} disabled={!edit.history.length} aria-label="Rückgängig" title="Rückgängig"><Icon name="undo" size={24} /></button>
          <button className="v5-mode" onClick={tool.deleteSelected} disabled={edit.selected === null || edit.vertices.length <= 3} aria-label="Eckpunkt löschen" title="Eckpunkt löschen"><Icon name="trash" size={24} /></button>
          <span className="v5-counter" title="Eckpunkte"><Icon name="polygon" size={18} />{edit.vertices.length}/{MAX_VERTICES}</span>
          <span className="v5-counter" title="Fläche">{sizeLabel(areaSquareMeters(edit.vertices))}</span>
        </div>
        <button className="v5-icon-btn tonal" onClick={tool.cancelEdit} aria-label="Abbrechen" title="Abbrechen"><Icon name="close" /></button>
        <button className="v5-go" onClick={() => void tool.save()} disabled={!valid || edit.saving} aria-label="Gebiet speichern" title="Gebiet speichern"><Icon name={edit.saving ? 'sync' : 'check'} size={26} /></button>
      </div>
    </section>
  );
}
