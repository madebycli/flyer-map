import {
  OFFLINE_MAP_RADIUS_METERS,
  isOfflineMapPackage,
  type OfflineMapDataKind,
  type OfflineMapLngLat,
  type OfflineMapPackage,
} from "../domain/offlineMap.ts";

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

export class OfflineMapApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "OfflineMapApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseError(response: Response) {
  let payload: ApiErrorPayload | null = null;
  try {
    payload = (await response.json()) as ApiErrorPayload;
  } catch {
    // Keep generic fallback below.
  }
  return new OfflineMapApiError(
    response.status,
    payload?.error?.code ?? "offline_package_failed",
    payload?.error?.message ?? `Offline-Kartenanfrage fehlgeschlagen (${response.status}).`,
  );
}

export async function fetchMapDataPackage(
  campaignId: string,
  center: OfflineMapLngLat,
  radiusMeters = OFFLINE_MAP_RADIUS_METERS,
  kind: OfflineMapDataKind = "all",
): Promise<OfflineMapPackage> {
  let response: Response;
  try {
    response = await fetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/offline-map/package`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ center, radiusMeters, kind }),
      },
    );
  } catch {
    throw new OfflineMapApiError(
      0,
      "network_error",
      "Offline-Kartenbereich konnte nicht vom Server geladen werden.",
    );
  }

  if (!response.ok) throw await parseError(response);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new OfflineMapApiError(
      502,
      "offline_package_invalid",
      "Server hat kein gültiges Offline-Kartenpaket geliefert.",
    );
  }

  if (!isOfflineMapPackage(payload)) {
    throw new OfflineMapApiError(
      502,
      "offline_package_invalid",
      "Server hat kein gültiges Offline-Kartenpaket geliefert.",
    );
  }

  return payload;
}

export function downloadOfflineMapPackage(
  campaignId: string,
  center: OfflineMapLngLat,
  radiusMeters = OFFLINE_MAP_RADIUS_METERS,
) {
  return fetchMapDataPackage(campaignId, center, radiusMeters, "all");
}
