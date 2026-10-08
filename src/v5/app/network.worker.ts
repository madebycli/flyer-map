import { decodePack, deriveNetwork, restrictToArea, type Network } from '../engine/index.ts';

export type WorkerRequest = { areaId: string; pack: Uint8Array; ring: [number, number][] };
export type WorkerResponse = { areaId: string; network: Network } | { areaId: string; error: string };

/** Derivation is CPU work (≈0.5 s per 50 k houses on a fast CPU): keep it off the UI thread. */
export async function derive(request: WorkerRequest): Promise<Network> {
  return restrictToArea(deriveNetwork(await decodePack(request.pack)), request.ring);
}

if (typeof self !== 'undefined' && 'postMessage' in self && typeof (self as { document?: unknown }).document === 'undefined') {
  self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    try { (self as unknown as Worker).postMessage({ areaId: event.data.areaId, network: await derive(event.data) } satisfies WorkerResponse); }
    catch (error) { (self as unknown as Worker).postMessage({ areaId: event.data.areaId, error: error instanceof Error ? error.message : 'derive_failed' } satisfies WorkerResponse); }
  };
}
