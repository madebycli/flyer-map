import type { RawOsm } from '../../src/v5/engine/index.ts';

const origin: [number, number] = [13.0, 51.0];
const cos = Math.cos((origin[1] * Math.PI) / 180);
const pt = (x: number, y: number): [number, number] => [origin[0] + x / (cos * 111_320), origin[1] + y / 110_574];
const house = (id: number, x: number, y: number, tags: Record<string, string>) => ({ id, tags: { building: 'house', ...tags }, ring: [pt(x, y), pt(x + 12, y), pt(x + 12, y + 10), pt(x, y + 10), pt(x, y)] });
const path = (id: number, x: number, from: number, to: number, nodes: [number, number]) => ({ id, tags: { highway: 'footway', surface: 'asphalt' }, coords: [pt(x, from), pt(x, to)], nodes });

/** Four garden paths off one named street: two with houses that name it (150 m away), one with a house naming another street, one with no house. */
export const pathLinkRaw: RawOsm = {
  ways: [
    { id: 1, tags: { highway: 'residential', name: 'Hauptstraße' }, coords: [pt(0, 0), pt(400, 0)], nodes: [11, 12] },
    path(2, 100, 10, 200, [21, 22]),
    path(3, 300, 10, 200, [31, 32]),
    path(4, 200, 10, 200, [41, 42]),
    path(5, 350, 10, 200, [51, 52]),
  ],
  buildings: [
    house(101, 106, 150, { 'addr:housenumber': '1', 'addr:street': 'Hauptstraße' }),
    house(102, 106, 170, { 'addr:housenumber': '3', 'addr:street': 'Hauptstraße' }),
    house(103, 306, 150, { 'addr:housenumber': '5', 'addr:street': 'Hauptstraße' }),
    house(104, 356, 150, { 'addr:housenumber': '7', 'addr:street': 'Nebenweg' }),
  ],
  addresses: [],
};
