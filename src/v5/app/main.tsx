import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../../ui/ui.css';
import './v5.css';
import { App } from './App.tsx';
import { linkIntent, redeemLink, type Redeemed } from './link.ts';
import { applyTheme, Icon } from '../../ui/index.ts';
import { initDiag } from '../diag/index.ts';

// App feel: the page itself must never pinch-zoom or double-tap-zoom (iOS Safari ignores user-scalable=no); the map handles its own gestures.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
document.addEventListener('dblclick', (event) => { if (!(event.target as HTMLElement)?.closest?.('.maplibregl-canvas-container')) event.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (event) => { if (!(event.target as HTMLElement)?.closest?.('input,textarea')) event.preventDefault(); });

const Card = ({ title, text, retry }: { title: string; text: string; retry?: boolean }) => (
  <div className="v5-overlay"><div className="v5-card"><h2>{title}</h2><p>{text}</p>{retry && <button className="v5-btn primary" onClick={() => location.reload()}><Icon name="sync" size={20} />Erneut versuchen</button>}</div></div>
);

/** An access link is exchanged for a session first; the token never stays in the address bar. */
async function boot(campaign: string | null): Promise<React.ReactNode> {
  if (!campaign) return <Card title="Keine Aktion gewählt" text="Öffne den Link mit ?campaign=…" />;
  const intent = linkIntent(location.hash);
  if (!intent) return <App campaignId={campaign} />;
  const result: Redeemed = await redeemLink(campaign, intent);
  if (result === 'offline') return <Card title="Keine Verbindung" text="Der Zugangslink konnte nicht eingelöst werden. Der Link bleibt gültig." retry />;
  // The fragment is single-use input: remove it, and make a helper link open the collection side.
  const url = new URL(location.href);
  url.hash = '';
  if (intent.kind === 'collection') url.searchParams.set('kind', 'collection');
  history.replaceState(null, '', url);
  if (result === 'invalid') return <Card title="Link ungültig" text="Dieser Zugangslink ist abgelaufen oder wurde widerrufen. Bitte um einen neuen Link." />;
  return <App campaignId={campaign} />;
}

initDiag(); // the error nets and sensors must exist before anything else can fail
applyTheme();
const root = createRoot(document.getElementById('root')!);
void boot(new URLSearchParams(location.search).get('campaign')).then((page) => root.render(<StrictMode>{page}</StrictMode>));
