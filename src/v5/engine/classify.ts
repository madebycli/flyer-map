import type { RoadVerdict, Tags } from './types.ts';

/**
 * Whitelist classification (not an exclusion list): a way is only ever a delivery
 * candidate when it is explicitly known to be one. Everything unknown is excluded.
 */
const STREETS = new Set([
  'residential', 'living_street', 'unclassified', 'tertiary', 'tertiary_link',
  'secondary', 'secondary_link', 'primary', 'primary_link', 'pedestrian', 'road',
]);
const PATH_LIKE = new Set(['footway', 'path', 'steps']);
const RESTRICTED_ACCESS = new Set(['no', 'private', 'forestry', 'agricultural']);
const UNPAVED = new Set([
  'unpaved', 'ground', 'dirt', 'earth', 'grass', 'gravel', 'fine_gravel', 'sand', 'mud',
  'compacted', 'woodchips', 'pebblestone', 'grass_paver', 'clay', 'soil', 'rock',
]);
const SERVICE_EXCLUDED = new Set(['driveway', 'parking_aisle', 'drive-through', 'emergency_access', 'siding', 'yard', 'spur']);

export function classifyRoad(tags: Tags): RoadVerdict {
  const highway = tags.highway;
  if (!highway) return { cls: 'excluded', reason: 'no_highway' };
  if (tags.area === 'yes') return { cls: 'excluded', reason: 'area' };
  if (RESTRICTED_ACCESS.has(tags.access ?? '') || RESTRICTED_ACCESS.has(tags.foot ?? '')) {
    // An explicit foot=yes/designated overrides a generic access restriction.
    if (!['yes', 'designated', 'permissive'].includes(tags.foot ?? '')) return { cls: 'excluded', reason: 'restricted_access' };
  }
  if (STREETS.has(highway)) return { cls: 'street', reason: highway };
  if (highway === 'service') {
    const service = tags.service ?? '';
    if (SERVICE_EXCLUDED.has(service)) return { cls: 'excluded', reason: `service_${service}` };
    return { cls: 'access', reason: service ? `service_${service}` : 'service' };
  }
  if (PATH_LIKE.has(highway)) {
    if (highway === 'footway' && ['sidewalk', 'crossing', 'traffic_island', 'link'].includes(tags.footway ?? '')) {
      return { cls: 'excluded', reason: `footway_${tags.footway}` };
    }
    if (UNPAVED.has(tags.surface ?? '')) return { cls: 'excluded', reason: 'unpaved_path' };
    // Paths never become tasks on their own; they stay in the graph and are promoted
    // only when real houses are assigned to them.
    return { cls: 'connector', reason: highway };
  }
  return { cls: 'excluded', reason: `highway_${highway}` };
}

// Never a letterbox target, even with an address node attached (garage courts, sheds, ...).
const NON_DWELLING = new Set([
  'garage', 'garages', 'carport', 'shed', 'roof', 'greenhouse', 'container', 'parking', 'transformer_tower',
  'toilets', 'kiosk', 'silo', 'digester', 'water_tower', 'stable', 'cowshed', 'sty', 'ruins', 'construction',
  'bunker', 'boathouse',
]);
// Dropped only when nothing says someone lives there (a converted barn with a number stays).
const AMBIGUOUS_OUTBUILDING = new Set(['barn', 'cabin', 'hut', 'service', 'allotment_house']);
const RESIDENTIAL = new Set([
  'house', 'residential', 'detached', 'semidetached_house', 'terrace', 'apartments', 'dormitory',
  'bungalow', 'farm', 'houseboat', 'static_caravan',
]);

export type BuildingVerdict = { keep: boolean; evidence: 'address' | 'residential-type' | null; reason: string };

/**
 * Never decides by shop/office/name: home businesses stay deliverable.
 * Only clearly non-dwelling structures without an address are dropped.
 */
export function classifyBuilding(tags: Tags, hasAddress: boolean): BuildingVerdict {
  const type = tags.building ?? 'yes';
  if (NON_DWELLING.has(type)) return { keep: false, evidence: null, reason: `non_dwelling_${type}` };
  if (hasAddress) return { keep: true, evidence: 'address', reason: 'address' };
  if (RESIDENTIAL.has(type)) return { keep: true, evidence: 'residential-type', reason: 'residential_type' };
  return { keep: false, evidence: null, reason: AMBIGUOUS_OUTBUILDING.has(type) ? `outbuilding_${type}` : 'no_address_no_residential_type' };
}
