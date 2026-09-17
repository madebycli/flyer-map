import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildStreetEngineV3CachePack, type StreetEngineV3CacheRow } from '../worker/streetNetwork/v3CachePackBuilder.ts';
import { streetEngineV3SourceObjectKey } from '../src/domain/streetEngineV3SourcePack.ts';
import { streetEngineV3ManifestObjectKey, streetEngineV3PointerKey } from '../worker/streetNetwork/v3SourceRuntime.ts';

function rowsFromWranglerJson(raw: string): StreetEngineV3CacheRow[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('street_engine_v3_cache_export_invalid_json'); }
  const envelopes = Array.isArray(parsed) ? parsed : [parsed];
  const rows: StreetEngineV3CacheRow[] = [];
  for (const envelope of envelopes) {
    if (!envelope || typeof envelope !== 'object') continue;
    const results = (envelope as { results?: unknown }).results;
    if (!Array.isArray(results)) continue;
    rows.push(...results as StreetEngineV3CacheRow[]);
  }
  if (!rows.length) throw new Error('street_engine_v3_cache_export_empty');
  return rows;
}

const [, , inputArg, outputArg = '/tmp/street-engine-v3-pack', channelArg = 'beta'] = process.argv;
if (!inputArg) {
  console.error('usage: node --experimental-transform-types scripts/build-street-engine-v3-cache-pack.ts <wrangler-d1-json> [output-dir] [channel]');
  process.exit(2);
}

const inputPath = resolve(inputArg);
const outputDir = resolve(outputArg);
const pack = await buildStreetEngineV3CachePack(rowsFromWranglerJson(await readFile(inputPath, 'utf8')));
const shardDir = resolve(outputDir, 'shards');
await rm(outputDir, { recursive: true, force: true });
await mkdir(shardDir, { recursive: true });

for (const [id, bytes] of pack.shardObjects) {
  await writeFile(resolve(shardDir, `${id}.bin`), bytes);
}

const pointer = JSON.stringify({ schemaVersion: 1, channel: channelArg, manifestHash: pack.manifestHash });
await writeFile(resolve(outputDir, 'manifest.json'), pack.manifestJson);
await writeFile(resolve(outputDir, 'pointer.json'), pointer);
const summary = {
  channel: channelArg,
  manifestHash: pack.manifestHash,
  manifestKey: streetEngineV3ManifestObjectKey(pack.manifestHash),
  pointerKey: streetEngineV3PointerKey(channelArg),
  sourcePackVersion: pack.manifest.sourcePackVersion,
  sourceTimestamp: pack.manifest.source.timestamp,
  shardCount: pack.manifest.shards.length,
  compressedBytes: pack.manifest.shards.reduce((sum, shard) => sum + shard.compressedBytes, 0),
  shards: pack.manifest.shards.map((shard) => ({
    id: shard.id,
    key: streetEngineV3SourceObjectKey(shard.id),
    file: `shards/${shard.id}.bin`,
    compressedBytes: shard.compressedBytes,
    counts: shard.counts,
  })),
};
await writeFile(resolve(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary));
