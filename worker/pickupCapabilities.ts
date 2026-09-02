import { resolvePersistentAccess } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { hasPickupReadSchema } from "./pickupRepository.ts";

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;

export type PickupCapabilities = {
  canViewPickups: boolean;
  canCreatePickups: boolean;
  canEditPickups: boolean;
  canAssignPickups: boolean;
};

export type PickupCapabilityUpdate = {
  canViewPickups?: boolean;
  canCreatePickups: boolean;
  canEditPickups: boolean;
  canAssignPickups: boolean;
};

type CapabilityRow = {
  can_view_pickups?: number;
  can_create_pickups: number;
  can_edit_pickups: number;
  can_assign_pickups: number;
};

type CollectorRow = CapabilityRow & {
  id: string;
};

export class PickupVisibilitySchemaUnavailableError extends Error {
  constructor() {
    super("Pickup-Sichtbarkeit benötigt die vorbereitete Visibility-Migration.");
    this.name = "PickupVisibilitySchemaUnavailableError";
  }
}

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init.headers,
    },
  });

function errorResponse(status: number, code: string, message: string) {
  return json({ error: { code, message } }, { status });
}

export async function hasPickupVisibilitySchema(db: D1DatabaseLike) {
  try {
    const result = await db
      .prepare("PRAGMA table_info(collection_collectors)")
      .all<{ name: string }>();
    return result.results.some((column) => column.name === "can_view_pickups");
  } catch {
    return false;
  }
}

function capabilitiesFromRow(
  row: CapabilityRow | null,
  visibilitySchemaAvailable: boolean,
): PickupCapabilities {
  if (!row) {
    return {
      canViewPickups: false,
      canCreatePickups: false,
      canEditPickups: false,
      canAssignPickups: false,
    };
  }
  return {
    canViewPickups: visibilitySchemaAvailable ? row.can_view_pickups === 1 : true,
    canCreatePickups: row.can_create_pickups === 1,
    canEditPickups: row.can_edit_pickups === 1,
    canAssignPickups: row.can_assign_pickups === 1,
  };
}

export async function loadPickupCapabilities(
  db: D1DatabaseLike,
  campaignId: string,
  collectorId: string,
) {
  const visibilitySchemaAvailable = await hasPickupVisibilitySchema(db);
  const select = visibilitySchemaAvailable
    ? "can_view_pickups, can_create_pickups, can_edit_pickups, can_assign_pickups"
    : "can_create_pickups, can_edit_pickups, can_assign_pickups";
  const row = await db
    .prepare(
      `SELECT ${select}
         FROM collection_collectors
        WHERE id = ? AND campaign_id = ? AND revoked_at IS NULL
        LIMIT 1`,
    )
    .bind(collectorId, campaignId)
    .first<CapabilityRow>();
  return row ? capabilitiesFromRow(row, visibilitySchemaAvailable) : null;
}

export async function updatePickupCapabilities(
  db: D1DatabaseLike,
  campaignId: string,
  collectorId: string,
  capabilities: PickupCapabilityUpdate,
) {
  const visibilitySchemaAvailable = await hasPickupVisibilitySchema(db);
  if (capabilities.canViewPickups !== undefined && !visibilitySchemaAvailable) {
    throw new PickupVisibilitySchemaUnavailableError();
  }

  const viewValue = capabilities.canViewPickups === undefined
    ? null
    : capabilities.canViewPickups
      ? 1
      : 0;
  const statement = visibilitySchemaAvailable
    ? db
        .prepare(
          `UPDATE collection_collectors
              SET can_view_pickups = COALESCE(?, can_view_pickups),
                  can_create_pickups = CASE
                    WHEN COALESCE(?, can_view_pickups) = 1 THEN ? ELSE 0 END,
                  can_edit_pickups = CASE
                    WHEN COALESCE(?, can_view_pickups) = 1 THEN ? ELSE 0 END,
                  can_assign_pickups = CASE
                    WHEN COALESCE(?, can_view_pickups) = 1 THEN ? ELSE 0 END
            WHERE id = ? AND campaign_id = ? AND revoked_at IS NULL`,
        )
        .bind(
          viewValue,
          viewValue,
          capabilities.canCreatePickups ? 1 : 0,
          viewValue,
          capabilities.canEditPickups ? 1 : 0,
          viewValue,
          capabilities.canAssignPickups ? 1 : 0,
          collectorId,
          campaignId,
        )
    : db
        .prepare(
          `UPDATE collection_collectors
              SET can_create_pickups = ?,
                  can_edit_pickups = ?,
                  can_assign_pickups = ?
            WHERE id = ? AND campaign_id = ? AND revoked_at IS NULL`,
        )
        .bind(
          capabilities.canCreatePickups ? 1 : 0,
          capabilities.canEditPickups ? 1 : 0,
          capabilities.canAssignPickups ? 1 : 0,
          collectorId,
          campaignId,
        );

  const [result] = await db.batch([statement]);
  return (result?.meta?.changes ?? 0) === 1;
}

