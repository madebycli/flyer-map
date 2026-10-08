import type { LngLat } from '../engine/types.ts';
import { pointInRing } from '../engine/geo.ts';
import type { Index } from './mark.ts';
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

const M_LAT = 110_574;
const mLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

export type Snap = { position: LngLat; address: string | null; snappedTo: 'house' | 'street' | null; areaId: string | null };

/**
 * A Sonder-Marker belongs on the real thing, not next to it: snap to the nearest house within `houseReach` metres,
 * else onto the nearest visible street within `streetReach`; the address is taken from what it snapped to.
 */
export function snapToNetwork(index: Index, at: LngLat, areas: Pick<Meta['areas'][number], 'id' | 'geometry'>[], houseReach = 30, streetReach = 22): Snap {
  const kx = mLng(at[1]);
  const d2 = (p: LngLat) => ((p[0] - at[0]) * kx) ** 2 + ((p[1] - at[1]) * M_LAT) ** 2;
  let house: { d: number; h: { center: LngLat; street: string | null; number: string | null } } | null = null;
  for (const h of index.houses.values()) {
    if (Math.abs(h.center[0] - at[0]) * kx > houseReach || Math.abs(h.center[1] - at[1]) * M_LAT > houseReach) continue;
    const d = d2(h.center);
    if (d <= houseReach ** 2 && (!house || d < house.d)) house = { d, h };
  }
  let result: Omit<Snap, 'areaId'>;
  if (house) {
    const label = [house.h.street, house.h.number].filter(Boolean).join(' ');
    result = { position: house.h.center, address: label || null, snappedTo: 'house' };
  } else {
    let best: { d: number; p: LngLat; name: string | null } | null = null;
    for (const s of index.segments.values()) {
      if (!s.visible) continue;
      for (let i = 0; i + 1 < s.coords.length; i++) {
        const a = s.coords[i], b = s.coords[i + 1];
        const ax = (a[0] - at[0]) * kx, ay = (a[1] - at[1]) * M_LAT, bx = (b[0] - at[0]) * kx, by = (b[1] - at[1]) * M_LAT;
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
        const px = ax + t * dx, py = ay + t * dy, d = px * px + py * py;
        if (d <= streetReach ** 2 && (!best || d < best.d)) best = { d, p: [at[0] + px / kx, at[1] + py / M_LAT], name: s.name };
      }
    }
    result = best ? { position: best.p, address: best.name, snappedTo: 'street' } : { position: at, address: null, snappedTo: null };
  }
  const area = areas.find((a) => pointInRing(result.position, a.geometry.coordinates[0] as LngLat[]));
  return { ...result, areaId: area?.id ?? null };
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
