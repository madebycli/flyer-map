import {
  canonicalStreetEngineV3SourceManifestJson,
  streetEngineV3SourceManifestHash,
  streetEngineV3SourceObjectKey,
  validateStreetEngineV3SourceManifest,
  type StreetEngineV3SourceManifest,
} from '../../src/domain/streetEngineV3SourcePack.ts';
import {
  resolveStreetEngineV3Manifest,
  sha256Bytes,
  streetEngineV3ManifestObjectKey,
  streetEngineV3PointerKey,
  type StreetEngineV3Bucket,
} from './v3SourceRuntime.ts';

export type StreetEngineV3SourcePackObjects = ReadonlyMap<string, Uint8Array>;

function requireWritableBucket(bucket: StreetEngineV3Bucket) {
  if (!bucket.put) throw new Error('street_engine_v3_bucket_read_only');
  return bucket.put.bind(bucket);
}

async function objectBytes(bucket: StreetEngineV3Bucket, key: string) {
  const object = await bucket.get(key);
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

async function putImmutableBytes(
  bucket: StreetEngineV3Bucket,
  key: string,
  expectedHash: string,
  bytes: Uint8Array,
) {
  if (await sha256Bytes(bytes) !== expectedHash) throw new Error('street_engine_v3_publish_shard_hash_mismatch');
  const existing = await objectBytes(bucket, key);
  if (existing) {
    if (existing.byteLength !== bytes.byteLength || await sha256Bytes(existing) !== expectedHash) {
      throw new Error('street_engine_v3_publish_immutable_conflict');
    }
    return false;
  }
  const put = requireWritableBucket(bucket);
  await put(key, bytes);
  const persisted = await objectBytes(bucket, key);
  if (!persisted || persisted.byteLength !== bytes.byteLength || await sha256Bytes(persisted) !== expectedHash) {
    throw new Error('street_engine_v3_publish_readback_failed');
  }
  return true;
}

async function putImmutableManifest(
  bucket: StreetEngineV3Bucket,
  manifestHash: string,
  canonicalManifest: string,
) {
  const key = streetEngineV3ManifestObjectKey(manifestHash);
  const existing = await bucket.get(key);
  if (existing) {
    if (await existing.text() !== canonicalManifest) throw new Error('street_engine_v3_publish_immutable_conflict');
    return false;
  }
  const put = requireWritableBucket(bucket);
  await put(key, canonicalManifest);
  const persisted = await bucket.get(key);
  if (!persisted || await persisted.text() !== canonicalManifest) {
    throw new Error('street_engine_v3_publish_readback_failed');
  }
  return true;
}

export async function verifyStreetEngineV3SourcePackObjects(input: {
  bucket: StreetEngineV3Bucket;
  manifest: StreetEngineV3SourceManifest;
  manifestHash?: string;
}) {
  const manifest = validateStreetEngineV3SourceManifest(input.manifest);
  const expectedManifestHash = input.manifestHash ?? await streetEngineV3SourceManifestHash(manifest);
  if (await streetEngineV3SourceManifestHash(manifest) !== expectedManifestHash) {
    throw new Error('street_engine_v3_publish_manifest_hash_mismatch');
  }
  const resolved = await resolveStreetEngineV3Manifest(input.bucket, 'beta', expectedManifestHash);
  if (resolved.manifestHash !== expectedManifestHash) throw new Error('street_engine_v3_publish_manifest_hash_mismatch');

  let compressedBytes = 0;
  for (const shard of manifest.shards) {
    const bytes = await objectBytes(input.bucket, streetEngineV3SourceObjectKey(shard.id));
    if (!bytes) throw new Error('street_engine_v3_publish_shard_missing');
    if (bytes.byteLength !== shard.compressedBytes) throw new Error('street_engine_v3_publish_shard_size_mismatch');
    if (await sha256Bytes(bytes) !== shard.id) throw new Error('street_engine_v3_publish_shard_hash_mismatch');
    compressedBytes += bytes.byteLength;
  }
  return { manifestHash: expectedManifestHash, shardCount: manifest.shards.length, compressedBytes };
}

/**
 * Publishes a source pack with pointer-last atomicity. Immutable content is
 * written and read back first. The mutable channel pointer is changed only
 * after every referenced object has been verified.
 */
export async function publishStreetEngineV3SourcePack(input: {
  bucket: StreetEngineV3Bucket;
  channel: string;
  manifest: StreetEngineV3SourceManifest;
  shardObjects: StreetEngineV3SourcePackObjects;
}) {
  const manifest = validateStreetEngineV3SourceManifest(input.manifest);
  const canonicalManifest = canonicalStreetEngineV3SourceManifestJson(manifest);
  const manifestHash = await streetEngineV3SourceManifestHash(manifest);
  const pointerKey = streetEngineV3PointerKey(input.channel);
  const put = requireWritableBucket(input.bucket);
  let uploadedShards = 0;

  for (const shard of manifest.shards) {
    const bytes = input.shardObjects.get(shard.id);
    if (!bytes) throw new Error('street_engine_v3_publish_shard_missing');
    if (bytes.byteLength !== shard.compressedBytes) throw new Error('street_engine_v3_publish_shard_size_mismatch');
    if (await putImmutableBytes(input.bucket, streetEngineV3SourceObjectKey(shard.id), shard.id, bytes)) uploadedShards += 1;
  }

  const uploadedManifest = await putImmutableManifest(input.bucket, manifestHash, canonicalManifest);
  const verified = await verifyStreetEngineV3SourcePackObjects({ bucket: input.bucket, manifest, manifestHash });

  const pointer = JSON.stringify({ schemaVersion: 1, channel: input.channel, manifestHash });
  await put(pointerKey, pointer);
  const resolved = await resolveStreetEngineV3Manifest(input.bucket, input.channel);
  if (resolved.manifestHash !== manifestHash) throw new Error('street_engine_v3_publish_pointer_verification_failed');

  return {
    manifestHash,
    shardCount: verified.shardCount,
    compressedBytes: verified.compressedBytes,
    uploadedShards,
    uploadedManifest,
  };
}
