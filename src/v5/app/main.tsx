import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './controls.css';
import './v5.css';
import { App } from './App.tsx';

// App feel: the page itself must never pinch-zoom or double-tap-zoom (iOS Safari ignores user-scalable=no); the map handles its own gestures.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
document.addEventListener('dblclick', (event) => { if (!(event.target as HTMLElement)?.closest?.('.maplibregl-canvas-container')) event.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (event) => { if (!(event.target as HTMLElement)?.closest?.('input,textarea')) event.preventDefault(); });

const campaign = new URLSearchParams(location.search).get('campaign');
const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    {campaign ? <App campaignId={campaign} /> : <div className="v5-overlay"><div className="v5-card"><h2>Keine Aktion gewählt</h2><p>Öffne den Link mit <code>?campaign=…</code>.</p></div></div>}
  </StrictMode>,
);
