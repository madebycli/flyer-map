import type { CSSProperties } from 'react';
import type { Feature, FeatureCollection } from 'geojson';
import { PICKUP_COLOR, PICKUP_LABEL, PICKUP_STATUSES, validateDraft, type Pickup, type PickupStatus } from './pickups.ts';
import { Icon, type IconName } from './ui.tsx';

const ICON: Record<PickupStatus, IconName> = { open: 'open', collected: 'check', 'needs-follow-up': 'repeat', unavailable: 'blocked' };

export function pickupFeatures(pickups: Pickup[]): FeatureCollection {
  return { type: 'FeatureCollection', features: pickups.map((p): Feature => ({ type: 'Feature', properties: { id: p.id, color: PICKUP_COLOR[p.status] }, geometry: { type: 'Point', coordinates: p.position } })) };
}

/** Status of one Sonder-Marker. Kept apart from street progress: nothing here changes a percentage. */
export function PickupBody({ pickup, canEdit, busy, error, onStatus }: { pickup: Pickup; canEdit: boolean; busy: boolean; error: string | null; onStatus: (status: PickupStatus) => void }) {
  return (
    <>
      <p className="v5-pickup-address"><Icon name="mapPin" size={18} />{pickup.address}</p>
      {pickup.description && <p className="v5-pickup-desc">{pickup.description}</p>}
      {canEdit
        ? (
          <div className="v5-seg" role="group" aria-label="Status des Sonder-Markers">
            {PICKUP_STATUSES.map((status) => (
              <button key={status} className={`v5-status v5-seg-btn${pickup.status === status ? ' on' : ''}`} style={{ '--c': PICKUP_COLOR[status] } as CSSProperties}
                disabled={busy} onClick={() => onStatus(status)} aria-pressed={pickup.status === status} aria-label={PICKUP_LABEL[status]} title={PICKUP_LABEL[status]}>
                <Icon name={ICON[status]} size={26} /><span>{PICKUP_LABEL[status]}</span>
              </button>
            ))}
          </div>
        )
        : <p className="v5-readonly"><Icon name={ICON[pickup.status]} size={22} />{PICKUP_LABEL[pickup.status]}</p>}
      {error && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />{error}</p>}
    </>
  );
}

export type PickupDraft = { title: string; address: string; description: string; position: [number, number]; areaId: string | null; snappedTo: 'house' | 'street' | null };

export function PickupForm({ draft, busy, error, onChange, onSave }: { draft: PickupDraft; busy: boolean; error: string | null; onChange: (next: PickupDraft) => void; onSave: () => void }) {
  const check = validateDraft(draft);
  return (
    <form className="v5-form" onSubmit={(event) => { event.preventDefault(); if (check.ok) onSave(); }}>
      <p className="v5-hint"><Icon name="mapPin" size={18} />{draft.snappedTo === 'house' ? 'Am Haus' : draft.snappedTo === 'street' ? 'An der Straße' : 'Frei gesetzt'}{draft.areaId ? '' : ' · außerhalb der Gebiete'}</p>
      <input value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} placeholder="Was wird abgeholt?" aria-label="Titel" maxLength={160} autoComplete="off" />
      <input value={draft.address} onChange={(e) => onChange({ ...draft, address: e.target.value })} placeholder="Adresse" aria-label="Adresse" maxLength={320} autoComplete="off" />
      <input value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} placeholder="Hinweis (optional)" aria-label="Hinweis" maxLength={4000} autoComplete="off" />
      {error && <p className="v5-warn" role="alert"><Icon name="warning" size={20} />{error}</p>}
      <button type="submit" className="v5-go" disabled={busy || !check.ok} aria-label="Sonder-Marker speichern" title="Sonder-Marker speichern"><Icon name="check" size={26} /></button>
    </form>
  );
}
