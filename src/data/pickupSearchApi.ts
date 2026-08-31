import type { LngLat } from "../domain/campaign.ts";
import type { PickupSource } from "../domain/pickup.ts";

export type PickupSearchResult = {
  id: string;
  title: string;
  address: string;
  position: LngLat;
  distanceMeters: number;
  source: Extract<PickupSource, { kind: "osm-address" }>;
};

export type PickupSearchAttribution = {
  provider: { text: string; href: string };
  data: { text: string; href: string };
};

export type PickupSearchResponse = {
  results: PickupSearchResult[];
  attribution: PickupSearchAttribution;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLngLat(value: unknown): value is LngLat {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function parseResult(value: unknown): PickupSearchResult | null {
  if (!isRecord(value) || !isLngLat(value.position) || !isRecord(value.source)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.address !== "string" ||
    typeof value.distanceMeters !== "number" ||
    !Number.isFinite(value.distanceMeters) ||
    value.distanceMeters < 0 ||
    value.source.kind !== "osm-address" ||
    value.source.provider !== "geoapify"
  ) {
    return null;
  }
  const optionalSource = (candidate: unknown) =>
    candidate === null || typeof candidate === "string" ? candidate as string | null : null;
  return {
    id: value.id,
    title: value.title,
    address: value.address,
    position: value.position,
    distanceMeters: value.distanceMeters,
    source: {
      kind: "osm-address",
      provider: "geoapify",
      placeId: optionalSource(value.source.placeId),
      osmType: optionalSource(value.source.osmType),
      osmId: optionalSource(value.source.osmId),
    },
  };
}

function parseAttribution(value: unknown): PickupSearchAttribution | null {
  if (!isRecord(value) || !isRecord(value.provider) || !isRecord(value.data)) return null;
  if (
    typeof value.provider.text !== "string" ||
    value.provider.href !== "https://www.geoapify.com/" ||
    typeof value.data.text !== "string" ||
    value.data.href !== "https://www.openstreetmap.org/copyright"
  ) {
    return null;
  }
  return {
    provider: { text: value.provider.text, href: value.provider.href },
    data: { text: value.data.text, href: value.data.href },
  };
}

export async function searchPickupAddresses(
  campaignId: string,
  query: string,
  bias: LngLat | null,
  signal?: AbortSignal,
): Promise<PickupSearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (bias) {
    params.set("lng", String(bias[0]));
    params.set("lat", String(bias[1]));
  }
  const response = await fetch(
    `/api/campaigns/${encodeURIComponent(campaignId)}/collection/pickup-search?${params}`,
    { cache: "no-store", credentials: "same-origin", signal },
  );
  if (!response.ok) {
    let message = `Adresssuche fehlgeschlagen (${response.status}).`;
    try {
      const payload = await response.json() as { error?: { message?: string } };
      if (payload.error?.message) message = payload.error.message;
    } catch {
      // Keep generic message.
    }
    throw new Error(message);
  }

  const payload = await response.json() as unknown;
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new Error("Adresssuche lieferte ungültige Daten.");
  }
  const attribution = parseAttribution(payload.attribution);
  if (!attribution) throw new Error("Adresssuche lieferte ungültige Attribution.");
  const results = payload.results.map(parseResult).filter((result): result is PickupSearchResult => result !== null);
  return { results, attribution };
}
