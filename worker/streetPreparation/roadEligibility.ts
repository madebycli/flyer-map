export const STREET_ENGINE_ALGORITHM_VERSION = "street-v2-jsts-2.12.1-turf-7.4.0";

const SUPPORTED_HIGHWAYS = new Set([
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "pedestrian",
  "footway",
  "cycleway",
  "path",
  "track",
  "steps",
  "road",
]);

const BLOCKED_HIGHWAYS = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "construction",
  "proposed",
  "abandoned",
  "disused",
  "razed",
  "platform",
  "raceway",
  "bridleway",
  "corridor",
  "elevator",
  "escalator",
]);

const BLOCKED_ACCESS_VALUES = new Set(["no", "private", "restricted"]);

export type StreetEligibilityReason =
  | "missing-highway"
  | "unsupported-highway"
  | "blocked-highway"
  | "restricted-access";

export type StreetEligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: StreetEligibilityReason };

function normalized(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function streetRoadEligibility(tags: Record<string, string>): StreetEligibilityResult {
  const highway = normalized(tags.highway);
  if (!highway) return { eligible: false, reason: "missing-highway" };
  if (BLOCKED_HIGHWAYS.has(highway)) {
    return { eligible: false, reason: "blocked-highway" };
  }
  if (!SUPPORTED_HIGHWAYS.has(highway)) {
    return { eligible: false, reason: "unsupported-highway" };
  }

  for (const key of ["access", "foot", "bicycle", "motor_vehicle"]) {
    if (BLOCKED_ACCESS_VALUES.has(normalized(tags[key]))) {
      return { eligible: false, reason: "restricted-access" };
    }
  }
  return { eligible: true };
}
