export type CollectionPickupCapabilities = {
  canViewPickups: boolean;
  canCreatePickups: boolean;
  canEditPickups: boolean;
  canAssignPickups: boolean;
};

export const DEFAULT_COLLECTION_PICKUP_CAPABILITIES: CollectionPickupCapabilities = {
  canViewPickups: true,
  canCreatePickups: false,
  canEditPickups: false,
  canAssignPickups: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function collectionPickupCapabilitiesFromUnknown(
  value: unknown,
): CollectionPickupCapabilities {
  if (!isRecord(value)) return { ...DEFAULT_COLLECTION_PICKUP_CAPABILITIES };
  return {
    canViewPickups: value.canViewPickups === true,
    canCreatePickups: value.canCreatePickups === true,
    canEditPickups: value.canEditPickups === true,
    canAssignPickups: value.canAssignPickups === true,
  };
}

export async function updateCollectionPickupCapabilities(
  campaignId: string,
  collectorId: string,
  capabilities: CollectionPickupCapabilities,
) {
  const response = await fetch(
    "/api/campaigns/" + encodeURIComponent(campaignId) +
      "/collection/collectors/" + encodeURIComponent(collectorId) +
      "/pickup-capabilities",
    {
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(capabilities),
    },
  );
  if (!response.ok) {
    let message = "Pickup-Rechte konnten nicht gespeichert werden.";
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      if (payload.error?.message) message = payload.error.message;
    } catch {
      // Keep the bounded generic error above.
    }
    throw new Error(message);
  }
  const payload = (await response.json()) as {
    collectorId: string;
    capabilities: unknown;
  };
  return collectionPickupCapabilitiesFromUnknown(payload.capabilities);
}
