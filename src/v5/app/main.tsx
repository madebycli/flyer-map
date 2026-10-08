import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './controls.css';
import './v5.css';
import { App } from './App.tsx';

const campaign = new URLSearchParams(location.search).get('campaign');
const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    {campaign ? <App campaignId={campaign} /> : <div className="v5-overlay"><div className="v5-card"><h2>Keine Aktion gewählt</h2><p>Öffne den Link mit <code>?campaign=…</code>.</p></div></div>}
  </StrictMode>,
);
