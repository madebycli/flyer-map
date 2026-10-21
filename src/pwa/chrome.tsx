import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './pwa.css';
import { applyUpdate, onUpdate, updateAvailable, watchUpdates } from './update.ts';
import { versionLabel } from './version.ts';

/** A wide bar at the top when a newer build is online. The running app is never reloaded under the person's hands. */
export function UpdateBanner() {
  const [latest, setLatest] = useState(updateAvailable());
  const [later, setLater] = useState<string | null>(null);
  useEffect(() => onUpdate(setLatest), []);
  if (!latest || later === latest.build) return null;
  return (
    <div className="pwa-banner" role="status">
      <span>Neue Version {versionLabel(latest)} verfügbar<small>Jetzt aktualisieren, die Daten bleiben erhalten.</small></span>
      <button onClick={() => applyUpdate()}>Aktualisieren</button>
      <button className="plain" onClick={() => setLater(latest.build)} aria-label="Später erinnern">×</button>
    </div>
  );
}

let mounted = false;
/** The banner lives in a root of its own, so every page (field map, organiser pages) gets it the same way. */
export function mountPwaChrome(): void {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  const host = document.createElement('div');
  host.id = 'pwa-chrome';
  document.body.appendChild(host);
  createRoot(host).render(<UpdateBanner />);
  watchUpdates();
}

/**
 * A full page over everything (installation guide, start page) in a root of its own; `render` gets the function that takes it away again.
 * Returns that same function.
 */
export function showOver(render: (close: () => void) => React.ReactNode): () => void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => { root.unmount(); host.remove(); };
  root.render(render(close));
  return close;
}
