import { EngineHost, type AreaRequest, type AreaResult, type EngineKind, type MapData } from '../engine/host.ts';
import type { LngLat } from '../engine/types.ts';
import type { EngineReply, EngineRequest } from './network.worker.ts';

type Pending = { resolve(reply: EngineReply): void; reject(error: Error): void };
type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never;

/**
 * Main-thread handle to the engine. The engine lives in a Web Worker (derivation and tile cutting never block the UI);
 * without Worker support it runs in-thread behind the same interface.
 */
export class EngineClient {
  kind: EngineKind = 'ts';
  private worker: Worker | null = null;
  private host: EngineHost | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private disposed = false;

  static async create(options: { forceTs?: boolean } = {}): Promise<EngineClient> {
    const client = new EngineClient();
    if (typeof Worker !== 'undefined') {
      client.worker = new Worker(new URL('./network.worker.ts', import.meta.url), { type: 'module' });
      client.worker.onmessage = (event: MessageEvent<EngineReply>) => {
        const waiting = client.pending.get(event.data.id);
        if (!waiting) return;
        client.pending.delete(event.data.id);
        if (event.data.error) waiting.reject(new Error(event.data.error)); else waiting.resolve(event.data);
      };
      client.worker.onerror = () => { for (const p of client.pending.values()) p.reject(new Error('engine_worker_failed')); client.pending.clear(); };
    } else client.host = new EngineHost();
    client.kind = (await client.call({ op: 'init', forceTs: !!options.forceTs })).kind ?? 'ts';
    return client;
  }

  private async call(request: Distribute<EngineRequest>, transfer: Transferable[] = []): Promise<EngineReply> {
    if (this.disposed) throw new Error('engine_disposed');
    const id = this.nextId++;
    const full = { ...request, id } as EngineRequest;
    if (this.host) {
      // Only without Worker support: the engine runs in-thread, loaded on demand so normal builds keep it out of the main chunk.
      const { handle } = await import('./network.worker.ts');
      const { reply } = await handle(this.host, full);
      if (reply.error) throw new Error(reply.error);
      return reply;
    }
    return new Promise<EngineReply>((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker!.postMessage(full, transfer); });
  }

  reset() { return this.call({ op: 'reset' }).then(() => undefined); }
  async area(request: AreaRequest): Promise<AreaResult> {
    // The buffers are handed over, not copied: a 12 MB pack should not be duplicated on its way to the Worker.
    const transfer = [request.pack?.buffer, request.blob?.buffer].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);
    return (await this.call({ op: 'area', ...request }, this.worker ? transfer : [])).area!;
  }
  async mapData(): Promise<MapData> { return (await this.call({ op: 'mapData' })).mapData!; }
  async tile(z: number, x: number, y: number): Promise<ArrayBuffer> { return (await this.call({ op: 'tile', z, x, y })).tile!; }
  async stats() { return (await this.call({ op: 'stats' })).stats!; }
  async snap(at: LngLat) { return (await this.call({ op: 'snap', at })).snap!; }

  dispose() {
    this.disposed = true;
    this.worker?.terminate();
    for (const p of this.pending.values()) p.reject(new Error('engine_disposed'));
    this.pending.clear();
  }
}
