import type { Metrics } from './metrics.ts';

export type Finding = { level: 'error' | 'warn' | 'info' | 'ok'; text: string };
export type FindingsInput = { metrics: ReturnType<Metrics['snapshot']>; subsystems: Record<string, unknown> };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sec = (ms: number) => `${Math.round(ms / 100) / 10} s`;

/**
 * Reads the numbers and says in plain German what is wrong, in order of importance. Pure: the same input gives the same list, so it is
 * tested without a browser. Thresholds are deliberately round numbers a field worker can relate to.
 */
export function findings({ metrics, subsystems }: FindingsInput): Finding[] {
  const out: Finding[] = [];
  const c = metrics.counters, g = metrics.gauges, h = metrics.histograms;
  const sync = obj(subsystems.sync), engine = obj(subsystems.engine), store = obj(obj(subsystems.campaign).store);
  const sumPrefix = (prefix: string) => Object.entries(c).filter(([k]) => k.startsWith(prefix)).reduce((n, [, v]) => n + v, 0);

  const idbFailed = sumPrefix('idb.failed.') + (c['store.save.failed'] ?? 0);
  if (idbFailed > 0) out.push({ level: 'error', text: `Lokales Speichern ist ${idbFailed}× fehlgeschlagen (Speicher voll oder privater Modus?). Markierungen könnten bei einem Neustart verloren gehen, solange sie nicht gesendet sind.` });
  const errors = (c['errors.window'] ?? 0) + (c['errors.unhandledRejection'] ?? 0);
  if (errors > 0) out.push({ level: 'error', text: `${errors} unerwartete Fehler in der App. Details im Log (Stufe „Fehler“).` });
  if ((c['map.tiles.failed'] ?? 0) + (c['engine.tile.failed'] ?? 0) > 0) out.push({ level: 'error', text: 'Kartenkacheln konnten nicht erzeugt werden. Straßen und Häuser fehlen eventuell auf der Karte.' });

  if (g['engine.wasm'] === 0) {
    const reason = typeof engine.initError === 'string' && engine.initError ? ` Grund: ${engine.initError}.` : '';
    out.push({ level: 'warn', text: `Die schnelle Rust/WASM-Engine läuft nicht: es wird die langsamere TypeScript-Engine benutzt.${reason}` });
  }
  const failures = num(sync.failures) ?? 0;
  if (failures > 0) out.push({ level: 'warn', text: `Die Synchronisation schlägt fehl (${failures} Versuche, nächster in ${sec(num(sync.backoffMs) ?? 0)}).${typeof sync.lastError === 'string' && sync.lastError ? ` Letzter Fehler: ${sync.lastError}` : ''}` });
  const pending = num(sync.pendingOps) ?? 0;
  const lastOk = num(sync.lastOkAgoS);
  if (pending > 0 && g['net.online'] !== 0 && failures === 0 && lastOk !== null && lastOk > 120) out.push({ level: 'warn', text: `${pending} Markierungen warten seit über 2 Minuten auf das Senden, obwohl das Gerät online ist.` });
  const skew = num(store.clockOffsetMs);
  if (skew !== null && Math.abs(skew) > 5000) out.push({ level: 'warn', text: `Die Uhr des Geräts weicht um ${sec(Math.abs(skew))} von der Serveruhr ab. Die Reihenfolge der Markierungen wird automatisch korrigiert.` });

  const usage = g['storage.usageMb'], quota = g['storage.quotaMb'];
  if (usage !== undefined && quota && usage / quota > 0.9) out.push({ level: 'warn', text: `Der lokale Speicher ist zu ${Math.round((usage / quota) * 100)} % voll.` });
  if ((c['cache.store.failed'] ?? 0) > 0) out.push({ level: 'warn', text: 'Der Kartencache lässt sich nicht speichern: der Start wird bei jedem Öffnen langsamer.' });
  const fps = g['render.fps'];
  if (fps !== undefined && fps > 0 && fps < 20) out.push({ level: 'warn', text: `Die Karte läuft mit nur ${Math.round(fps)} Bildern pro Sekunde.` });
  const heap = g['mem.heapMb'], limit = g['mem.heapLimitMb'];
  if (heap !== undefined && limit && heap / limit > 0.8) out.push({ level: 'warn', text: `Der Arbeitsspeicher der Seite ist zu ${Math.round((heap / limit) * 100)} % belegt.` });
  const ready = h['boot.ready_ms']?.last;
  if (ready !== undefined && ready > 8000) out.push({ level: 'warn', text: `Der Start dauerte ${sec(ready)}.` });
  const requests = c['net.requests'] ?? 0, failed = c['net.failed'] ?? 0;
  if (requests >= 5 && failed / requests > 0.2) out.push({ level: 'warn', text: `${failed} von ${requests} Anfragen an den Server sind fehlgeschlagen.` });
  if ((c['map.contextLost'] ?? 0) > 0) out.push({ level: 'warn', text: `Die Grafik wurde ${c['map.contextLost']}× vom Browser entzogen (wenig Grafikspeicher). Die Karte stellt sich selbst wieder her.` });

  if (g['net.online'] === 0) out.push({ level: 'info', text: `Das Gerät ist offline. Markierungen werden gespeichert (${pending} warten) und später gesendet.` });
  if ((c['map.styleFallback'] ?? 0) > 0) out.push({ level: 'info', text: 'Die Grundkarte war nicht erreichbar: es wird der einfache Hintergrund benutzt. Die Arbeit ist nicht betroffen.' });
  if ((c['store.conflicts'] ?? 0) > 0) out.push({ level: 'info', text: `${c['store.conflicts']}× wurde eine eigene Markierung durch eine neuere einer anderen Person ersetzt.` });
  if ((c['longtask.n'] ?? 0) > 20 && (h['longtask.ms']?.sum ?? 0) > 2000) out.push({ level: 'info', text: `Die Seite war ${c['longtask.n']}× länger als 50 ms blockiert (zusammen ${sec(h['longtask.ms'].sum)}).` });

  if (!out.length) out.push({ level: 'ok', text: 'Alles unauffällig.' });
  return out;
}