function capabilityRoute(pathname: string) {
  const match = pathname.match(
    /^\/api\/campaigns\/([^/]+)\/collection\/collectors\/([^/]+)\/pickup-capabilities$/u,
  );
  if (!match) return null;
  try {
    const campaignId = decodeURIComponent(match[1]);
    const collectorId = decodeURIComponent(match[2]);
    if (!ID_PATTERN.test(campaignId) || !ID_PATTERN.test(collectorId)) return null;
    return { campaignId, collectorId };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCapabilities(value: unknown): PickupCapabilityUpdate | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  const allowed = new Set([
    "canViewPickups",
    "canCreatePickups",
    "canEditPickups",
    "canAssignPickups",
  ]);
  if (keys.some((key) => !allowed.has(key))) return null;
  if (
    typeof value.canCreatePickups !== "boolean" ||
    typeof value.canEditPickups !== "boolean" ||
    typeof value.canAssignPickups !== "boolean" ||
    (value.canViewPickups !== undefined && typeof value.canViewPickups !== "boolean")
  ) {
    return null;
  }
  return {
    ...(value.canViewPickups === undefined ? {} : { canViewPickups: value.canViewPickups }),
    canCreatePickups: value.canCreatePickups,
    canEditPickups: value.canEditPickups,
    canAssignPickups: value.canAssignPickups,
  };
}

export async function handlePickupCapabilitiesApi(
  request: Request,
  db: D1DatabaseLike,
): Promise<Response | null> {
  const route = capabilityRoute(new URL(request.url).pathname);
  if (!route) return null;
  if (request.method !== "PUT") {
    return errorResponse(405, "method_not_allowed", "Pickup-Rechte werden mit PUT geändert.");
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return errorResponse(403, "origin_forbidden", "Cross-Origin-Schreibzugriffe sind nicht erlaubt.");
  }
  if (!(await hasPickupReadSchema(db))) {
    return errorResponse(
      503,
      "pickup_schema_unavailable",
      "Pickup-Rechte benötigen die vorbereitete Migration 0011.",
    );
  }
  const access = await resolvePersistentAccess(db, request, route.campaignId);
  if (access?.role !== "admin") {
    return errorResponse(403, "forbidden", "Nur Admins dürfen Pickup-Rechte ändern.");
  }

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request-Body ist kein gültiges JSON.");
  }
  const capabilities = parseCapabilities(value);
  if (!capabilities) {
    return errorResponse(422, "capabilities_invalid", "Pickup-Rechte sind ungültig.");
  }

  try {
    if (!(await updatePickupCapabilities(db, route.campaignId, route.collectorId, capabilities))) {
      return errorResponse(404, "collector_not_found", "Collection-Helfer wurde nicht gefunden.");
    }
  } catch (error) {
    if (error instanceof PickupVisibilitySchemaUnavailableError) {
      return errorResponse(
        503,
        "pickup_visibility_schema_unavailable",
        "Pickup-Sichtbarkeit benötigt die vorbereitete Visibility-Migration.",
      );
    }
    throw error;
  }

  const updated = await loadPickupCapabilities(db, route.campaignId, route.collectorId);
  if (!updated) {
    return errorResponse(404, "collector_not_found", "Collection-Helfer wurde nicht gefunden.");
  }
  return json({ collectorId: route.collectorId, capabilities: updated });
}

function collectorCampaignFromPath(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/collection\/collectors$/u);
  if (!match) return null;
  try {
    const campaignId = decodeURIComponent(match[1]);
    return ID_PATTERN.test(campaignId) ? campaignId : null;
  } catch {
    return null;
  }
}

function accessCampaignFromPayload(payload: Record<string, unknown>) {
  const access = payload.access;
  if (!isRecord(access)) return null;
  const campaignId = typeof access.campaignId === "string" ? access.campaignId : null;
  const collectorId = typeof access.collectorId === "string" ? access.collectorId : null;
  if (!campaignId || !collectorId || !ID_PATTERN.test(campaignId) || !ID_PATTERN.test(collectorId)) {
    return null;
  }
  return { access, campaignId, collectorId };
}

async function cloneJson(response: Response) {
  try {
    const value = await response.clone().json();
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function jsonWithResponseMetadata(response: Response, payload: unknown) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json(payload, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function augmentPickupCapabilitiesResponse(
  request: Request,
  response: Response,
  db: D1DatabaseLike,
) {
  if (!response.ok || request.method !== "GET" && request.method !== "POST") return response;
  const url = new URL(request.url);
  const payload = await cloneJson(response);
  if (!payload) return response;

  if (
    url.pathname === "/api/collection/access/current" ||
    url.pathname === "/api/collection/access/redeem"
  ) {
    const resolved = accessCampaignFromPayload(payload);
    if (!resolved) return response;
    const capabilities = await loadPickupCapabilities(db, resolved.campaignId, resolved.collectorId);
    if (!capabilities) return response;
    return jsonWithResponseMetadata(response, {
      ...payload,
      access: { ...resolved.access, collectionCapabilities: capabilities },
    });
  }

  const campaignId = collectorCampaignFromPath(url.pathname);
  if (!campaignId || request.method !== "GET" || !Array.isArray(payload.collectors)) return response;
  const visibilitySchemaAvailable = await hasPickupVisibilitySchema(db);
  const select = visibilitySchemaAvailable
    ? "id, can_view_pickups, can_create_pickups, can_edit_pickups, can_assign_pickups"
    : "id, can_create_pickups, can_edit_pickups, can_assign_pickups";
  const rows = await db
    .prepare(
      `SELECT ${select}
         FROM collection_collectors
        WHERE campaign_id = ?`,
    )
    .bind(campaignId)
    .all<CollectorRow>();
  const byId = new Map(
    rows.results.map((row) => [row.id, capabilitiesFromRow(row, visibilitySchemaAvailable)]),
  );
  return jsonWithResponseMetadata(response, {
    ...payload,
    collectors: payload.collectors.map((candidate) => {
      if (!isRecord(candidate) || typeof candidate.id !== "string") return candidate;
      return {
        ...candidate,
        collectionCapabilities: byId.get(candidate.id) ?? capabilitiesFromRow(null, visibilitySchemaAvailable),
      };
    }),
  });
}
