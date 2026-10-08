export type LngLat = [number, number];
export type Tags = Record<string, string>;

/** Raw OSM input. `nodes` (OSM node ids, parallel to `coords`) are optional but give stable ids. */
export type RawWay = { id: number; tags: Tags; coords: LngLat[]; nodes?: number[] };
export type RawBuilding = { id: number; tags: Tags; ring: LngLat[] };
export type RawAddressNode = { id: number; tags: Tags; point: LngLat };
export type RawOsm = { ways: RawWay[]; buildings: RawBuilding[]; addresses: RawAddressNode[] };

export type RoadClass = 'street' | 'access' | 'connector' | 'excluded';
export type RoadVerdict = { cls: RoadClass; reason: string };

export type Segment = {
  id: string;
  wayId: number;
  name: string | null;
  ref: string | null;
  highway: string;
  /** Classification before house evidence; `visible` is the final decision. */
  cls: Exclude<RoadClass, 'excluded'>;
  coords: LngLat[];
  length: number;
  from: string;
  to: string;
  houseCount: number;
  visible: boolean;
};

export type House = {
  id: string;
  osmId: number;
  source: 'building' | 'address-node';
  number: string | null;
  street: string | null;
  ring: LngLat[];
  center: LngLat;
  /** Parent segment id, or null when no delivery street is close enough. */
  parent: string | null;
  /** Metres along the parent segment. */
  measure: number | null;
  evidence: 'address' | 'residential-type' | 'address-node';
};

export type NetworkDiagnostics = {
  engineVersion: string;
  waysIn: number;
  waysExcluded: Record<string, number>;
  segments: number;
  visibleSegments: number;
  promotedByHouses: number;
  hiddenConnectors: number;
  buildingsIn: number;
  housesOut: number;
  buildingsSkipped: Record<string, number>;
  orphanHouses: number;
};

export type Network = {
  segments: Segment[];
  houses: House[];
  diagnostics: NetworkDiagnostics;
};
