import type { LineStringGeometry, LngLat } from "../../src/domain/campaign.ts";
import type { StreetInputGeometry } from "./types.ts";

function normalizedNumber(value: number) {
  if (!Number.isFinite(value)) return "invalid";
  const rounded = Number(value.toFixed(9));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function coordinateKey([lng, lat]: LngLat) {
  return normalizedNumber(lng) + "," + normalizedNumber(lat);
}

function lineKey(coordinates: LngLat[]) {
  const forward = coordinates.map(coordinateKey).join(";");
  const reverse = [...coordinates].reverse().map(coordinateKey).join(";");
  return forward < reverse ? forward : reverse;
}

export function canonicalStreetGeometryKey(geometry: StreetInputGeometry) {
  if (geometry.type === "LineString") return "LineString:" + lineKey(geometry.coordinates);
  if (geometry.type === "MultiLineString") {
    return "MultiLineString:" + geometry.coordinates
      .map((coordinates) => lineKey(coordinates))
      .sort()
      .join("|");
  }
  return "GeometryCollection:" + geometry.geometries
    .map(canonicalStreetGeometryKey)
    .sort()
    .join("|");
}

function fnv1a64(value: string, offset: bigint) {
  let hash = offset;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function canonicalStreetLineKey(geometry: LineStringGeometry) {
  return lineKey(geometry.coordinates);
}

export function stableStreetTaskId(input: {
  campaignId: string;
  areaId: string;
  osmId: number;
  geometry: LineStringGeometry;
}) {
  const canonical = [
    "flyer-map",
    "prepared-street",
    input.campaignId,
    input.areaId,
    String(input.osmId),
    canonicalStreetLineKey(input.geometry),
  ].join("|");
  const first = fnv1a64(canonical, 14695981039346656037n);
  const second = fnv1a64("v2|" + canonical, 1099511628211n);
  return "task_auto_" + first + second;
}
