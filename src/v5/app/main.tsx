import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../../ui/ui.css';
import './v5.css';
import { App } from './App.tsx';
import { linkIntent, redeemLink, type Redeemed } from './link.ts';
import { JoinRoom } from './roomsUi.tsx';
import { roomIntent } from './roomsLogic.ts';
import { applyTheme, Icon } from '../../ui/index.ts';
import { initDiag } from '../diag/index.ts';
import { watchViewport } from './viewport.ts';
import { lockAppFeel } from '../../pwa/appFeel.ts';
import { mountPwaChrome, showOver } from '../../pwa/chrome.tsx';
import { InstallGuide } from '../../pwa/InstallGuide.tsx';
import { captureInstallPrompt, detectPlatform, wantsGuide } from '../../pwa/install.ts';
import { rememberCampaign } from '../../pwa/link.ts';
import { registerServiceWorker } from '../../pwa/register.ts';
import { splash } from '../../pwa/splash.ts';
import { coldStartUpdate } from '../../pwa/update.ts';

const Card = ({ title, text, retry }: { title: string; text: string; retry?: boolean }) => (
  <div className="v5-overlay"><div className="v5-card"><h2>{title}</h2><p>{text}</p>{retry && <button className="v5-btn primary" onClick={() => location.reload()}><Icon name="sync" size={20} />Erneut versuchen</button>}</div></div>
);

/** An access link is exchanged for a session first; the token never stays in the address bar. */
/** `app`: the map app takes the start screen away itself, once its map is on screen; every other page takes it away at once. */
async function boot(campaign: string | null): Promise<{ page: React.ReactNode; app: boolean }> {
  if (!campaign) return { page: <Card title="Keine Aktion gewählt" text="Öffne den Link mit ?campaign=…" />, app: false };
  // A room link: the room's page decides (join, or on to the map). The secret stays in the fragment, which no server ever sees.
  const room = roomIntent(location.search, location.hash);
  if (room) return { page: <JoinRoom roomId={room.roomId} secret={room.secret} campaignId={room.campaignId} />, app: false };
  const intent = linkIntent(location.hash);
  if (!intent) return { page: <App campaignId={campaign} />, app: true };
  splash.text('Zugang wird geprüft …');
  const result: Redeemed = await redeemLink(campaign, intent);
  if (result === 'offline') return { page: <Card title="Keine Verbindung" text="Der Zugangslink konnte nicht eingelöst werden. Der Link bleibt gültig." retry />, app: false };
  // The fragment is single-use input: remove it, and make a helper link open the collection side.
  const url = new URL(location.href);
  url.hash = '';
  if (intent.kind === 'collection') url.searchParams.set('kind', 'collection');
  history.replaceState(null, '', url);
  if (result === 'invalid') return { page: <Card title="Link ungültig" text="Dieser Zugangslink ist abgelaufen oder wurde widerrufen. Bitte um einen neuen Link." />, app: false };
  return { page: <App campaignId={campaign} />, app: true };
}

lockAppFeel();
splash.watch();
captureInstallPrompt();
registerServiceWorker();
watchViewport();
initDiag(); // the error nets and sensors must exist before anything else can fail
applyTheme();
const root = createRoot(document.getElementById('root')!);

async function start() {
  // On a phone or tablet in a browser tab the installation guide comes first (it lies over the start screen; "open in the browser anyway" goes on).
  if (wantsGuide()) {
    const platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
    await new Promise<void>((resolve) => { const close = showOver((done) => <InstallGuide platform={platform === 'ios' ? 'ios' : 'android'} onContinue={() => { done(); resolve(); }} />); void close; });
  }
  void coldStartUpdate(4000, undefined, () => splash.active()).then((reloading) => { if (reloading) splash.text('Neue Version wird geladen …'); });
  mountPwaChrome();
  splash.text('Aktion wird geöffnet …');
  const campaign = new URLSearchParams(location.search).get('campaign');
  if (campaign) rememberCampaign(campaign);
  const { page, app } = await boot(campaign);
  root.render(<StrictMode>{page}</StrictMode>);
  if (!app) splash.hide();
}
void start();
