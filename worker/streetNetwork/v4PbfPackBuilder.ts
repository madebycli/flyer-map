import {
  canonicalStreetEngineV3SourceManifestJson,
  streetEngineV3SourceManifestHash,
  type StreetEngineV3Bounds,
} from '../../src/domain/streetEngineV3SourcePack.ts';
import type { LngLat } from '../../src/domain/campaign.ts';
import {
  buildStreetEngineV3PbfPack,
  type StreetEngineV3BuiltPbfPack,
  type StreetEngineV3PbfFeature,
} from './v3PbfPackBuilder.ts';

export type StreetEngineV4PbfFeature = {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry:
    | { type: 'Point'; coordinates: LngLat }
    | { type: 'LineString'; coordinates: LngLat[] }
    | { type: 'Polygon'; coordinates: LngLat[][] }
    | { type: 'MultiPolygon'; coordinates: LngLat[][][] };
};

type PendingBuilding = {
  sourceType: 'way' | 'relation';
  sourceId: number;
  component: number;
  properties: Record<string, unknown>;
  geometry: { type: 'Polygon'; coordinates: LngLat[][] };
};

const SUPPORTED_GEOMETRIES = new Set(['Point', 'LineString', 'Polygon', 'MultiPolygon']);

function isBuilding(properties: Record<string, unknown>) {
  return typeof properties.building === 'string' && properties.building.length > 0;
}

function sourceIdentity(properties: Record<string, unknown>) {
  const sourceType = properties['@type'];
  const sourceId = properties['@id'];
  if ((sourceType !== 'way' && sourceType !== 'relation')
    || !Number.isSafeInteger(sourceId)
    || (sourceId as number) <= 0) {
    throw new Error('street_engine_v4_pbf_building_identity_invalid');
  }
  return { sourceType, sourceId: sourceId as number };
}

const SYNTHETIC_COMPONENT_STRIDE = 1024;
const SYNTHETIC_WAY_BASE = 3_000_000_000_000_000;
const SYNTHETIC_RELATION_BASE = 6_000_000_000_000_000;

function syntheticBuildingId(sourceType: 'way' | 'relation', sourceId: number, component: number) {
  if (!Number.isSafeInteger(component) || component < 0 || component >= SYNTHETIC_COMPONENT_STRIDE) {
    throw new Error('street_engine_v4_pbf_component_budget');
  }
  const base = sourceType === 'relation' ? SYNTHETIC_RELATION_BASE : SYNTHETIC_WAY_BASE;
  const maximumSourceId = Math.floor((Number.MAX_SAFE_INTEGER - base - SYNTHETIC_COMPONENT_STRIDE) / SYNTHETIC_COMPONENT_STRIDE);
  if (sourceId > maximumSourceId) throw new Error('street_engine_v4_pbf_synthetic_id_budget');
  const id = base + sourceId * SYNTHETIC_COMPONENT_STRIDE + component;
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('street_engine_v4_pbf_synthetic_id_budget');
  return id;
}

export function parseStreetEngineV4GeoJsonSeq(raw: string): StreetEngineV4PbfFeature[] {
  const features: StreetEngineV4PbfFeature[] = [];
  for (const rawLine of raw.split(/\r?\n/u)) {
    const line = rawLine.replace(/^\u001e/u, '').trim();
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error('street_engine_v4_pbf_geojsonseq_invalid');
    }
    if (!value || typeof value !== 'object' || (value as { type?: unknown }).type !== 'Feature') {
      throw new Error('street_engine_v4_pbf_geojsonseq_invalid');
    }
    const feature = value as {
      type: 'Feature';
      properties?: unknown;
      geometry?: { type?: unknown; coordinates?: unknown } | null;
    };
    const properties = feature.properties && typeof feature.properties === 'object' && !Array.isArray(feature.properties)
      ? feature.properties as Record<string, unknown>
      : {};
    const geometryType = feature.geometry?.type;
    if (typeof geometryType === 'string' && SUPPORTED_GEOMETRIES.has(geometryType)) {
      features.push(value as StreetEngineV4PbfFeature);
      continue;
    }
    if (isBuilding(properties)) {
      throw new Error('street_engine_v4_pbf_building_geometry_unsupported');
    }
  }
  return features;
}

/**
 * V4 keeps the established binary shard codec for compatibility, but normalizes
 * osmium area output before handing it to that codec. In particular, osmium
 * exports multipolygon relations as MultiPolygon. V3 silently dropped those.
 *
 * Relation/MultiPolygon components receive deterministic synthetic internal
 * IDs above the largest source ID. Original OSM identity is retained in tags so
 * a future V4 shard-schema revision can promote it without ambiguity.
 */
export function normalizeStreetEngineV4PbfFeatures(
  features: StreetEngineV4PbfFeature[],
): StreetEngineV3PbfFeature[] {
  const direct: StreetEngineV3PbfFeature[] = [];
  const pending: PendingBuilding[] = [];

  for (const feature of features) {
    if (feature.geometry.type === 'Point' || feature.geometry.type === 'LineString') {
      direct.push(feature as StreetEngineV3PbfFeature);
      continue;
    }

    if (!isBuilding(feature.properties)) {
      continue;
    }

    const { sourceType, sourceId } = sourceIdentity(feature.properties);
    if (feature.geometry.type === 'Polygon' && sourceType === 'way') {
      direct.push(feature as StreetEngineV3PbfFeature);
      continue;
    }

    const polygons = feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;

    polygons.forEach((coordinates, component) => {
      pending.push({
        sourceType,
        sourceId,
        component,
        properties: feature.properties,
        geometry: { type: 'Polygon', coordinates },
      });
    });
  }

  pending.sort((left, right) =>
    left.sourceType.localeCompare(right.sourceType)
    || left.sourceId - right.sourceId
    || left.component - right.component);

  const usedIds = new Set(features.flatMap((feature) => {
    const id = feature.properties['@id'];
    return Number.isSafeInteger(id) && (id as number) > 0 ? [id as number] : [];
  }));
  for (const building of pending) {
    const syntheticId = syntheticBuildingId(building.sourceType, building.sourceId, building.component);
    if (usedIds.has(syntheticId)) throw new Error('street_engine_v4_pbf_synthetic_id_collision');
    usedIds.add(syntheticId);
    direct.push({
      type: 'Feature',
      properties: {
        ...building.properties,
        '@type': 'way',
        '@id': syntheticId,
        'v4:source_type': building.sourceType,
        'v4:source_id': String(building.sourceId),
        'v4:source_component': String(building.component),
      },
      geometry: building.geometry,
    });
  }

  return direct;
}

export async function buildStreetEngineV4PbfPack(input: {
  features: StreetEngineV4PbfFeature[];
  coverageBounds: StreetEngineV3Bounds;
  sourceTimestamp: string;
  provider?: string;
}): Promise<StreetEngineV3BuiltPbfPack> {
  const built = await buildStreetEngineV3PbfPack({
    ...input,
    features: normalizeStreetEngineV4PbfFeatures(input.features),
  });
  const manifest = { ...built.manifest, algorithmVersion: 'v4-pbf-builder-2' };
  const manifestJson = canonicalStreetEngineV3SourceManifestJson(manifest);
  const manifestHash = await streetEngineV3SourceManifestHash(manifest);
  return { ...built, manifest, manifestJson, manifestHash };
}
