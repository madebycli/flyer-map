import RBush from 'rbush';
import type { LngLat, PolygonGeometry } from '../../src/domain/campaign.ts';
import { polygonOwnsPoint } from './geometry.ts';

export type AddressNode = { osmId: number; point: LngLat; tags: Record<string, string> };
export type AddressBuilding = { osmId: number; tags: Record<string, string>; geometry: PolygonGeometry };
const clean = (value: string | undefined) => value?.normalize('NFKC').trim().replace(/\s+/gu, ' ') ?? '';
export function postalAddress(tags: Record<string, string>) {
  const number = clean(tags['addr:housenumber']);
  if (!number || number.length > 80 || /^(?:yes|no|unknown|\?)$/iu.test(number)) return null;
  const street = clean(tags['addr:street']) || clean(tags['addr:place']);
  const key = street ? [tags['addr:country'], tags['addr:postcode'], tags['addr:city'], street, number].map(value => clean(value).toLocaleLowerCase('de')).join('|') : null;
  return { number, street, key, label: [street, number].filter(Boolean).join(' ') };
}

/** Direct addresses win; boundary nodes choose the smallest containing building, then OSM ID. */
export function addressBuildings(buildings: AddressBuilding[], nodes: AddressNode[]) {
  const unique = new Map<number, AddressBuilding>();
  for (const building of buildings) {
    const prior = unique.get(building.osmId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(building)) throw new Error('house_dedupe_conflict');
    unique.set(building.osmId, building);
  }
  const ordered = [...unique.values()].sort((a, b) => a.osmId - b.osmId);
  const boxes = ordered.map(building => {
    const points = building.geometry.coordinates[0];
    return { minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minY: Math.min(...points.map(p => p[1])), maxY: Math.max(...points.map(p => p[1])), building };
  });
  const tree = new RBush<(typeof boxes)[number]>();
  tree.load(boxes);
  const associated = new Map<number, AddressNode[]>();
  for (const node of [...new Map(nodes.map(node => [node.osmId, node])).values()].sort((a,b) => a.osmId-b.osmId)) {
    if (!postalAddress(node.tags)) continue;
    const [x,y] = node.point;
    const owners = tree.search({minX:x,maxX:x,minY:y,maxY:y}).filter(box => polygonOwnsPoint(box.building.geometry,node.point));
    owners.sort((a,b) => (a.maxX-a.minX)*(a.maxY-a.minY)-(b.maxX-b.minX)*(b.maxY-b.minY) || a.building.osmId-b.building.osmId);
    const owner = owners[0]?.building;
    if (!owner || postalAddress(owner.tags)) continue;
    const list = associated.get(owner.osmId) ?? [];
    list.push(node); associated.set(owner.osmId,list);
  }
  const seen = new Set<string>();
  return ordered.flatMap(building => {
    const candidates = postalAddress(building.tags) ? [building.tags] : (associated.get(building.osmId) ?? []).map(node => node.tags);
    let emitted = 0;
    return candidates.flatMap(tags => {
      const address = postalAddress(tags)!;
      // A bare house number cannot dedupe different buildings or streets.
      const key = address.key ?? `building:${building.osmId}:${address.number}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{...building, tags: {...building.tags,...tags}, address, identityAddress: emitted++ === 0 ? null : key}];
    });
  });
}
