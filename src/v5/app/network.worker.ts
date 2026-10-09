import { EngineHost, type AreaRequest, type AreaResult, type EngineKind, type MapData } from '../engine/host.ts';
import type { LngLat } from '../engine/types.ts';

export type EngineRequest =
  | { id: number; op: 'init'; forceTs: boolean }
  | { id: number; op: 'reset' }
  | { id: number; op: 'stats' }
  | ({ id: number; op: 'area' } & AreaRequest)
  | { id: number; op: 'mapData' }
  | { id: number; op: 'tile'; z: number; x: number; y: number }
  | { id: number; op: 'snap'; at: LngLat }
  | { id: number; op: 'route'; anchors: string[] };
export type EngineReply = { id: number; error?: string; kind?: EngineKind; area?: AreaResult; mapData?: MapData; tile?: ArrayBuffer; snap?: ReturnType<EngineHost['snap']>; route?: ReturnType<EngineHost['route']>; stats?: ReturnType<EngineHost['stats']> };

const wasmUrl = () => fetch(new URL('../engine/wasm/engine.wasm', import.meta.url));

/** One request → one reply; shared by the Worker and the in-thread fallback. */
export async function handle(host: EngineHost, req: EngineRequest): Promise<{ reply: EngineReply; transfer: Transferable[] }> {
  try {
    switch (req.op) {
      case 'init': return { reply: { id: req.id, kind: await host.init(req.forceTs ? null : wasmUrl) }, transfer: [] };
      case 'stats': return { reply: { id: req.id, stats: host.stats() }, transfer: [] };
      case 'reset': host.reset(); return { reply: { id: req.id }, transfer: [] };
      case 'area': {
        const area = await host.area(req);
        return { reply: { id: req.id, area }, transfer: area.blob ? [area.blob.buffer] : [] };
      }
      case 'mapData': return { reply: { id: req.id, mapData: host.mapData() }, transfer: [] };
      case 'tile': {
        const bytes = host.tile(req.z, req.x, req.y);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        return { reply: { id: req.id, tile: buffer }, transfer: [buffer] };
      }
      case 'route': return { reply: { id: req.id, route: host.route(req.anchors) }, transfer: [] };
      case 'snap': return { reply: { id: req.id, snap: host.snap(req.at) }, transfer: [] };
    }
  } catch (error) {
    return { reply: { id: req.id, error: error instanceof Error ? error.message : 'engine_failed' }, transfer: [] };
  }
}

if (typeof self !== 'undefined' && 'postMessage' in self && typeof (self as { document?: unknown }).document === 'undefined') {
  const host = new EngineHost();
  self.onmessage = async (event: MessageEvent<EngineRequest>) => {
    const { reply, transfer } = await handle(host, event.data);
    (self as unknown as Worker).postMessage(reply, transfer);
  };
}
