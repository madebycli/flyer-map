import type { MapCameraView } from "../domain/campaign";

const PREFIX = "verteil-flyer:map-camera:";

function isCamera(value: unknown): value is MapCameraView {
  if (!value || typeof value !== "object") return false;
  const camera = value as Partial<MapCameraView>;
  return (
    Array.isArray(camera.center) &&
    camera.center.length === 2 &&
    camera.center.every((number) => typeof number === "number" && Number.isFinite(number)) &&
    typeof camera.zoom === "number" &&
    Number.isFinite(camera.zoom) &&
    typeof camera.bearing === "number" &&
    Number.isFinite(camera.bearing)
  );
}

function key(campaignId: string) {
  return `${PREFIX}${campaignId}`;
}

export function loadPersonalMapView(campaignId: string): MapCameraView | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key(campaignId)) ?? "null");
    return isCamera(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePersonalMapView(campaignId: string, camera: MapCameraView) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(campaignId), JSON.stringify(camera));
  } catch {
    // Camera persistence is a personal convenience and must never block campaign work.
  }
}

export function clearPersonalMapView(campaignId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(campaignId));
  } catch {
    // Ignore storage failures for the same reason as savePersonalMapView.
  }
}
