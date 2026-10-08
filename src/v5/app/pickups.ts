import type { LngLat } from '../engine/types.ts';
import { pointInRing } from '../engine/geo.ts';
import type { Meta } from './api.ts';
import { postMutation } from './api.ts';

export type PickupStatus = 'open' | 'collected' | 'unavailable' | 'needs-follow-up';
export const PICKUP_STATUSES: readonly PickupStatus[] = ['collected', 'needs-follow-up', 'unavailable', 'open'];
export const PICKUP_LABEL: Record<PickupStatus, string> = { open: 'Offen', collected: 'Abgeholt', 'needs-follow-up': 'Nochmal', unavailable: 'Nicht verfügbar' };
export const PICKUP_COLOR: Record<PickupStatus, string> = { open: '#c77dff', collected: '#3ee0b8', 'needs-follow-up': '#ffd24a', unavailable: '#8d9bb0' };

/** The subset of the legacy pickup task the field surface needs. */
export type Pickup = { id: string; areaId: string | null; title: string; address: string; description: string; position: LngLat; status: PickupStatus; updatedAt: string; archivedAt: string | null };

/** Sonder-Marker never count towards street progress; their own tally is shown next to them. */
export const pickupTally = (pickups: Pickup[]) => ({ total: pickups.length, collected: pickups.filter((p) => p.status === 'collected').length });

const ID = /^collection_pickup_[A-Za-z0-9._:-]+$/u;
export const newPickupId = () => `collection_pickup_${crypto.randomUUID()}`;
export const isPickupId = (id: string) => ID.test(id);

export type Snap = { position: LngLat; address: string | null; snappedTo: 'house' | 'street' | null; areaId: string | null };

/**
 * A Sonder-Marker belongs on the real thing, not next to it. The engine (which holds the geometry) snaps the tap to the
 * nearest house within 30 m, else onto the nearest street within 22 m; the Area is the one containing the snapped point.
 */
export async function snapPoint(engine: { snap(at: LngLat): Promise<{ position: LngLat; address: string | null; kind: 0 | 1 | 2 }> }, at: LngLat, areas: Pick<Meta['areas'][number], 'id' | 'geometry'>[]): Promise<Snap> {
  const r = await engine.snap(at);
  const area = areas.find((a) => pointInRing(r.position, a.geometry.coordinates[0] as LngLat[]));
  return { position: r.position, address: r.address, snappedTo: r.kind === 1 ? 'house' : r.kind === 2 ? 'street' : null, areaId: area?.id ?? null };
}

/** Only these fields reach the server, with the length rules the server enforces (title ≤ 160, address ≤ 320). */
export function validateDraft(draft: { title: string; address: string; description: string }): { ok: true; value: { title: string; address: string; description: string } } | { ok: false; reason: 'title' | 'address' | 'long' } {
  const title = draft.title.trim().replace(/\s+/gu, ' '), address = draft.address.trim().replace(/\s+/gu, ' '), description = draft.description.trim();
  if (!title) return { ok: false, reason: 'title' };
  if (!address) return { ok: false, reason: 'address' };
  if (title.length > 160 || address.length > 320 || description.length > 4000) return { ok: false, reason: 'long' };
  return { ok: true, value: { title, address, description } };
}

export async function createPickup(campaignId: string, draft: { title: string; address: string; description: string; position: LngLat; areaId: string | null }): Promise<string> {
  const pickupId = newPickupId();
  await postMutation(campaignId, 'collection.pickup.create', { pickupId, areaId: draft.areaId, title: draft.title, address: draft.address, description: draft.description, position: draft.position, source: null }, { revisionFrom: 'collection' });
  return pickupId;
}

export const setPickupStatus = (campaignId: string, pickup: Pickup, status: PickupStatus) =>
  postMutation(campaignId, 'collection.pickup.set-status', { pickupId: pickup.id, status, expectedUpdatedAt: pickup.updatedAt }, { revisionFrom: 'collection' });

/** Pickups from the legacy collection snapshot (the same endpoint the old helper view reads). */
export async function fetchPickups(campaignId: string): Promise<Pickup[]> {
  try {
    const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/collection/snapshot`, { credentials: 'same-origin' });
    if (!response.ok) return [];
    const body = await response.json() as { collection?: { pickups?: { id: string; areaId: string | null; title: string; address: string; description: string; position: LngLat; status: PickupStatus; updatedAt: string; archivedAt: string | null }[] } };
    return (body.collection?.pickups ?? []).filter((p) => !p.archivedAt).map(({ id, areaId, title, address, description, position, status, updatedAt, archivedAt }) => ({ id, areaId, title, address, description, position, status, updatedAt, archivedAt }));
  } catch { return []; }
}
