/** Where the person last looked at an Aktion's map (kept on this device), so a start can bring the parts around it first. */
export type LastView = { center: [number, number]; zoom: number };
const key = (campaignId: string) => `vf-v5-view-${campaignId}`;

export function readLastView(campaignId: string): LastView | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(campaignId)) ?? 'null') as Partial<LastView> | null;
    return v && Array.isArray(v.center) && v.center.length === 2 && v.center.every((x) => Number.isFinite(x)) && Number.isFinite(v.zoom) ? { center: [v.center[0], v.center[1]], zoom: v.zoom as number } : null;
  } catch { return null; }
}

export function saveLastView(campaignId: string, view: LastView): void {
  try { localStorage.setItem(key(campaignId), JSON.stringify({ center: [Math.round(view.center[0] * 1e5) / 1e5, Math.round(view.center[1] * 1e5) / 1e5], zoom: Math.round(view.zoom * 10) / 10 })); } catch { /* private mode */ }
}

/** Indices of `centers` by distance to the view (nearest first); without a view the given order stays. Distance in degrees, longitude scaled by latitude: only the order matters. */
export function nearestFirst(centers: ([number, number] | null)[], view: LastView | null): number[] {
  const order = centers.map((_, i) => i);
  if (!view) return order;
  const k = Math.cos((view.center[1] * Math.PI) / 180);
  const d = (c: [number, number] | null) => (c ? ((c[0] - view.center[0]) * k) ** 2 + (c[1] - view.center[1]) ** 2 : Infinity);
  return order.sort((a, b) => d(centers[a]) - d(centers[b]) || a - b);
}
