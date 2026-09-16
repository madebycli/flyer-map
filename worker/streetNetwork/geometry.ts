import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import InteriorPointArea from 'jsts/org/locationtech/jts/algorithm/InteriorPointArea.js';
import type { DistributionTask, HouseTask, LineStringGeometry, LngLat, PolygonGeometry } from '../../src/domain/campaign.ts';
import { RoadIndex, networkNodeKey, roadLength, type RoadNetwork } from '../../src/domain/streetNetwork.ts';
import { stablePreparedStreetTaskId, canonicalStreetFragmentGeometryJson } from '../streetNetwork/reconcile.ts';

export type RoadInput = { osmId: number; tags: Record<string, string>; geometry: LinearInput };
export type LinearInput = LineStringGeometry | { type: 'MultiLineString'; coordinates: LngLat[][] } | { type: 'GeometryCollection'; geometries: LinearInput[] };
export type StreetEngineRoadMetadata = {
  highway: string;
  service?: string;
  junction?: string;
  access?: string;
  deliveryClass: 'classic' | 'address-access-candidate';
};
type PersistedRoadNetwork = RoadNetwork & { street?: StreetEngineRoadMetadata };
const reader = new GeoJSONReader();
const writer = new GeoJSONWriter();
const allowedRoads = new Set(['residential', 'living_street', 'service', 'unclassified', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link', 'pedestrian', 'footway', 'path', 'steps']);
export const DELIVERY_V3_MAX_ACCESS_WAY_METERS = 180;
export const DELIVERY_V3_MAX_ACCESS_WAYS = 6000;
export function eligibleRoad(tags: Record<string, string>) {
  return allowedRoads.has(tags.highway) && !['no', 'private'].includes(tags.foot ?? tags.access ?? '') && !['driveway', 'parking_aisle'].includes(tags.service ?? '');
}
/** V3 keeps short residential driveways as hidden source candidates without changing V1/V2 output. */
export function eligibleDeliveryV3AccessRoad(tags: Record<string, string>) {
  return tags.highway === 'service'
    && tags.service === 'driveway'
    && !['no', 'private'].includes(tags.access ?? '');
}
function lines(input: LinearInput): LineStringGeometry[] {
  if (input.type === 'GeometryCollection') return input.geometries.flatMap(lines);
  if (input.type === 'MultiLineString') return input.coordinates.map((coordinates) => ({ type: 'LineString', coordinates }));
  return [input];
}
function checkedPolygon(polygon: PolygonGeometry) {
  const geometry = reader.read(polygon);
  if (!IsValidOp.isValid(geometry)) throw new Error('input_validation_polygon');
  return geometry;
}
/** Boundary-inclusive ownership respects inner rings as well as the outer ring. */
export function polygonOwnsPoint(polygon: PolygonGeometry, point: LngLat): boolean {
  return !OverlayOp.intersection(checkedPolygon(polygon), reader.read({type:'Point', coordinates:point})).isEmpty();
}
export function polygonIntersects(left:PolygonGeometry,right:PolygonGeometry) {
  return !OverlayOp.intersection(checkedPolygon(left),checkedPolygon(right)).isEmpty();
}
export function clipNetworkLines(input: LinearInput, area: PolygonGeometry): LineStringGeometry[] {
  const polygon = checkedPolygon(area);
  const result: LineStringGeometry[] = [];
  for (const line of lines(input)) {
    if (line.coordinates.length < 2 || line.coordinates.some((p) => p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 85)) throw new Error('geometry_invalid_road');
    const coordinates = line.coordinates.filter((point, i, all) => !i || point[0] !== all[i - 1][0] || point[1] !== all[i - 1][1]);
    if (coordinates.length < 2) continue;
    const clipped = OverlayOp.intersection(reader.read({ type: 'LineString', coordinates }), polygon);
    const append = (part: typeof clipped) => {
      if (part.isEmpty()) return;
      if (part.getGeometryType() === 'LineString') {
        const candidate = writer.write(part) as LineStringGeometry;
        if (roadLength(candidate) > 0.05) result.push(JSON.parse(canonicalStreetFragmentGeometryJson(candidate)) as LineStringGeometry);
      } else if (['MultiLineString', 'GeometryCollection'].includes(part.getGeometryType())) {
        for (let i = 0; i < part.getNumGeometries(); i++) append(part.getGeometryN(i));
      }
    };
    append(clipped);
  }
  return result.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function metadata(tags: Record<string,string>, deliveryClass: StreetEngineRoadMetadata['deliveryClass']): StreetEngineRoadMetadata {
  return {
    highway: tags.highway,
    ...(tags.service ? { service: tags.service } : {}),
    ...(tags.junction ? { junction: tags.junction } : {}),
    ...(tags.access ? { access: tags.access } : {}),
    deliveryClass,
  };
}
function deliveryClassOf(task: DistributionTask): StreetEngineRoadMetadata['deliveryClass'] | null {
  return ((task.network as PersistedRoadNetwork | undefined)?.street?.deliveryClass) ?? null;
}

/** OSM shared vertices encode actual junctions; an un-noded grade crossing is not a junction. */
export async function buildRoadNetwork(input: { roads: RoadInput[]; area: PolygonGeometry; campaignId: string; areaId: string; generation: string; timestamp: string }): Promise<DistributionTask[]> {
  const fragments: { road: RoadInput; line: LineStringGeometry; level: string; deliveryClass: StreetEngineRoadMetadata['deliveryClass'] }[] = [];
  const seenWays = new Map<number, string>();
  let accessWays = 0;
  for (const road of [...input.roads].sort((a, b) => a.osmId - b.osmId)) {
    const classic = eligibleRoad(road.tags);
    const accessCandidate = !classic && eligibleDeliveryV3AccessRoad(road.tags);
    if (!classic && !accessCandidate) continue;
    const source = JSON.stringify(road);
    if (seenWays.has(road.osmId)) {
      if (seenWays.get(road.osmId) !== source) throw new Error('road_dedupe_conflicting_source');
      continue;
    }
    seenWays.set(road.osmId, source);
    const clipped = clipNetworkLines(road.geometry, input.area);
    if (accessCandidate) {
      if (accessWays >= DELIVERY_V3_MAX_ACCESS_WAYS) continue;
      const usable = clipped.filter((line) => roadLength(line) <= DELIVERY_V3_MAX_ACCESS_WAY_METERS);
      if (!usable.length) continue;
      accessWays += 1;
      for (const line of usable) fragments.push({ road, line, level: road.tags.layer ?? '0', deliveryClass: 'address-access-candidate' });
      continue;
    }
    for (const line of clipped) fragments.push({ road, line, level: road.tags.layer ?? '0', deliveryClass: 'classic' });
  }
  // V3-only access candidates must not split the classic graph, otherwise V1/V2
  // would gain thousands of new task boundaries. Candidates may still split
  // themselves at shared OSM vertices and are connected visually by V3 screening.
  const classicUsage = new Map<string, Set<number>>();
  const allUsage = new Map<string, Set<number>>();
  fragments.forEach((fragment, index) => fragment.line.coordinates.forEach((point) => {
    const key = networkNodeKey(point, fragment.level);
    if (!allUsage.has(key)) allUsage.set(key, new Set());
    allUsage.get(key)!.add(index);
    if (fragment.deliveryClass === 'classic') {
      if (!classicUsage.has(key)) classicUsage.set(key, new Set());
      classicUsage.get(key)!.add(index);
    }
  }));
  const tasks = new Map<string, DistributionTask>();
  for (const fragment of fragments) {
    let start = 0;
    const points = fragment.line.coordinates;
    const closed = networkNodeKey(points[0]) === networkNodeKey(points.at(-1)!);
    const usage = fragment.deliveryClass === 'classic' ? classicUsage : allUsage;
    for (let i = 1; i < points.length; i++) {
      if (i !== points.length - 1 && (usage.get(networkNodeKey(points[i], fragment.level))?.size ?? 0) < 2 && !(closed && i === Math.floor((points.length - 1) / 2))) continue;
      const geometry = JSON.parse(canonicalStreetFragmentGeometryJson({ type: 'LineString', coordinates: points.slice(start, i + 1) })) as LineStringGeometry;
      start = i;
      const total = roadLength(geometry);
      if (total < 0.05) continue;
      const id = await stablePreparedStreetTaskId({ campaignId: input.campaignId, areaId: input.areaId, sourceOsmWayId: fragment.road.osmId, geometry });
      const label = fragment.road.tags.name ?? fragment.road.tags.ref ?? (fragment.deliveryClass === 'address-access-candidate' ? 'Zufahrt' : 'Straße');
      const network: PersistedRoadNetwork = {
        fromNode: networkNodeKey(geometry.coordinates[0], fragment.level),
        toNode: networkNodeKey(geometry.coordinates.at(-1)!, fragment.level),
        length: total,
        coverage: [],
        street: metadata(fragment.road.tags, fragment.deliveryClass),
      };
      tasks.set(id, { id, campaignId: input.campaignId, areaId: input.areaId, taskType: 'street', label, geometry, source: { dataset: 'OpenStreetMap', objectType: 'way', objectIds: [fragment.road.osmId] }, areaPreparationGeneration: input.generation, status: 'open', completedAt: null, createdAt: input.timestamp, updatedAt: input.timestamp, network });
    }
  }
  return [...tasks.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function interiorPoint(polygon: PolygonGeometry): LngLat {
  const geometry = checkedPolygon(polygon);
  const point = new InteriorPointArea(geometry).getInteriorPoint();
  if (!point) throw new Error('geometry_invalid_building');
  return [point.x, point.y];
}
const normalizedName = (name: string) => name.normalize('NFKC').toLocaleLowerCase('de').replace(/[\s.]+/g, ' ').trim();
export function associateHouses(tasks: DistributionTask[], houses: HouseTask[], addresses: Map<string, string> = new Map()) {
  // Preserve the established V1/V2 parent assignment. V3 driveway candidates
  // are a display/access aid and must not steal Houses from their canonical road.
  const index = new RoadIndex(tasks.filter((task) => deliveryClassOf(task) !== 'address-access-candidate'));
  return houses.map((house): HouseTask => {
    const candidates = index.candidates(interiorPoint(house.geometry), 100).filter((snap) => snap.task.areaId === house.areaId);
    const address = addresses.get(house.id);
    const named = address ? candidates.filter((candidate) => normalizedName(candidate.task.label) === normalizedName(address)) : [];
    const viable = named.length ? named : address ? [] : candidates.filter((candidate) => candidate.distance <= 35);
    const best = viable[0];
    const ambiguous = viable[1] && viable[1].distance - (best?.distance ?? 0) < 5;
    if (!best || ambiguous) return { ...house, parentStreetTaskId: null, roadPosition: { measure: null, confidence: 'unassigned' } };
    return { ...house, parentStreetTaskId: best.task.id, roadPosition: { measure: best.measure, confidence: named.length ? 'address' : 'nearby' } };
  });
}
