import { useEffect, useState } from 'react';
import './pwa.css';
import { canPromptInstall, onInstallPromptChange, promptInstall, saveSkip, type Platform } from './install.ts';

/* The pictures are drawn here (no image files): a mock of the browser bar or sheet with the thing to tap ringed in the accent colour. */
const RING = 'var(--primary)';
function Shot({ children, label }: { children: React.ReactNode; label: string }) {
  return <svg className="pwa-shot" viewBox="0 0 320 112" role="img" aria-label={label}>{children}</svg>;
}
const Share = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M-9 -2v14a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V-2M0 -14v18M-6 -8l6-6 6 6" />
  </g>
);
const Ring = ({ x, y, r = 24 }: { x: number; y: number; r?: number }) => <circle cx={x} cy={y} r={r} fill="none" stroke={RING} strokeWidth="3" />;

function IosShare() {
  return (
    <Shot label="Untere Leiste von Safari, das Teilen-Symbol in der Mitte ist markiert">
      <rect x="10" y="30" width="300" height="52" rx="26" fill="var(--surface-4)" />
      <path d="M44 56l-8 0m0 0l6-6m-6 6l6 6" stroke="var(--on-var)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d="M92 50l8 6-8 6" stroke="var(--on-var)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.5" />
      <g style={{ color: 'var(--on)' }}><Share x={160} y={58} /></g>
      <Ring x={160} y={56} />
      <rect x="226" y="46" width="22" height="20" rx="4" fill="none" stroke="var(--on-var)" strokeWidth="2.4" />
      <circle cx="282" cy="56" r="2.6" fill="var(--on-var)" /><circle cx="272" cy="56" r="2.6" fill="var(--on-var)" /><circle cx="262" cy="56" r="2.6" fill="var(--on-var)" />
    </Shot>
  );
}
function IosAdd() {
  return (
    <Shot label="Liste im Teilen-Menü, Zum Home-Bildschirm ist markiert">
      <rect x="24" y="12" width="272" height="30" rx="12" fill="var(--surface-4)" opacity="0.6" />
      <rect x="24" y="52" width="272" height="48" rx="14" fill="var(--surface-4)" />
      <rect x="40" y="64" width="24" height="24" rx="6" fill="none" stroke="var(--on)" strokeWidth="2.4" />
      <path d="M52 70v12M46 76h12" stroke="var(--on)" strokeWidth="2.4" strokeLinecap="round" />
      <text x="78" y="82" fill="var(--on)" fontSize="16" fontWeight="700" fontFamily="system-ui, sans-serif">Zum Home-Bildschirm</text>
      <rect x="20" y="48" width="280" height="56" rx="16" fill="none" stroke={RING} strokeWidth="3" />
    </Shot>
  );
}
function IosConfirm() {
  return (
    <Shot label="Oben rechts die Schaltfläche Hinzufügen ist markiert">
      <text x="160" y="40" fill="var(--on)" fontSize="15" fontWeight="800" textAnchor="middle" fontFamily="system-ui, sans-serif">Zum Home-Bildschirm</text>
      <rect x="236" y="22" width="68" height="30" rx="15" fill="var(--primary)" />
      <text x="270" y="43" fill="var(--on-primary)" fontSize="14" fontWeight="800" textAnchor="middle" fontFamily="system-ui, sans-serif">Hinzufügen</text>
      <rect x="230" y="17" width="80" height="40" rx="20" fill="none" stroke={RING} strokeWidth="3" />
      <rect x="24" y="68" width="272" height="30" rx="10" fill="var(--surface-4)" />
      <text x="40" y="88" fill="var(--on-var)" fontSize="14" fontFamily="system-ui, sans-serif">Flyer</text>
    </Shot>
  );
}
function AndroidMenu() {
  return (
    <Shot label="Browserleiste, das Menü mit drei Punkten oben rechts ist markiert">
      <rect x="10" y="30" width="300" height="52" rx="26" fill="var(--surface-4)" />
      <text x="40" y="62" fill="var(--on-var)" fontSize="15" fontFamily="system-ui, sans-serif">flyer-map…workers.dev</text>
      <circle cx="274" cy="46" r="2.8" fill="var(--on)" /><circle cx="274" cy="56" r="2.8" fill="var(--on)" /><circle cx="274" cy="66" r="2.8" fill="var(--on)" />
      <Ring x={274} y={56} />
    </Shot>
  );
}
function AndroidInstall() {
  return (
    <Shot label="Menüpunkt App installieren ist markiert">
      <rect x="24" y="10" width="272" height="30" rx="10" fill="var(--surface-4)" opacity="0.6" />
      <rect x="24" y="48" width="272" height="48" rx="14" fill="var(--surface-4)" />
      <path d="M52 62v14m-7-7l7 7 7-7M44 82h16" stroke="var(--on)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <text x="76" y="78" fill="var(--on)" fontSize="16" fontWeight="700" fontFamily="system-ui, sans-serif">App installieren</text>
      <rect x="20" y="44" width="280" height="56" rx="16" fill="none" stroke={RING} strokeWidth="3" />
    </Shot>
  );
}
function AndroidConfirm() {
  return (
    <Shot label="Die Schaltfläche Installieren im Fenster ist markiert">
      <rect x="40" y="10" width="240" height="92" rx="20" fill="var(--surface-4)" />
      <text x="62" y="40" fill="var(--on)" fontSize="15" fontWeight="800" fontFamily="system-ui, sans-serif">App installieren?</text>
      <text x="62" y="60" fill="var(--on-var)" fontSize="13" fontFamily="system-ui, sans-serif">Verteil-Flyer</text>
      <rect x="168" y="68" width="96" height="28" rx="14" fill="var(--primary)" />
      <text x="216" y="87" fill="var(--on-primary)" fontSize="14" fontWeight="800" textAnchor="middle" fontFamily="system-ui, sans-serif">Installieren</text>
      <rect x="162" y="63" width="108" height="38" rx="19" fill="none" stroke={RING} strokeWidth="3" />
    </Shot>
  );
}

