import { useState } from 'react';
import '../ui/ui.css';
import './pwa.css';
import { lastCampaign, pastedLinkTarget } from './link.ts';

/** The first page of the installed app: carry on, paste an invitation link, or sign in as organiser. */
export function StartPage() {
  const last = lastCampaign();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const open = (value: string) => {
    const target = pastedLinkTarget(value, location.origin);
    if (!target) { setProblem('Das ist kein Link zu dieser App. Kopiere den Link, den du bekommen hast, vollständig.'); return; }
    location.assign(target);
  };
  const paste = async () => {
    try { const value = await navigator.clipboard.readText(); setText(value); open(value); } catch { setProblem('Einfügen nicht erlaubt. Halte das Feld gedrückt und wähle „Einsetzen“.'); }
  };
  return (
    <main className="pwa-page" aria-labelledby="pwa-start-title">
      <div className="pwa-wrap">
        <header className="pwa-head">
          <img src="/icon.svg" alt="" width="80" height="80" />
          <h1 id="pwa-start-title">Verteil-Flyer</h1>
          <p>Flyer verteilen mit einer gemeinsamen Karte.</p>
        </header>
        <div className="pwa-actions">
          {last && <a className="pwa-btn primary" href={`/v5?campaign=${encodeURIComponent(last)}`}>Weiter mit der letzten Aktion</a>}
        </div>
        <form className="pwa-actions" onSubmit={(event) => { event.preventDefault(); open(text); }}>
          <label htmlFor="pwa-link" className="pwa-note" style={{ textAlign: 'left' }}>Zugangslink einfügen</label>
          <input id="pwa-link" className="pwa-input" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="https://…" value={text} onChange={(event) => { setText(event.target.value); setProblem(null); }} />
          {problem && <p className="pwa-error" role="alert">{problem}</p>}
          <button type="submit" className={`pwa-btn${last ? '' : ' primary'}`} disabled={!text.trim()}>Öffnen</button>
          <button type="button" className="pwa-btn" onClick={() => void paste()}>Aus der Zwischenablage einfügen</button>
        </form>
        <div className="pwa-actions">
          <a className="pwa-btn" href="/login">Als Organisator anmelden</a>
        </div>
      </div>
    </main>
  );
}
