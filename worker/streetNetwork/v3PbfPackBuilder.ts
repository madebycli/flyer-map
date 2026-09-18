import {
  canonicalStreetEngineV3SourceManifestJson,
  streetEngineV3SourceManifestHash,
  type StreetEngineV3Bounds,
  type StreetEngineV3SourceManifest,
} from '../../src/domain/streetEngineV3SourcePack.ts';
import type { LngLat } from '../../src/domain/campaign.ts';
import { addressBuildings, type AddressBuilding, type AddressNode } from './addresses.ts';
import type { RoadInput } from './geometry.ts';
import { encodeStreetEngineV3Shard, sha256Bytes } from './v3SourceRuntime.ts';

export type StreetEngineV3PbfFeature = {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry:
    | { type: 'Point'; coordinates: LngLat }
    | { type: 'LineString'; coordinates: LngLat[] }
    | { type: 'Polygon'; coordinates: LngLat[][] };
};

export type StreetEngineV3BuiltPbfPack = {
  manifest: StreetEngineV3SourceManifest;
  manifestHash: string;
  manifestJson: string;
  shardObjects: Map<string, Uint8Array>;
};

type Group = {
  nominalBounds: StreetEngineV3Bounds;
  roads: RoadInput[];
  buildings: AddressBuilding[];
  addressNodes: AddressNode[];
};

const CELL = 0.01;
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;

function tags(properties: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(properties)
    .filter(([key, value]) => !key.startsWith('@') && typeof value === 'string')) as Record<string, string>;
}

function osmId(properties: Record<string, unknown>) {
  const value = properties['@id'];
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error('street_engine_v3_pbf_invalid_id');
  return value as number;
}

function featurePoints(feature: StreetEngineV3PbfFeature): LngLat[] {
  if (feature.geometry.type === 'Point') return [feature.geometry.coordinates];
  if (feature.geometry.type === 'LineString') return feature.geometry.coordinates;
  return feature.geometry.coordinates.flat();
}

