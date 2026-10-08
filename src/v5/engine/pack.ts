import type { RawOsm } from './types.ts';

/** Compact transport format of a raw Area pack: JSON, gzip. Works in browsers, Workers and Node 22. */
export async function encodePack(raw: RawOsm): Promise<Uint8Array> {
  const stream = new Blob([JSON.stringify(raw)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodePack(bytes: Uint8Array): Promise<RawOsm> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  const value = JSON.parse(await new Response(stream).text()) as RawOsm;
  if (!Array.isArray(value?.ways) || !Array.isArray(value.buildings) || !Array.isArray(value.addresses)) throw new Error('pack_invalid');
  return value;
}
