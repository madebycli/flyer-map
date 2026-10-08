/**
 * Shared OSM delivery-relevance rules (plan 038, conservative first slice).
 *
 * Only ways that can never be a flyer-delivery street are rejected: forest and
 * field tracks, bridleways, cycleways, motorways, sidewalk/crossing footways
 * (they duplicate the street) and unpaved or restricted path segments.
 * Everything ambiguous stays deliverable.
 */
type Tags = Record<string, string | undefined>;

const NON_DELIVERY_HIGHWAYS = new Set([
  'motorway', 'motorway_link', 'track', 'bridleway', 'cycleway', 'construction', 'proposed',
  'raceway', 'bus_guideway', 'busway', 'escape', 'platform', 'corridor', 'elevator',
  'via_ferrata', 'services', 'rest_area', 'footway_link',
]);
const PATH_LIKE = new Set(['path', 'footway', 'steps']);
const UNPAVED_SURFACES = new Set([
  'unpaved', 'ground', 'dirt', 'earth', 'grass', 'gravel', 'fine_gravel', 'sand', 'mud',
  'compacted', 'woodchips', 'pebblestone', 'grass_paver', 'clay', 'soil', 'rock',
]);
const RESTRICTED_ACCESS = new Set(['no', 'private', 'forestry', 'agricultural']);
const COMPANION_FOOTWAYS = new Set(['sidewalk', 'crossing', 'traffic_island', 'link']);

/** True when the way can plausibly be a street a distributor walks for flyers. */
export function isDeliveryRelevantRoad(tags: Tags): boolean {
  const highway = tags.highway;
  if (!highway || NON_DELIVERY_HIGHWAYS.has(highway)) return false;
  if (RESTRICTED_ACCESS.has(tags.access ?? '') || RESTRICTED_ACCESS.has(tags.foot ?? '')) return false;
  if (tags.service === 'driveway' || tags.service === 'parking_aisle') return false;
  if (highway === 'footway' && COMPANION_FOOTWAYS.has(tags.footway ?? '')) return false;
  if (PATH_LIKE.has(highway) && UNPAVED_SURFACES.has(tags.surface ?? '')) return false;
  return true;
}
