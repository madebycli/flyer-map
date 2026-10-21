import { useEffect, useRef, useState } from 'react';
import type { EngineClient } from './engineClient.ts';
import type { SearchHit } from './search.ts';
import { Icon } from '../../ui/index.ts';

/**
 * The bar at the top of the map, the one place for "where am I and where to": menu, search, status. It never changes size.
 * Typing opens the results as a card that floats under it (the bar and the map do not move), a tap on a result flies there and closes the card.
 * The status button (`status`) is the app's progress and sync state; it opens the overview.
 */
export function CommandBar({ engine, onMenu, onFocusSearch, onPick, status }: {
  engine: EngineClient | null; onMenu: () => void; onFocusSearch: () => void; onPick: (hit: SearchHit) => void; status: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!engine || !query.trim()) { setResults([]); return; }
    let stale = false;
    const timer = window.setTimeout(() => { engine.search(query).then((hits) => { if (!stale) setResults(hits); }, () => { if (!stale) setResults([]); }); }, 50);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [engine, query]);
  const open = focused && query.trim().length > 0;
  const finish = () => { setQuery(''); setResults([]); input.current?.blur(); };
  const pick = (hit: SearchHit) => { onPick(hit); finish(); };
  return (
    <>
      <div className="v5-cmd" data-open={open}>
        <button className="v5-cmd-btn" onClick={() => { finish(); onMenu(); }} aria-label="Menü" title="Menü"><Icon name="menu" size={24} /></button>
        <label className="v5-cmd-search">
          <Icon name="search" size={22} />
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Straße oder Adresse" aria-label="Straße oder Adresse suchen"
            inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
            onFocus={() => { setFocused(true); onFocusSearch(); }} onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) pick(results[0]); else if (e.key === 'Escape') finish(); }} />
          {query && <button type="button" className="v5-cmd-clear" onMouseDown={(e) => e.preventDefault()} onClick={() => { setQuery(''); input.current?.focus(); }} aria-label="Suche leeren" title="Suche leeren"><Icon name="close" size={20} /></button>}
        </label>
        {status}
      </div>
      {open && (
        <div className="v5-spot" role="listbox" aria-label="Suchergebnisse">
          {results.length > 0
            ? results.map((r) => (
              <button key={`${r.kind}${r.id}`} className="v5-result" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                <span className="v5-result-ico"><Icon name={r.kind === 'street' ? 'road' : 'house'} size={22} /></span>
                <span className="v5-result-text"><b>{r.label}</b><small>{r.kind === 'street' ? 'Straße' : 'Haus'}</small></span>
                <small className="v5-result-detail">{r.detail}</small>
              </button>
            ))
            : <p className="v5-spot-empty"><Icon name="search" size={22} />Nichts gefunden. Prüfe die Schreibweise oder suche nur nach dem Straßennamen.</p>}
        </div>
      )}
    </>
  );
}
