import type { Meta } from './api.ts';
import type { AreaView } from './collection.ts';
import { SheetFrame } from './sheet.tsx';
import { Icon } from '../../ui/index.ts';

type Props = {
  meta: Meta;
  views: Map<string, AreaView>;
  busy: boolean;
  error: string | null;
  onDraw(): void;
  onEditMain(): void;
  onEdit(areaId: string): void;
  onArchive(areaId: string): void;
  onFree(areaId: string, runId: string): void;
  onClose(): void;
};

const STATE: Record<AreaView['phase'], string> = { open: 'Offen', working: 'Wird bearbeitet', done: 'Erledigt' };

/**
 * Admin: set up an Abholaktion. First the Sammelgebiet (the whole stretch), then Teilgebiete inside it (what a helper takes).
 * A Teilgebiet a helper holds can be freed by an admin (lost phone, someone left); archived ones disappear for helpers.
 */
export function CollectionSetupSheet({ meta, views, busy, error, onDraw, onEditMain, onEdit, onArchive, onFree, onClose }: Props) {
  const main = meta.mainArea;
  const areas = meta.areas.filter((a) => a.collection?.status !== 'archived');
  const archived = meta.areas.length - areas.length;
  return (
    <SheetFrame icon="polygon" title="Abholen einrichten" onClose={onClose} meta={<span><Icon name="paw" size={16} />{areas.length} Teilgebiete</span>}>
      {error && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />{error}</p>}
      <h3>Sammelgebiet</h3>
      {main ? (
        <div className="v5-conflict-row">
          <span className="v5-conflict-title">{main.name}</span>
          <button className="v5-icon-btn" onClick={onEditMain} disabled={busy} aria-label="Sammelgebiet bearbeiten" title="Umriss bearbeiten"><Icon name="pen" /></button>
        </div>
      ) : <p className="v5-hint"><Icon name="info" size={20} />Noch kein Sammelgebiet. Es umfasst alles, was abgeholt werden soll; die Teilgebiete liegen darin.</p>}
      <div className="v5-row">
        <button className="v5-btn primary" style={{ marginTop: 0 }} onClick={onDraw} disabled={busy}><Icon name="plus" size={20} />{main ? 'Teilgebiet zeichnen' : 'Sammelgebiet zeichnen'}</button>
      </div>
      {areas.length > 0 && (
        <>
          <h3>Teilgebiete</h3>
          <div className="v5-list">
            {areas.map((area) => {
              const view = views.get(area.id);
              const holder = area.collection?.claimedBy;
              return (
                <div key={area.id} className="v5-conflict-row">
                  <span className="v5-conflict-title">
                    <span className="v5-dotc" style={{ background: area.collection?.color ?? '#2563eb' }} />{area.name}
                    <small className="v5-muted"> · {view ? STATE[view.phase] : ''}{holder ? ` · ${holder}` : ''}</small>
                  </span>
                  {view?.phase === 'working' && view.runId && <button className="v5-icon-btn" onClick={() => onFree(area.id, view.runId!)} disabled={busy} aria-label={`${area.name} freigeben`} title="Freigeben (Helfer entfernen)"><Icon name="unlock" /></button>}
                  <button className="v5-icon-btn" onClick={() => onEdit(area.id)} disabled={busy} aria-label={`${area.name} bearbeiten`} title="Umriss, Name und Farbe"><Icon name="pen" /></button>
                  <button className="v5-icon-btn" onClick={() => onArchive(area.id)} disabled={busy || view?.phase === 'working'} aria-label={`${area.name} archivieren`} title={view?.phase === 'working' ? 'Erst freigeben' : 'Archivieren'}><Icon name="trash" /></button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {archived > 0 && <p className="v5-hint v5-foot">{archived} archiviert</p>}
    </SheetFrame>
  );
}