const hasAccessLink = () => /[?&]campaign=/.test(location.search) || location.hash.length > 1;

/** Shown before the app loads, on a phone or tablet in a normal browser tab. `onContinue` opens the app in the browser anyway. */
export function InstallGuide({ platform, onContinue }: { platform: Exclude<Platform, 'other'>; onContinue(): void }) {
  const [canPrompt, setCanPrompt] = useState(canPromptInstall());
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  useEffect(() => onInstallPromptChange(() => setCanPrompt(canPromptInstall())), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(location.href); setCopied('yes'); } catch { setCopied('failed'); }
  };
  const ios = platform === 'ios';
  return (
    <main className="pwa-page" aria-labelledby="pwa-guide-title">
      <div className="pwa-wrap">
        <header className="pwa-head">
          <img src="/icon.svg" alt="" width="80" height="80" />
          <h1 id="pwa-guide-title">Als App installieren</h1>
          <p>Ohne Browserleiste, schneller gestartet und immer auf dem neuesten Stand.</p>
        </header>
        {!ios && canPrompt && <button className="pwa-btn primary" onClick={() => void promptInstall()}>App installieren</button>}
        <ol className="pwa-steps">
          {ios ? (
            <>
              <li className="pwa-step"><b>Teilen öffnen</b><IosShare /><p>Tippe auf das Teilen-Symbol (Quadrat mit Pfeil nach oben). Es sitzt in der Leiste oder im Menü ⋯ des Browsers.</p></li>
              <li className="pwa-step"><b>Zum Home-Bildschirm</b><IosAdd /><p>Wische in der Liste nach unten und tippe auf „Zum Home-Bildschirm“.</p></li>
              <li className="pwa-step"><b>Hinzufügen</b><IosConfirm /><p>Bestätige oben rechts mit „Hinzufügen“. Danach startest du die App vom Home-Bildschirm.</p></li>
            </>
          ) : (
            <>
              <li className="pwa-step"><b>Menü öffnen</b><AndroidMenu /><p>Tippe oben rechts auf die drei Punkte.</p></li>
              <li className="pwa-step"><b>App installieren</b><AndroidInstall /><p>Wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.</p></li>
              <li className="pwa-step"><b>Bestätigen</b><AndroidConfirm /><p>Tippe auf „Installieren“. Die App erscheint auf deinem Startbildschirm.</p></li>
            </>
          )}
        </ol>
        {ios && <p className="pwa-note">Auf iPhone und iPad hat die App einen eigenen Speicher. Dein Zugang gilt dort nicht automatisch: Öffne in der App „Link einfügen“.</p>}
        <div className="pwa-actions">
          {hasAccessLink() && <button className="pwa-btn" onClick={() => void copy()}>{copied === 'yes' ? 'Link kopiert' : copied === 'failed' ? 'Kopieren nicht möglich' : 'Zugangslink kopieren'}</button>}
          <button className="pwa-btn" onClick={() => { saveSkip(); onContinue(); }}>Trotzdem im Browser öffnen</button>
        </div>
      </div>
    </main>
  );
}
