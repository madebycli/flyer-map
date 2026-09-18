import type { StreetEngineV4Bucket } from './v4Preparation.ts';

const ASSET_PREFIX = '/__street-engine-v4';
const SAFE_KEY = /^[a-z0-9][a-z0-9._/-]{0,511}$/u;

export type StreetEngineV4AssetFetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export function streetEngineV4AssetPath(key: string) {
  if (!SAFE_KEY.test(key)
    || key.startsWith('/')
    || key.includes('..')
    || key.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('street_engine_v4_asset_key_invalid');
  }
  return `${ASSET_PREFIX}/${key}`;
}

/**
 * Adapts immutable Worker static assets to the existing V4 source-pack bucket
 * interface. No network provider or Cloudflare R2 API is involved at runtime.
 */
export function createStreetEngineV4AssetBucket(
  assets?: StreetEngineV4AssetFetcher,
): StreetEngineV4Bucket | undefined {
  if (!assets) return undefined;
  return {
    async get(key: string) {
      const response = await assets.fetch(new Request(
        `https://street-engine-v4.assets.invalid${streetEngineV4AssetPath(key)}`,
        { method: 'GET' },
      ));
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('street_engine_v4_asset_read_failed');
      return {
        arrayBuffer: () => response.clone().arrayBuffer(),
        text: () => response.clone().text(),
      };
    },
  };
}
