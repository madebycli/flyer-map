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

export function canonicalStreetGeometryKey(geometry: StreetInputGeometry): string {
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

export function canonicalStreetLineKey(geometry: LineStringGeometry) {
  return lineKey(geometry.coordinates);
}

/**
 * This exact JSON form is the cross-branch canonical fragment representation.
 * It is direction-invariant and intentionally matches the SHA-256 contract
 * already used by the RxDB integration branch.
 */
export function canonicalStreetFragmentGeometryJson(geometry: LineStringGeometry) {
  const forward = geometry.coordinates;
  const reversed = [...forward].reverse();
  const forwardJson = JSON.stringify(forward);
  const reversedJson = JSON.stringify(reversed);
  const coordinates = reversedJson < forwardJson ? reversed : forward;
  return JSON.stringify({ type: "LineString", coordinates });
}

/** Stable source identity before clipping, never used as a user-visible Task ID. */
export function preparedStreetSourceKey(input: {
  sourceOsmWayId: number;
  geometry: StreetInputGeometry;
}) {
  return "osm-way:" + input.sourceOsmWayId + ":" + canonicalStreetGeometryKey(input.geometry);
}

/** Stable clipped fragment identity used for deduplication and adapter input. */
export function preparedStreetFragmentKey(input: {
  sourceOsmWayId: number;
  geometry: LineStringGeometry;
}) {
  return "osm-way:" + input.sourceOsmWayId + ":" + canonicalStreetFragmentGeometryJson(input.geometry);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Canonical app-owned identity. Keep this byte-for-byte aligned with the
 * server-prepared-street-v1 contract on the Sync branch.
 */
export async function stablePreparedStreetTaskId(input: {
  campaignId: string;
  areaId: string;
  sourceOsmWayId: number;
  geometry: LineStringGeometry;
}) {
  const identity = JSON.stringify({
    namespace: "server-prepared-street-v1",
    campaignId: input.campaignId,
    areaId: input.areaId,
    sourceOsmWayId: input.sourceOsmWayId,
    geometry: canonicalStreetFragmentGeometryJson(input.geometry),
  });
  return "task_auto_" + await sha256Hex(identity);
}
