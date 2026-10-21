import { useEffect, useState } from 'react';
import '../ui/ui.css';
import './pwa.css';
import { canPromptInstall, onInstallPromptChange, promptInstall, saveSkip, type Platform } from './install.ts';

/* The pictures are the real symbols the person has to find (drawn here, no image files), the one to tap ringed in the accent colour. */
const Glyph = ({ hot, children, label }: { hot?: boolean; children: React.ReactNode; label: string }) => (
  <span className={`pwa-glyph${hot ? ' hot' : ''}`} role="img" aria-label={label}>
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
  </span>
);
/** iOS "Teilen": a box open at the top with an arrow leaving it. */
const ShareGlyph = () => <><path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" /></>;
/** iOS "Zum Home-Bildschirm": a rounded square with a plus. */
const AddHomeGlyph = () => <><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><path d="M12 8v8M8 12h8" /></>;
/** Chrome's menu: three dots. */
const DotsGlyph = () => <><circle cx="12" cy="5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="19" r="1.2" fill="currentColor" /></>;
/** "App installieren": a phone with an arrow going in. */
const InstallGlyph = () => <><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M12 7.5v6" /><path d="m9.5 11.5 2.5 2.5 2.5-2.5" /></>;
const CheckGlyph = () => <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.6 2.6L16 9.5" /></>;

type Step = { glyph: React.ReactNode; label: string; title: string; text: string; hot?: boolean };
const IOS: Step[] = [
  { glyph: <ShareGlyph />, label: 'Teilen-Symbol', title: 'Teilen öffnen', text: 'Tippe auf das Teilen-Symbol, unten oder im Menü ⋯ des Browsers.', hot: true },
  { glyph: <AddHomeGlyph />, label: 'Zum Home-Bildschirm', title: 'Zum Home-Bildschirm', text: 'Wische in der Liste nach unten und tippe auf „Zum Home-Bildschirm“.' },
  { glyph: <CheckGlyph />, label: 'Hinzufügen', title: 'Hinzufügen', text: 'Bestätige oben rechts. Danach startest du die App vom Home-Bildschirm.' },
];
const ANDROID: Step[] = [
  { glyph: <DotsGlyph />, label: 'Menü mit drei Punkten', title: 'Menü öffnen', text: 'Tippe oben rechts auf die drei Punkte.', hot: true },
  { glyph: <InstallGlyph />, label: 'App installieren', title: 'App installieren', text: 'Wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.' },
  { glyph: <CheckGlyph />, label: 'Installieren', title: 'Bestätigen', text: 'Tippe auf „Installieren“. Die App liegt dann auf deinem Startbildschirm.' },
];

const hasAccessLink = () => /[?&]campaign=/.test(location.search) || location.hash.length > 1;

/** Shown before the app loads, on a phone or tablet in a normal browser tab. `onContinue` opens the app in the browser anyway. */
export function InstallGuide({ platform, onContinue }: { platform: Exclude<Platform, 'other'>; onContinue(): void }) {
  const [canPrompt, setCanPrompt] = useState(canPromptInstall());
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  useEffect(() => onInstallPromptChange(() => setCanPrompt(canPromptInstall())), []);
  const copy = async () => { try { await navigator.clipboard.writeText(location.href); setCopied('yes'); } catch { setCopied('failed'); } };
  const ios = platform === 'ios';
  const link = hasAccessLink();
  return (
    <main className="pwa-page" aria-labelledby="pwa-guide-title">
      <div className="pwa-wrap">
        <header className="pwa-head">
          <img src="/logo.svg" alt="" width="88" height="88" />
          <h1 id="pwa-guide-title">Als App installieren</h1>
          <p>Schneller, ohne Browserleiste, immer aktuell.</p>
        </header>
        <ol className="pwa-steps">
          {(ios ? IOS : ANDROID).map((step) => (
            <li key={step.title} className="pwa-step">
              <Glyph hot={step.hot} label={step.label}>{step.glyph}</Glyph>
              <div><b>{step.title}</b><p>{step.text}</p></div>
            </li>
          ))}
        </ol>
        <footer className="pwa-foot">
          {ios && <p className="pwa-note">Auf iPhone und iPad hat die App einen eigenen Speicher: Öffne dort „Zugangslink einfügen“.</p>}
          {!ios && canPrompt && <button className="pwa-btn primary" onClick={() => void promptInstall()}>App installieren</button>}
          <div className={`pwa-pair${link ? '' : ' single'}`}>
            {link && <button className="pwa-btn" onClick={() => void copy()}>{copied === 'yes' ? 'Link kopiert' : copied === 'failed' ? 'Nicht möglich' : 'Link kopieren'}</button>}
            <button className="pwa-btn" onClick={() => { saveSkip(); onContinue(); }}>Im Browser öffnen</button>
          </div>
        </footer>
      </div>
    </main>
  );
}
