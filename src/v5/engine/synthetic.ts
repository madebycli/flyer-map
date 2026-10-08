import type { LngLat, RawBuilding, RawOsm, RawWay } from './types.ts';

const M_LAT = 110_574;

export type SyntheticCity = {
  raw: RawOsm;
  /** Ids of the deliberately tricky ways, for assertions. */
  special: { forestTrack: number; sidewalk: number; driveway: number; cutThroughPath: number; backLotService: number; sideStreet: number; throughStreet: number };
  housesExpected: number;
};

/**
 * Deterministic test city: a street grid (shared node ids at crossings), a side street
 * that joins a through street at an *interior* node, a named forest track, a sidewalk,
 * a driveway, a house-less cut-through path, a back-lot service road serving 3 houses,
 * garages and standalone address nodes. Used by tests and the large-scale benchmark.
 */
export function syntheticCity(blocksX: number, blocksY: number, block = 100, origin: LngLat = [13.0, 51.0]): SyntheticCity {
  const cos = Math.cos((origin[1] * Math.PI) / 180);
  const pt = (x: number, y: number): LngLat => [origin[0] + x / (cos * 111_320), origin[1] + y / M_LAT];
  const nodeId = (i: number, j: number) => 1_000_000 + i * 10_000 + j;
  const ways: RawWay[] = [];
  const buildings: RawBuilding[] = [];
  let buildingId = 5_000_000, nextNode = 90_000_000;

  for (let j = 0; j <= blocksY; j++) {
    const coords: LngLat[] = [], nodes: number[] = [];
    for (let i = 0; i <= blocksX; i++) { coords.push(pt(i * block, j * block)); nodes.push(nodeId(i, j)); }
    ways.push({ id: 1000 + j, tags: { highway: 'residential', name: `Querstraße ${j + 1}` }, coords, nodes });
  }
  for (let i = 0; i <= blocksX; i++) {
    const coords: LngLat[] = [], nodes: number[] = [];
    for (let j = 0; j <= blocksY; j++) { coords.push(pt(i * block, j * block)); nodes.push(nodeId(i, j)); }
    ways.push({ id: 2000 + i, tags: { highway: 'residential', name: `Längsweg ${i + 1}` }, coords, nodes });
  }

  const house = (x: number, y: number, w: number, h: number, number: string, street: string, type = 'house') => {
    buildings.push({
      id: buildingId++, tags: { building: type, 'addr:housenumber': number, 'addr:street': street },
      ring: [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h), pt(x, y)],
    });
  };
  let housesExpected = 0;
  const per = Math.max(1, Math.floor((block - 20) / 20));
  for (let i = 0; i < blocksX; i++) {
    for (let j = 0; j < blocksY; j++) {
      for (let k = 0; k < per; k++) {
        const x = i * block + 10 + k * 20, bottom = `Querstraße ${j + 1}`, top = `Querstraße ${j + 2}`;
        house(x, j * block + 8, 12, 10, String(k * 2 + 1 + i * 2 * per), bottom); housesExpected++;
        house(x, (j + 1) * block - 18, 12, 10, String(k * 2 + 2 + i * 2 * per), top); housesExpected++;
      }
    }
  }

  // Tricky extras live in the first block row, outside the house grid.
  // Side street joining Querstraße 1 at an interior node (exactly at x = 1.5 blocks).
  const sideJoin = nextNode++;
  const through = ways.find((w) => w.id === 1000)!;
  const mid = through.coords.findIndex((c) => c[0] > pt(block * 1.5, 0)[0]);
  const joinPoint = pt(block * 1.5, 0);
  through.coords.splice(mid, 0, joinPoint);
  through.nodes!.splice(mid, 0, sideJoin);
  const sideId = 3000;
  ways.push({ id: sideId, tags: { highway: 'residential', name: 'Stichstraße' }, coords: [joinPoint, pt(block * 1.5, -60)], nodes: [sideJoin, nextNode++] });
  for (let k = 0; k < 3; k++) { house(block * 1.5 + 8, -50 + k * 15, 12, 10, String(k + 1), 'Stichstraße'); housesExpected++; }

  ways.push({ id: 3001, tags: { highway: 'track', name: 'Waldweg' }, coords: [pt(-80, -40), pt(-10, 30), pt(60, -20)], nodes: [nextNode++, nextNode++, nextNode++] });
  ways.push({ id: 3002, tags: { highway: 'footway', footway: 'sidewalk' }, coords: [pt(5, 4), pt(block - 5, 4)], nodes: [nextNode++, nextNode++] });
  ways.push({ id: 3003, tags: { highway: 'service', service: 'driveway' }, coords: [pt(30, 0), pt(30, 6)], nodes: [nextNode++, nextNode++] });
  ways.push({ id: 3004, tags: { highway: 'footway', surface: 'asphalt' }, coords: [pt(50, block + 30), pt(50, block + 70)], nodes: [nextNode++, nextNode++] });
  // Back-lot service road behind the grid serving three houses (must be promoted to visible).
  const baseY = -200;
  ways.push({ id: 3005, tags: { highway: 'service' }, coords: [pt(0, baseY), pt(60, baseY)], nodes: [nextNode++, nextNode++] });
  for (let k = 0; k < 3; k++) { house(8 + k * 18, baseY + 6, 12, 10, `H${k + 1}`, 'Hinterhof'); housesExpected++; }
  // Garages and a business-tagged dwelling.
  buildings.push({ id: buildingId++, tags: { building: 'garage', 'addr:housenumber': '99' }, ring: [pt(70, 40), pt(76, 40), pt(76, 46), pt(70, 46), pt(70, 40)] });
  buildings.push({ id: buildingId++, tags: { building: 'house', shop: 'bakery', name: 'Bäckerei', 'addr:housenumber': '7', 'addr:street': 'Querstraße 1' }, ring: [pt(75, 8), pt(87, 8), pt(87, 18), pt(75, 18), pt(75, 8)] });
  housesExpected++;

  return {
    raw: { ways, buildings, addresses: [] },
    special: { forestTrack: 3001, sidewalk: 3002, driveway: 3003, cutThroughPath: 3004, backLotService: 3005, sideStreet: sideId, throughStreet: 1000 },
    housesExpected,
  };
}