function featureCenter(feature: StreetEngineV3PbfFeature): LngLat {
  const points = featurePoints(feature);
  if (!points.length) throw new Error('street_engine_v3_pbf_empty_geometry');
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function cellIndex(value: number) {
  return Math.floor(value / CELL + 1e-9);
}

function keyForPoint(point: LngLat) {
  return `${cellIndex(point[1])}:${cellIndex(point[0])}`;
}

function boundsForIndex(ix: number, iy: number): StreetEngineV3Bounds {
  const west = ix * CELL;
  const south = iy * CELL;
  return [west, south, west + CELL, south + CELL];
}

function parseKey(key: string) {
  const [iy, ix] = key.split(':').map(Number);
  if (!Number.isSafeInteger(ix) || !Number.isSafeInteger(iy)) throw new Error('street_engine_v3_pbf_cell_invalid');
  return { ix, iy };
}

function ensureGroup(groups: Map<string, Group>, key: string) {
  let group = groups.get(key);
  if (!group) {
    const { ix, iy } = parseKey(key);
    group = { nominalBounds: boundsForIndex(ix, iy), roads: [], buildings: [], addressNodes: [] };
    groups.set(key, group);
  }
  return group;
}

function expandedBounds(group: Group): StreetEngineV3Bounds {
  const points: LngLat[] = [
    [group.nominalBounds[0], group.nominalBounds[1]],
    [group.nominalBounds[2], group.nominalBounds[3]],
  ];
  for (const road of group.roads) {
    if (road.geometry.type === 'LineString') points.push(...road.geometry.coordinates);
    else if (road.geometry.type === 'MultiLineString') points.push(...road.geometry.coordinates.flat());
    else for (const geometry of road.geometry.geometries) {
      if (geometry.type === 'LineString') points.push(...geometry.coordinates);
      else if (geometry.type === 'MultiLineString') points.push(...geometry.coordinates.flat());
    }
  }
  for (const building of group.buildings) points.push(...building.geometry.coordinates.flat());
  for (const node of group.addressNodes) points.push(node.point);
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const bounds: StreetEngineV3Bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (bounds[0] < -180 || bounds[2] > 180 || bounds[1] < -85 || bounds[3] > 85 || bounds[2] - bounds[0] > 180) {
    throw new Error('street_engine_v3_pbf_bounds_invalid');
  }
  return bounds;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function mergeConsistent<T extends { osmId: number }>(target: Map<number, T>, value: T, code: string) {
  const prior = target.get(value.osmId);
  if (prior && canonical(prior) !== canonical(value)) throw new Error(code);
  target.set(value.osmId, value);
}

export async function buildStreetEngineV3PbfPack(input: {
  features: Iterable<StreetEngineV3PbfFeature> | AsyncIterable<StreetEngineV3PbfFeature>;
  coverageBounds: StreetEngineV3Bounds;
  sourceTimestamp: string;
  provider?: string;
  /** V4 may inject its own compatible shard encoder without changing V3 runtime behavior. */
  encodeShard?: typeof encodeStreetEngineV3Shard;
}): Promise<StreetEngineV3BuiltPbfPack> {
  const [west, south, east, north] = input.coverageBounds;
  if (![west, south, east, north].every(Number.isFinite) || west < -180 || east > 180 || south < -85 || north > 85 || west > east || south > north) {
    throw new Error('street_engine_v3_pbf_coverage_invalid');
  }
  if (!ISO_UTC.test(input.sourceTimestamp) || Number.isNaN(Date.parse(input.sourceTimestamp))) {
    throw new Error('street_engine_v3_pbf_timestamp_invalid');
  }

  const groups = new Map<string, Group>();
  const minIx = cellIndex(west);
  const maxIx = Math.ceil(east / CELL - 1e-9) - 1;
  const minIy = cellIndex(south);
  const maxIy = Math.ceil(north / CELL - 1e-9) - 1;
  const cells = (maxIx - minIx + 1) * (maxIy - minIy + 1);
  if (!Number.isSafeInteger(cells) || cells < 1 || cells > 4096) throw new Error('street_engine_v3_pbf_coverage_budget');
  for (let iy = minIy; iy <= maxIy; iy++) {
    for (let ix = minIx; ix <= maxIx; ix++) ensureGroup(groups, `${iy}:${ix}`);
  }

  const roads = new Map<number, RoadInput>();
  const buildings = new Map<number, AddressBuilding>();
  const addressNodes = new Map<number, AddressNode>();
  for await (const feature of input.features) {
    if (!feature || feature.type !== 'Feature' || !feature.properties || !feature.geometry) {
      throw new Error('street_engine_v3_pbf_feature_invalid');
    }
    const objectType = feature.properties['@type'];
    const featureTags = tags(feature.properties);
    if (objectType === 'node' && feature.geometry.type === 'Point' && featureTags['addr:housenumber']) {
      const node: AddressNode = { osmId: osmId(feature.properties), point: feature.geometry.coordinates, tags: featureTags };
      mergeConsistent(addressNodes, node, 'street_engine_v3_pbf_address_conflict');
      continue;
    }
    if (objectType === 'way' && feature.geometry.type === 'LineString' && featureTags.highway) {
      const road: RoadInput = { osmId: osmId(feature.properties), tags: featureTags, geometry: feature.geometry };
      mergeConsistent(roads, road, 'street_engine_v3_pbf_road_conflict');
      continue;
    }
    if (objectType === 'way' && feature.geometry.type === 'Polygon' && featureTags.building) {
      const building: AddressBuilding = { osmId: osmId(feature.properties), tags: featureTags, geometry: feature.geometry };
      mergeConsistent(buildings, building, 'street_engine_v3_pbf_building_conflict');
    }
  }

  for (const road of roads.values()) {
    const feature: StreetEngineV3PbfFeature = { type: 'Feature', properties: {}, geometry: road.geometry as { type: 'LineString'; coordinates: LngLat[] } };
    ensureGroup(groups, keyForPoint(featureCenter(feature))).roads.push(road);
  }
  for (const building of buildings.values()) {
    const feature: StreetEngineV3PbfFeature = { type: 'Feature', properties: {}, geometry: building.geometry };
    ensureGroup(groups, keyForPoint(featureCenter(feature))).buildings.push(building);
  }
  for (const node of addressNodes.values()) ensureGroup(groups, keyForPoint(node.point)).addressNodes.push(node);

  const addressableIds = new Set(addressBuildings([...buildings.values()], [...addressNodes.values()]).map((building) => building.osmId));
  const shardObjects = new Map<string, Uint8Array>();
  const shards = [];
  for (const [key, group] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    group.roads.sort((left, right) => left.osmId - right.osmId);
    group.buildings.sort((left, right) => left.osmId - right.osmId);
    group.addressNodes.sort((left, right) => left.osmId - right.osmId);
    const bounds = expandedBounds(group);
    const encoded = await (input.encodeShard ?? encodeStreetEngineV3Shard)({
      schemaVersion: 1,
      bounds,
      roads: group.roads,
      buildings: group.buildings,
      addressNodes: group.addressNodes,
    });
    shardObjects.set(encoded.id, encoded.bytes);
    shards.push({
      id: encoded.id,
      bounds,
      compressedBytes: encoded.bytes.byteLength,
      uncompressedBytes: encoded.uncompressedBytes,
      counts: {
        roads: group.roads.length,
        buildings: group.buildings.length,
        addressableBuildings: group.buildings.filter((building) => addressableIds.has(building.osmId)).length,
        addressNodes: group.addressNodes.length,
        roadCandidates: group.roads.length,
      },
    });
  }

  const identity = new TextEncoder().encode(`${input.sourceTimestamp}:${shards.map((shard) => shard.id).sort().join(':')}`);
  const sourcePackVersion = `pbf-${(await sha256Bytes(identity)).slice(0, 24)}`;
  const manifest: StreetEngineV3SourceManifest = {
    schemaVersion: 1,
    format: 'street-engine-v3-binary-shard-v1',
    coverageId: 'beta-pbf-area-pack',
    sourcePackVersion,
    algorithmVersion: 'v3-pbf-builder-1',
    source: {
      dataset: 'OpenStreetMap',
      provider: input.provider ?? 'osm-pbf',
      timestamp: input.sourceTimestamp,
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
    },
    coverageBounds: [input.coverageBounds],
    shards,
  };
  const manifestJson = canonicalStreetEngineV3SourceManifestJson(manifest);
  const manifestHash = await streetEngineV3SourceManifestHash(manifest);
  return { manifest, manifestHash, manifestJson, shardObjects };
}
