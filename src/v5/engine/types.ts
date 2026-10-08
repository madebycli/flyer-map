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
  /** Stable id of this piece. A junction-to-junction segment longer than CHUNK_METERS is cut into chunks `<group>~<k>`. */
  id: string;
  /** The junction-to-junction segment this chunk belongs to (equals `id` when it was not cut). */
  group: string;
  chunk: number;
  chunks: number;
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

/**
 * What the app holds: the network without coordinates. Geometry stays in the engine (Rust session) and reaches the map as
 * vector tiles; the few places that need a position use `mid`/`start`/`center` or ask the engine.
 */
export type FieldSegment = Omit<Segment, 'coords'> & { mid: LngLat; start: LngLat };
export type FieldHouse = Omit<House, 'ring'>;
export type FieldNetwork = { segments: FieldSegment[]; houses: FieldHouse[]; diagnostics: NetworkDiagnostics };
