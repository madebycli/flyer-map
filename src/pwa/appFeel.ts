/**
 * App feel on every page: no pinch zoom, no double-tap zoom, no browser context menu on the page itself.
 * (iOS Safari ignores `user-scalable=no`; the gesture events are the way to stop it. The map handles its own gestures and keeps working.)
 */
let locked = false;
export function lockAppFeel(doc: Document = document): void {
  if (locked) return;
  locked = true;
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(type, (event) => event.preventDefault(), { passive: false });
  const inMap = (event: Event) => !!(event.target as HTMLElement | null)?.closest?.('.maplibregl-canvas-container');
  const inField = (event: Event) => !!(event.target as HTMLElement | null)?.closest?.('input,textarea,[contenteditable="true"]');
  doc.addEventListener('dblclick', (event) => { if (!inMap(event) && !inField(event)) event.preventDefault(); }, { passive: false });
  doc.addEventListener('contextmenu', (event) => { if (!inField(event)) event.preventDefault(); });
}
