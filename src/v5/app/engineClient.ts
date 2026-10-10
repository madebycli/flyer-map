import { EngineHost, type AreaRequest, type AreaResult, type EngineKind, type MapData } from '../engine/host.ts';
import type { LngLat } from '../engine/types.ts';
import type { EngineReply, EngineRequest } from './network.worker.ts';
import { diag } from '../diag/index.ts';

type Pending = { resolve(reply: EngineReply): void; reject(error: Error): void };
type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never;

/**
 * Main-thread handle to the engine. The engine lives in a Web Worker (derivation and tile cutting never block the UI);
 * without Worker support it runs in-thread behind the same interface.
 */
export class EngineClient {
  kind: EngineKind = 'ts';
  initError: string | null = null;
  private worker: Worker | null = null;
  private stopProbe: (() => void) | null = null;
  private host: EngineHost | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private disposed = false;

  static async create(options: { forceTs?: boolean } = {}): Promise<EngineClient> {
    const client = new EngineClient();
    const done = diag.start('engine.create_ms');
    if (typeof Worker !== 'undefined') {
      client.worker = new Worker(new URL('./network.worker.ts', import.meta.url), { type: 'module' });
      client.worker.onmessage = (event: MessageEvent<EngineReply>) => {
        const waiting = client.pending.get(event.data.id);
        if (!waiting) return;
        client.pending.delete(event.data.id);
        if (event.data.error) waiting.reject(new Error(event.data.error)); else waiting.resolve(event.data);
      };
      client.worker.onerror = (event) => {
        diag.error('engine', 'the engine worker crashed', { message: event.message, where: `${(event.filename ?? '').split('/').pop()}:${event.lineno}` });
        diag.inc('engine.worker.crashed');
        for (const p of client.pending.values()) p.reject(new Error('engine_worker_failed'));
        client.pending.clear();
      };
    } else { client.host = new EngineHost(); diag.warn('engine', 'no Web Worker: the engine runs on the main thread'); }
    const init = await client.call({ op: 'init', forceTs: !!options.forceTs });
    client.kind = init.kind ?? 'ts';
    client.initError = init.initError ?? null;
    const ms = Math.round(done());
    diag.set('engine.wasm', client.kind === 'wasm' ? 1 : 0);
    if (client.kind === 'wasm') diag.info('engine', 'Rust/WASM engine ready', { ms, worker: !!client.worker });
    else if (options.forceTs) diag.info('engine', 'TypeScript engine (requested with ?engine=ts)', { ms });
    else diag.warn('engine', 'the Rust/WASM engine could not be loaded: TypeScript engine in use (slower)', { reason: client.initError, ms });
    client.stopProbe = diag.probe('engine', () => ({ kind: client.kind, initError: client.initError, worker: !!client.worker, pending: client.pending.size, requests: client.nextId - 1, disposed: client.disposed }));
    return client;
  }

  /** Every request is measured twice: round trip as the app sees it, and compute time inside the engine (the difference is queueing and message passing). */
  private async call(request: Distribute<EngineRequest>, transfer: Transferable[] = []): Promise<EngineReply> {
    if (this.disposed) throw new Error('engine_disposed');
    const id = this.nextId++;
    const full = { ...request, id } as EngineRequest;
    const op = request.op;
    const t0 = performance.now();
    diag.inc(`engine.${op}.n`);
    if (op !== 'tile') diag.set('engine.pending', this.pending.size + 1);
    try {
      let reply: EngineReply;
      if (this.host) {
        // Only without Worker support: the engine runs in-thread, loaded on demand so normal builds keep it out of the main chunk.
        const { handle } = await import('./network.worker.ts');
        reply = (await handle(this.host, full)).reply;
        if (reply.error) throw new Error(reply.error);
      } else reply = await new Promise<EngineReply>((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker!.postMessage(full, transfer); });
      const rtt = performance.now() - t0;
      diag.observe(`engine.${op}.rtt_ms`, rtt);
      if (reply.ms !== undefined) { diag.observe(`engine.${op}.compute_ms`, reply.ms); diag.observe(`engine.${op}.queue_ms`, Math.max(0, rtt - reply.ms)); }
      if (op !== 'tile' && rtt > 1500) diag.warn('engine', `${op} was slow`, { rtt: Math.round(rtt), compute: reply.ms });
      return reply;
    } catch (error) {
      diag.inc(`engine.${op}.failed`);
      diag.error('engine', `${op} failed`, { error: error instanceof Error ? error.message : String(error), ms: Math.round(performance.now() - t0) });
      throw error;
    } finally { if (op !== 'tile') diag.set('engine.pending', this.pending.size); }
  }

  reset() { return this.call({ op: 'reset' }).then(() => undefined); }
  async area(request: AreaRequest): Promise<AreaResult> {
    // The buffers are handed over, not copied: a 12 MB pack should not be duplicated on its way to the Worker.
    const transfer = [request.pack?.buffer, request.blob?.buffer].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);
    return (await this.call({ op: 'area', ...request }, this.worker ? transfer : [])).area!;
  }
  async mapData(): Promise<MapData> { return (await this.call({ op: 'mapData' })).mapData!; }
  async tile(z: number, x: number, y: number): Promise<ArrayBuffer> {
    const tile = (await this.call({ op: 'tile', z, x, y })).tile!;
    diag.observe('engine.tile.bytes', tile.byteLength);
    if (!tile.byteLength) diag.inc('engine.tile.empty');
    return tile;
  }
  async stats() { return (await this.call({ op: 'stats' })).stats!; }
  async lasso(ring: LngLat[], housesOnly: boolean) { return (await this.call({ op: 'lasso', ring, housesOnly })).lasso!; }
  async search(query: string, limit = 30) { return (await this.call({ op: 'search', query, limit })).search!; }
  async route(anchors: string[]) { return (await this.call({ op: 'route', anchors })).route!; }
  async snap(at: LngLat) { return (await this.call({ op: 'snap', at })).snap!; }

  dispose() {
    this.disposed = true;
    this.stopProbe?.();
    this.worker?.terminate();
    for (const p of this.pending.values()) p.reject(new Error('engine_disposed'));
    this.pending.clear();
  }
}
