import { useEffect, useState } from 'react';
import '../ui/ui.css';
import './pwa.css';
import { canPromptInstall, onInstallPromptChange, promptInstall, saveSkip, type Platform } from './install.ts';
import { detectBrowser, guideFor, type GlyphId } from './steps.ts';

/* The pictures are the real symbols the person has to find (drawn here, no image files), the one to tap ringed in the accent colour. */
const GlyphTile = ({ hot, children, label }: { hot?: boolean; children: React.ReactNode; label: string }) => (
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
/** The menu of iOS browsers: three dots in a row. */
const DotsHGlyph = () => <><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></>;
/** "Mehr": a list with an arrow down. */
const MoreGlyph = () => <><path d="M5 6h14M5 11h14M5 16h8" /><path d="m16 15.5 3 3 3-3" /></>;
/** Samsung Internet's menu: three lines. */
const MenuGlyph = () => <><path d="M4 7h16M4 12h16M4 17h16" /></>;
/** "Im Browser öffnen": a compass. */
const OpenGlyph = () => <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>;

const GLYPHS: Record<GlyphId, () => React.ReactNode> = {
  share: ShareGlyph, addHome: AddHomeGlyph, confirm: CheckGlyph, dots: DotsGlyph, dotsH: DotsHGlyph, install: InstallGlyph, more: MoreGlyph, menu: MenuGlyph, openBrowser: OpenGlyph,
};

const hasAccessLink = () => /[?&]campaign=/.test(location.search) || location.hash.length > 1;

/** Shown before the app loads, on a phone or tablet in a normal browser tab. `onContinue` opens the app in the browser anyway. */
export function InstallGuide({ platform, onContinue }: { platform: Exclude<Platform, 'other'>; onContinue(): void }) {
  const [canPrompt, setCanPrompt] = useState(canPromptInstall());
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  useEffect(() => onInstallPromptChange(() => setCanPrompt(canPromptInstall())), []);
  const copy = async () => { try { await navigator.clipboard.writeText(location.href); setCopied('yes'); } catch { setCopied('failed'); } };
  const brave = typeof navigator !== 'undefined' && !!(navigator as { brave?: unknown }).brave;
  const guide = guideFor(platform, detectBrowser(navigator.userAgent, platform, { brave }), canPrompt);
  const link = hasAccessLink();
  return (
    <main className="pwa-page" aria-labelledby="pwa-guide-title">
      <div className="pwa-wrap">
        <header className="pwa-head">
          <img src="/logo.svg" alt="" width="88" height="88" />
          <h1 id="pwa-guide-title">Als App installieren</h1>
          <p>{guide.direct ? 'Ein Fingertipp, dann liegt die App auf deinem Startbildschirm.' : 'Schneller, ohne Browserleiste, immer aktuell.'}</p>
        </header>
        {guide.direct ? <div className="pwa-body" /> : (
          <ol className="pwa-steps">
            {guide.steps.map((step) => {
              const Glyph = GLYPHS[step.glyph];
              return (
                <li key={step.title + step.glyph} className="pwa-step">
                  <GlyphTile hot={step.hot} label={step.title}><Glyph /></GlyphTile>
                  <div><b>{step.title}</b><p>{step.text}</p></div>
                </li>
              );
            })}
          </ol>
        )}
        <footer className="pwa-foot">
          {guide.note && <p className="pwa-note">{guide.note}</p>}
          {platform === 'ios' && <p className="pwa-note">Auf iPhone und iPad hat die App einen eigenen Speicher: Öffne dort „Zugangslink einfügen“.</p>}
          {guide.direct && <button className="pwa-btn primary" onClick={() => void promptInstall()}>App installieren</button>}
          <div className={`pwa-pair${link ? '' : ' single'}`}>
            {link && <button className="pwa-btn" onClick={() => void copy()}>{copied === 'yes' ? 'Link kopiert' : copied === 'failed' ? 'Nicht möglich' : 'Link kopieren'}</button>}
            <button className="pwa-btn" onClick={() => { saveSkip(); onContinue(); }}>Im Browser öffnen</button>
          </div>
        </footer>
      </div>
    </main>
  );
}
