import { useEffect, useMemo, useState } from 'react';
import { Button, Check, Chip, Facts, Field, Notice, Segmented, Select, TextInput, Icon } from '../../ui/index.ts';
import { CATEGORIES, LEVELS, collectProbes, copyText, diagFlag, downloadText, log, metrics, report, setVerbose, type Category, type Entry, type Level } from '../diag/index.ts';
import { findings } from '../diag/findings.ts';
import { currentSession } from '../diag/index.ts';
import type { EngineClient } from './engineClient.ts';
import { SheetFrame } from './sheet.tsx';

type Tab = 'status' | 'engine' | 'sync' | 'net' | 'map' | 'log';
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Milliseconds as a field worker reads them: "0,8 ms", "340 ms", "2,4 s". */
const ms = (v: number | null | undefined) => (v == null ? '–' : v < 10 ? `${v.toFixed(1).replace('.', ',')} ms` : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1).replace('.', ',')} s`);
const kb = (v: number | null | undefined) => (v == null ? '–' : v < 1024 ? `${Math.round(v)} B` : v < 1024 * 1024 ? `${Math.round(v / 1024)} KB` : `${(v / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
const num = (v: number | null | undefined) => (v == null ? '–' : v.toLocaleString('de'));
const ago = (at: number | null | undefined) => { if (!at) return '–'; const s = Math.round((Date.now() - at) / 1000); return s < 60 ? `vor ${s} s` : s < 3600 ? `vor ${Math.round(s / 60)} min` : `vor ${Math.round(s / 3600)} h`; };
const clock = (t: number) => `${Math.floor(t / 60000)}:${String(Math.floor((t % 60000) / 1000)).padStart(2, '0')}.${Math.floor((t % 1000) / 100)}`;

function useTick(every = 1000) {
  const [, set] = useState(0);
  useEffect(() => { const id = window.setInterval(() => set((x) => x + 1), every); return () => window.clearInterval(id); }, [every]);
}

type HistRow = [string, { n: number; p50: number; p95: number; max: number } | null];
/** A compact table: name, count, median, 95th percentile, worst. `fmt` formats the three numbers (ms or bytes). */
function Table({ title, rows, fmt = ms, label }: { title: string; rows: HistRow[]; fmt?: (v: number) => string; label: string }) {
  const shown = rows.filter(([, h]) => h && h.n > 0);
  if (!shown.length) return null;
  return (
    <div className="v5-d-table" role="table" aria-label={label}>
      <div className="v5-d-row head" role="row"><span role="columnheader">{title}</span><span role="columnheader">Anz.</span><span role="columnheader">Median</span><span role="columnheader">95 %</span><span role="columnheader">Max</span></div>
      {shown.map(([name, h]) => (
        <div className="v5-d-row" role="row" key={name}><span role="cell" className="name">{name}</span><span role="cell">{num(h!.n)}</span><span role="cell">{fmt(h!.p50)}</span><span role="cell">{fmt(h!.p95)}</span><span role="cell">{fmt(h!.max)}</span></div>
      ))}
    </div>
  );
}

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => <><h3>{title}</h3>{children}</>;

export function DiagSheet({ engine, onClose }: { engine: EngineClient | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('status');
  useTick(1000);
  const s = metrics.snapshot();
  const P = collectProbes();
  const list = findings({ metrics: s, subsystems: P });
  const worst = list[0].level;
  const sync = obj(P.sync), campaign = obj(P.campaign), map = obj(P.map), eng = obj(P.engine), store = obj(campaign.store);
  const g = s.gauges, c = s.counters, h = s.histograms;
  const [copied, setCopied] = useState<string | null>(null);

  const copyReport = async () => {
    const text = JSON.stringify(report(), null, 2);
    const how = await copyText(text);
    setCopied(how === 'failed' ? 'Kopieren nicht möglich: bitte „Herunterladen“ benutzen.' : `Bericht kopiert (${Math.round(text.length / 1024)} KB).`);
  };
  const download = () => { const text = JSON.stringify(report(), null, 2); downloadText(`verteil-flyer-diagnose-${currentSession().id}.json`, text); setCopied('Bericht heruntergeladen.'); };

  return (
    <SheetFrame icon="chart" title="Diagnose" onClose={onClose} meta={<span>Sitzung {currentSession().id.slice(-5)} · läuft seit {clock(performance.now())} min</span>}>
      <Segmented<Tab> label="Bereich" value={tab} onChange={setTab} options={[{ value: 'status', label: 'Status' }, { value: 'engine', label: 'Engine' }, { value: 'sync', label: 'Sync' }, { value: 'net', label: 'Netz' }, { value: 'map', label: 'Karte' }, { value: 'log', label: 'Log' }]} />

      {tab === 'status' && (<>
        <ul className="v5-d-list" aria-label="Befunde">{list.map((f, i) => <li key={i}><Notice tone={f.level === 'error' ? 'error' : f.level === 'warn' ? 'warn' : f.level === 'ok' ? 'ok' : 'info'}>{f.text}</Notice></li>)}</ul>
        <Facts items={[
          ['Engine', g['engine.wasm'] === 1 ? 'Rust / WASM' : g['engine.wasm'] === 0 ? 'TypeScript' : '–'],
          ['Netz', g['net.online'] === 0 ? 'offline' : 'online'],
          ['Sync', `${sync.state ?? '–'} · ${n(sync.pendingOps) ?? 0} offen`],
          ['Bildrate', g['render.fps'] != null ? `${Math.round(g['render.fps'])} /s` : 'wird gemessen …'],
          ['Speicher (JS)', g['mem.heapMb'] != null ? `${Math.round(g['mem.heapMb'])} MB` : 'nicht messbar'],
          ['Warnungen / Fehler', `${log.counts.warn} / ${log.counts.error}`],
        ]} />
        <Block title="Start dieser Sitzung">
          {obj(campaign.timing).ready != null ? <Facts items={[
            ['Aktion laden', ms(n(obj(campaign.timing).meta))], ['Kartenpakete', ms(n(obj(campaign.timing).packs))], ['Berechnen', ms(n(obj(campaign.timing).derive))], ['Bereit nach', ms(n(obj(campaign.timing).ready))],
            ['Aus dem Cache', `${n(obj(campaign.timing).cacheHits) ?? 0} von ${arr(campaign.areas).length} Gebieten`], ['Häuser / Straßen', `${num(n(campaign.houses))} / ${num(n(campaign.segments))}`],
          ]} /> : <p className="v5-hint"><Icon name="info" size={20} />Der Start ist noch nicht abgeschlossen.</p>}
        </Block>
        <Block title="Gerät">
          <Facts items={deviceFacts(P)} />
        </Block>
        <Block title="Bericht">
          <p className="v5-hint">Der Bericht enthält Messwerte, Zähler und das Log dieser Sitzung – keine Positionen, Namen, Texte oder Zugangsdaten.</p>
          <div className="v5-row v5-d-actions">
            <Button tone="primary" icon="send" onClick={() => void copyReport()}>Bericht kopieren</Button>
            <Button icon="download" onClick={download}>Herunterladen</Button>
          </div>
          {copied && <p role="status" className="v5-hint"><Icon name="info" size={20} />{copied}</p>}
          <div className="v5-row v5-d-actions">
            <Button tone="quiet" icon="trash" onClick={() => { log.clear(); metrics.reset(); setCopied('Log und Zähler zurückgesetzt.'); }}>Zähler und Log zurücksetzen</Button>
          </div>
          <Check label="Diagnose-Modus dauerhaft" hint="Ausführliches Log, Bildrate und kleine Anzeige oben. Gilt bis zum Ausschalten, auch nach dem Schließen." checked={diagFlag.read()} onChange={(e) => { setVerbose(e.target.checked); setCopied(e.target.checked ? 'Diagnose-Modus an (gilt ab dem nächsten Start vollständig).' : 'Diagnose-Modus aus.'); }} />
        </Block>
      </>)}

      {tab === 'engine' && <EngineTab engine={engine} eng={eng} campaign={campaign} s={s} />}

      {tab === 'sync' && (<>
        <Facts items={[
          ['Zustand', String(sync.state ?? '–')], ['Zuletzt erfolgreich', sync.lastOkAgoS != null ? `vor ${sync.lastOkAgoS} s` : '–'],
          ['Offene Markierungen', num(n(sync.pendingOps))], ['Offene Notizen', num(n(sync.pendingNotes))],
          ['Fehlversuche', num(n(sync.failures))], ['Nächster Versuch', sync.retryScheduled ? ms(n(sync.backoffMs)) : '–'],
          ['Stand beim Server', num(n(store.cursor))], ['Uhrabweichung', store.clockOffsetMs != null ? ms(Math.abs(n(store.clockOffsetMs) ?? 0)) : '–'],
          ['Meine Markierungen', num(n(store.entries))], ['Überschrieben', num(c['store.conflicts'] ?? 0)],
        ]} />
        {typeof sync.lastError === 'string' && sync.lastError && <Notice tone="warn">Letzter Fehler: {sync.lastError}</Notice>}
        <Facts items={[
          ['Runden', num(c['sync.rounds'] ?? 0)], ['Gesendet / angenommen', `${num(c['sync.push.sent'] ?? 0)} / ${num(c['sync.push.accepted'] ?? 0)}`],
          ['Abgelehnt', num(c['sync.push.rejected'] ?? 0)], ['Empfangen', `${num(c['sync.pull.ops'] ?? 0)} in ${num(c['sync.pull.pages'] ?? 0)} Seiten`],
          ['Notizen gesendet / empfangen', `${num(c['notes.push.sent'] ?? 0)} / ${num(c['notes.pull.notes'] ?? 0)}`], ['Zurückgenommen', num(c['store.rollback'] ?? 0)],
          ['Gespeichert (IndexedDB)', `${num((c['idb.saved.all'] ?? 0) + (c['idb.saved.outbox'] ?? 0))}×`], ['Speichern fehlgeschlagen', num(Object.entries(c).filter(([k]) => k.startsWith('idb.failed.')).reduce((a, [, v]) => a + v, 0) + (c['store.save.failed'] ?? 0))],
        ]} />
        <Table label="Zeiten der Synchronisation" title="Zeit" rows={[['Runde', h['sync.round_ms'] ?? null], ['Senden', h['sync.push_ms'] ?? null], ['Abholen', h['sync.pull_ms'] ?? null], ['Speichern (alles)', h['idb.save.all_ms'] ?? null], ['Speichern (Warteschlange)', h['idb.save.outbox_ms'] ?? null], ['Laden beim Start', h['idb.load_ms'] ?? null], ['Hydrate', h['store.hydrate_ms'] ?? null]]} />
        <Block title="Letzte Runden">
          {arr(sync.rounds).length ? (
            <ul className="v5-d-rounds" aria-label="Letzte Synchronisationsrunden">
              {[...arr(sync.rounds)].reverse().slice(0, 15).map((r, i) => (
                <li key={i} className={String(r.result)}><span>{ago(n(r.at))}</span><span>{ms(n(r.ms))}</span><span>↑ {num(n(r.sent))} ↓ {num(n(r.pulled))}</span><span>{r.result === 'ok' ? 'ok' : r.result === 'failed' ? `Fehler${r.error ? `: ${String(r.error)}` : ''}` : 'Notizen fehlgeschlagen'}</span></li>
              ))}
            </ul>
          ) : <p className="v5-hint"><Icon name="info" size={20} />Noch keine Runde.</p>}
        </Block>
      </>)}

      {tab === 'net' && <NetTab s={s} P={P} />}

      {tab === 'map' && (<>
        <Facts items={[
          ['Bildrate', g['render.fps'] != null ? `${Math.round(g['render.fps'])} /s` : '–'], ['Langsamstes Bild (5 s)', ms(g['render.worstFrameMs5s'] ?? null)],
          ['Bilder über 32 ms', `${num(c['render.frames.over32ms'] ?? 0)} (über 100 ms: ${num(c['render.frames.over100ms'] ?? 0)})`], ['Blockiert (Longtasks)', `${num(c['longtask.n'] ?? 0)} · ${ms(h['longtask.ms']?.sum ?? null)}`],
          ['Speicher (JS)', g['mem.heapMb'] != null ? `${Math.round(g['mem.heapMb'])} von ${g['mem.heapLimitMb'] ?? '?'} MB` : 'nicht messbar'], ['Lokaler Speicher', g['storage.usageMb'] != null ? `${g['storage.usageMb']} von ${g['storage.quotaMb'] ?? '?'} MB` : '–'],
        ]} />
        <Block title="Karte">
          <Facts items={[
            ['Bibliothek', String(map.library ?? '–')], ['Darstellung', `${map.mode === 'tiles' ? 'Vektorkacheln' : map.mode === 'geojson' ? 'GeoJSON' : '–'} · ${map.theme ?? '–'}`],
            ['Ebenen / Quellen', `${num(n(map.layers))} / ${num(n(map.sources))}`], ['Anbieter', num(n(map.providers))],
            ['Geladene Kacheln', Object.entries(obj(map.tiles)).map(([k, v]) => `${k.replace('v5-', '')} ${v}`).join(' · ') || '–'], ['Gemalte Markierungen', num(n(map.painted))],
            ['Gerenderte Bilder', num(n(map.framesRendered))], ['Zoom', String(map.zoom ?? '–')],
            ['Grafik', `${String(obj(map.gl).renderer ?? obj(map.gl).version ?? 'unbekannt')}`], ['Grafik entzogen', num(n(map.contextLosses))],
            ['Grundkarte', map.styleFallback ? 'nicht erreichbar (einfacher Hintergrund)' : 'ok'], ['Kartenfehler', num(c['map.errors'] ?? 0)],
          ]} />
          <p className="v5-hint">Steigen „Ebenen“, „Quellen“ oder „Anbieter“ bei gleichen Handgriffen immer weiter, liegt ein Leck vor.</p>
        </Block>
        <Table label="Zeiten der Karte" title="Zeit" rows={[['Kachel erzeugen', h['map.tile_ms'] ?? null], ['Status malen (Änderung)', h['map.paint_ms'] ?? null], ['Status malen (Start)', h['map.restore_ms'] ?? null], ['Stil laden', h['map.style_ms'] ?? null]]} />
        <Table label="Größe der Kacheln" title="Größe" fmt={kb} rows={[['Kachel (Bytes)', h['engine.tile.bytes'] ?? null]]} />
        <Facts items={[['Kacheln gesamt', num(c['map.tiles'] ?? 0)], ['Leere Kacheln', num(c['map.tiles.empty'] ?? 0)], ['Kachelfehler', num(c['map.tiles.failed'] ?? 0)], ['Zeitweise sichtbare Markierungen', num(c['map.painted'] ?? 0)]]} />
      </>)}

      {tab === 'log' && <LogTab />}
    </SheetFrame>
  );
}

function deviceFacts(P: Record<string, unknown>): [string, React.ReactNode][] {
  const nav = typeof navigator === 'undefined' ? ({} as Navigator) : navigator;
  const conn = (nav as Navigator & { connection?: { effectiveType?: string; rtt?: number; downlink?: number } }).connection;
  const gl = obj(obj(P.map).gl);
  return [
    ['Browser', (nav.userAgent ?? '').replace(/^Mozilla\/5\.0 /, '').slice(0, 90)], ['Anzeige', `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}`],
    ['Prozessorkerne', String(nav.hardwareConcurrency ?? '–')], ['Arbeitsspeicher', (nav as Navigator & { deviceMemory?: number }).deviceMemory ? `${(nav as Navigator & { deviceMemory?: number }).deviceMemory} GB` : '–'],
    ['Verbindung', conn ? `${conn.effectiveType ?? '?'} · ${conn.downlink ?? '?'} Mbit/s · ${conn.rtt ?? '?'} ms` : 'nicht ermittelbar'], ['Sicherer Kontext', window.isSecureContext ? 'ja' : 'nein'],
    ['Grafikkarte', String(gl.renderer ?? '–')], ['WebAssembly', typeof WebAssembly === 'undefined' ? 'nein' : 'ja'],
  ];
}

function EngineTab({ engine, eng, campaign, s }: { engine: EngineClient | null; eng: Obj; campaign: Obj; s: ReturnType<typeof metrics.snapshot> }) {
  const [wasm, setWasm] = useState<{ wasmBytes: number; fulls: number } | null>(null);
  useEffect(() => {
    if (!engine) return;
    let live = true;
    const read = () => engine.stats().then((v) => { if (live) setWasm(v); }, () => {});
    void read();
    const id = window.setInterval(read, 2000);
    return () => { live = false; window.clearInterval(id); };
  }, [engine]);
  const c = s.counters, h = s.histograms;
  const ops = ['area', 'mapData', 'tile', 'route', 'lasso', 'search', 'snap', 'reset', 'stats', 'init'];
  const rows: HistRow[] = ops.flatMap((op) => [[`${op}`, h[`engine.${op}.rtt_ms`] ?? null] as HistRow, [`${op} · Rechenzeit`, h[`engine.${op}.compute_ms`] ?? null] as HistRow, [`${op} · Wartezeit`, h[`engine.${op}.queue_ms`] ?? null] as HistRow]);
  const areas = arr(campaign.areas);
  return (<>
    <Facts items={[
      ['Engine', String(eng.kind === 'wasm' ? 'Rust / WebAssembly' : eng.kind === 'ts' ? 'TypeScript' : '–')], ['Läuft in', eng.worker ? 'Web Worker' : 'Hauptthread'],
      ['WASM-Speicher', wasm ? kb(wasm.wasmBytes) : '–'], ['Gebiete im Speicher', wasm ? num(wasm.fulls) : '–'],
      ['Wartende Anfragen', num(n(eng.pending))], ['Anfragen gesamt', num(n(eng.requests))],
      ['Fehler', num(Object.entries(c).filter(([k]) => /^engine\..*\.failed$/.test(k)).reduce((a, [, v]) => a + v, 0))], ['Worker-Abstürze', num(c['engine.worker.crashed'] ?? 0)],
    ]} />
    {typeof eng.initError === 'string' && eng.initError && <Notice tone="warn">WASM nicht geladen: {eng.initError}</Notice>}
    <Table label="Zeiten der Engine" title="Aufruf" rows={rows} />
    <Block title="Kartenpaket-Cache">
      <Facts items={[['Treffer', num(c['cache.hit'] ?? 0)], ['Fehlgriffe', num(c['cache.miss'] ?? 0)], ['Gespeichert', num(c['cache.stored'] ?? 0)], ['Fehler', num((c['cache.load.failed'] ?? 0) + (c['cache.store.failed'] ?? 0))], ['Letzte Größe', kb(h['cache.store.bytes']?.last ?? h['cache.hit.bytes']?.last ?? null)], ['Laden (Median)', ms(h['cache.load_ms']?.p50 ?? null)]]} />
    </Block>
    <Block title="Gebiete (Straßen-Engine)">
      {areas.length ? areas.map((a) => {
        const d = obj(a.diagnostics), detail = obj(a.detail);
        return (
          <details key={String(a.n)} className="v5-d-area">
            <summary><b>Gebiet {String(a.n)}</b><span>{a.source === 'cache' ? 'Cache' : a.source === 'server' ? 'Server' : 'ohne Daten'} · {num(n(a.houses))} Häuser · {num(n(a.segments))} Straßen · {ms(n(a.deriveMs))}</span></summary>
            <Facts items={[
              ['Paket geladen', `${kb(n(a.packBytes))} in ${ms(n(a.fetchMs))}`], ['Entpacken', ms(n(detail.gunzip))], ['Rust rechnet', ms(n(detail.wasm ?? detail.blobWasm))], ['Ergebnis lesen', ms(n(detail.parse ?? detail.blobParse))],
              ['Wege im Paket', num(n(d.waysIn))], ['Straßenstücke', `${num(n(d.segments))} (sichtbar ${num(n(d.visibleSegments))})`], ['Durch Häuser aufgewertet', num(n(d.promotedByHouses))], ['Verdeckte Verbinder', num(n(d.hiddenConnectors))],
              ['Gebäude im Paket', num(n(d.buildingsIn))], ['Häuser erzeugt', num(n(d.housesOut))], ['Häuser ohne Straße', num(n(d.orphanHouses))],
              ['Wege ausgeschlossen', counts(obj(d.waysExcluded))], ['Gebäude übersprungen', counts(obj(d.buildingsSkipped))],
            ]} />
          </details>
        );
      }) : <p className="v5-hint"><Icon name="info" size={20} />Noch keine Gebiete berechnet.</p>}
    </Block>
  </>);
}
const counts = (o: Obj) => Object.entries(o).filter(([, v]) => typeof v === 'number' && v > 0).map(([k, v]) => `${k} ${v}`).join(' · ') || 'keine';

function NetTab({ s, P }: { s: ReturnType<typeof metrics.snapshot>; P: Record<string, unknown> }) {
  void P;
  const c = s.counters, g = s.gauges, h = s.histograms;
  const templates = [...new Set(Object.keys(h).filter((k) => k.startsWith('api.') && k.endsWith('.total_ms')).map((k) => k.slice(4, -9)))];
  const rows: HistRow[] = templates.map((t) => [t.replace('/api/v5/campaigns/:c', '…').replace('/api/campaigns/:c', '…'), h[`api.${t}.total_ms`] ?? null]);
  const details = templates.map((t) => ({ t, ttfb: h[`api.${t}.ttfb_ms`]?.p50 ?? null, bytes: h[`api.${t}.bytes`]?.p50 ?? null, server: h[`api.${t}.server.total`]?.p50 ?? null, serverDb: h[`api.${t}.server.db`]?.p50 ?? null }));
  const errorsFor = (t: string) => Object.entries(c).filter(([k]) => k.includes(` ${t}.status.`) && /\.status\.[45]xx$/.test(k)).reduce((a, [, v]) => a + v, 0) + Object.entries(c).filter(([k]) => k.endsWith(`${t}.failed`)).reduce((a, [, v]) => a + v, 0);
  const warnings = log.entries({ cat: 'net', min: 'warn', limit: 8 }).reverse();
  const nav = navigator as Navigator & { connection?: { effectiveType?: string; rtt?: number; downlink?: number; saveData?: boolean } };
  return (<>
    <Facts items={[
      ['Verbindung', g['net.online'] === 0 ? 'offline' : 'online'], ['Typ', nav.connection ? `${nav.connection.effectiveType ?? '?'} · ${nav.connection.downlink ?? '?'} Mbit/s · ${nav.connection.rtt ?? '?'} ms` : '–'],
      ['Anfragen', num(c['net.requests'] ?? 0)], ['Fehlgeschlagen', num(c['net.failed'] ?? 0)], ['Laufend', num(g['net.inflight'] ?? 0)], ['Wechsel online/offline', `${c['net.online.n'] ?? 0} / ${c['net.offline.n'] ?? 0}`],
    ]} />
    <Table label="Anfragen an den Server" title="Route" rows={rows} />
    {details.length > 0 && (
      <ul className="v5-d-rounds" aria-label="Details der Anfragen">
        {details.map((d) => <li key={d.t}><span className="name">{d.t.replace('/api/v5/campaigns/:c', '…').replace('/api/campaigns/:c', '…')}</span><span>Antwort {ms(d.ttfb)}</span><span>{kb(d.bytes)}</span><span>Server {ms(d.server)}{d.serverDb != null ? ` (Datenbank ${ms(d.serverDb)})` : ''}</span><span>{errorsFor(d.t) ? `${errorsFor(d.t)} Fehler` : 'ohne Fehler'}</span></li>)}
      </ul>
    )}
    <Block title="Geladene Dateien">
      <Facts items={(['js', 'css', 'wasm', 'image', 'font', 'api', 'other'] as const).filter((k) => c[`res.${k}.n`]).map((k): [string, React.ReactNode] => [k === 'api' ? 'Serverdaten' : k.toUpperCase(), `${c[`res.${k}.n`]} · ${kb(c[`res.${k}.bytes`] ?? 0)}`])} />
      <p className="v5-hint">Aus dem Browser-Cache: {c['res.cached'] ?? 0} Dateien.</p>
    </Block>
    <Block title="Letzte Netzwarnungen">
      {warnings.length ? <ul className="v5-d-rounds" aria-label="Netzwarnungen">{warnings.map((e) => <li key={e.seq}><span>{clock(e.t)}</span><span className="name">{e.msg}</span></li>)}</ul> : <p className="v5-hint"><Icon name="info" size={20} />Keine.</p>}
    </Block>
  </>);
}

function LogTab() {
  const [min, setMin] = useState<Level>('info');
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [text, setText] = useState('');
  const [, force] = useState(0);
  useEffect(() => log.subscribe(() => force((x) => x + 1)), []);
  const entries = log.entries({ min, cat, text, limit: 200 }).reverse();
  const previous = currentSession().previous?.entries ?? [];
  const [showPrev, setShowPrev] = useState(false);
  return (<>
    <Segmented<Level> label="Mindeststufe" value={min} onChange={setMin} options={[{ value: 'debug', label: 'Alles' }, { value: 'info', label: 'Info' }, { value: 'warn', label: 'Warnung' }, { value: 'error', label: 'Fehler' }]} />
    <div className="v5-d-filter">
      <Field label="Bereich"><Select value={cat} onChange={(e) => setCat(e.target.value as Category | 'all')}><option value="all">alle</option>{CATEGORIES.map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
      <Field label="Suche"><TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="Text im Log" inputMode="search" /></Field>
    </div>
    {!log.verbose && min === 'debug' && <p className="v5-hint"><Icon name="info" size={20} />Detailzeilen werden nur im Diagnose-Modus aufgezeichnet.</p>}
    <p className="v5-hint" aria-live="polite">{entries.length} Einträge · gesamt {log.counts.info} Info, {log.counts.warn} Warnungen, {log.counts.error} Fehler</p>
    <ul className="v5-d-log" aria-label="Log, neueste zuerst">{entries.map((e) => <LogLine key={e.seq} e={e} />)}</ul>
    {previous.length > 0 && (<>
      <Button tone="quiet" icon="info" onClick={() => setShowPrev((v) => !v)}>{showPrev ? 'Vorherige Sitzung ausblenden' : `Vorherige Sitzung: ${previous.length} Warnungen/Fehler`}</Button>
      {showPrev && <ul className="v5-d-log" aria-label="Log der vorherigen Sitzung">{[...previous].reverse().map((e) => <LogLine key={`p${e.seq}`} e={e} />)}</ul>}
    </>)}
  </>);
}

function LogLine({ e }: { e: Entry }) {
  const [open, setOpen] = useState(false);
  const hasData = e.data !== undefined && e.data !== null;
  return (
    <li className={`v5-d-line ${e.lvl}`}>
      <button type="button" className="v5-d-linebtn" onClick={() => hasData && setOpen((v) => !v)} aria-expanded={hasData ? open : undefined} disabled={!hasData}>
        <span className="t">{e.prev ? new Date(e.at).toLocaleTimeString('de') : clock(e.t)}</span><Chip>{e.cat}</Chip><span className="msg">{e.msg}</span>{hasData && <span className="more" aria-hidden>{open ? '–' : '+'}</span>}
      </button>
      {open && <pre className="v5-d-data">{JSON.stringify(e.data, null, 1)}</pre>}
    </li>
  );
}

/** The small always-visible readout of `?diag=1`: frame rate, memory, sync, problems. Tapping it opens the panel. */
export function DiagHud({ onOpen }: { onOpen: () => void }) {
  useTick(1000);
  const g = metrics.snapshot().gauges;
  const sync = obj(collectProbes().sync);
  const bad = log.counts.error > 0;
  return (
    <button type="button" className={`v5-hud${bad ? ' bad' : log.counts.warn ? ' warn' : ''}`} onClick={onOpen} aria-label="Diagnose öffnen">
      {g['render.fps'] != null ? `${Math.round(g['render.fps'])} fps` : '– fps'} · {g['mem.heapMb'] != null ? `${Math.round(g['mem.heapMb'])} MB` : '– MB'} · {g['net.online'] === 0 ? 'offline' : sync.state === 'syncing' ? 'sync …' : n(sync.pendingOps) ? `${sync.pendingOps} offen` : 'sync ✓'} · {log.counts.error}✕ {log.counts.warn}!
    </button>
  );
}
