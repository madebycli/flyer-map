import {
  AUTOMATION_REGISTRY,
  AUTOMATION_RULE_TYPES,
  automationDefinition,
  type AutomationRuleState,
  type AutomationRuleType,
} from "../src/domain/automations.ts";
import { resolveAccess } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { parseCampaignId } from "./snapshotValidation.ts";

const AUTOMATION_TABLE_INFO = "PRAGMA table_info(automation_rules)";
const REQUIRED_AUTOMATION_COLUMNS = [
  "campaign_id",
  "rule_type",
  "enabled",
  "created_at",
  "updated_at",
] as const;
const MAX_AUTOMATION_BODY_BYTES = 16_384;

type AutomationRow = {
  rule_type: AutomationRuleType;
  enabled: number;
  updated_at: string;
};

type AutomationRoute = {
  campaignId: string;
  ruleType: string | null;
};

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

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export function parseAutomationsRoute(pathname: string): AutomationRoute | null {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/automations(?:\/([^/]+))?$/u);
  if (!match) return null;
  try {
    const campaignId = parseCampaignId(decodeURIComponent(match[1]));
    const ruleType = match[2] ? decodeURIComponent(match[2]) : null;
    if (!campaignId) return null;
    if (ruleType !== null && ruleType.length > 200) return null;
    return { campaignId, ruleType };
  } catch {
    return null;
  }
}

export async function hasAutomationSchema(db: D1DatabaseLike) {
  try {
    const result = await db.prepare(AUTOMATION_TABLE_INFO).all<{ name: string }>();
    const columns = new Set(result.results.map((column) => column.name));
    return REQUIRED_AUTOMATION_COLUMNS.every((column) => columns.has(column));
  } catch {
    return false;
  }
}

function enabledValue(value: number | boolean | null | undefined) {
  return value === 1 || value === true;
}

export async function isAutomationEnabled(
  db: D1DatabaseLike,
  campaignId: string,
  ruleType: AutomationRuleType,
) {
  if (!(await hasAutomationSchema(db))) return false;
  const row = await db
    .prepare(
      `SELECT enabled
       FROM automation_rules
       WHERE campaign_id = ? AND rule_type = ?
       LIMIT 1`,
    )
    .bind(campaignId, ruleType)
    .first<{ enabled: number }>();
  return enabledValue(row?.enabled);
}

function stateFromRow(
  ruleType: AutomationRuleType,
  row: AutomationRow | null,
): AutomationRuleState {
  const definition = automationDefinition(ruleType);
  if (!definition) throw new Error("unknown_automation_rule");
  return {
    ...definition,
    enabled: enabledValue(row?.enabled),
    updatedAt: row?.updated_at ?? null,
  };
}

async function readRule(
  db: D1DatabaseLike,
  campaignId: string,
  ruleType: AutomationRuleType,
) {
  const row = await db
    .prepare(
      `SELECT rule_type, enabled, updated_at
       FROM automation_rules
       WHERE campaign_id = ? AND rule_type = ?
       LIMIT 1`,
    )
    .bind(campaignId, ruleType)
    .first<AutomationRow>();
  return stateFromRow(ruleType, row);
}

async function readBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUTOMATION_BODY_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(413, "payload_too_large", "Automation-Konfiguration ist zu groß."),
    };
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_AUTOMATION_BODY_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(413, "payload_too_large", "Automation-Konfiguration ist zu groß."),
    };
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        ok: false as const,
        response: errorResponse(400, "invalid_request", "Automation-Konfiguration ist ungültig."),
      };
    }
    const body = value as Record<string, unknown>;
    if (Object.keys(body).length !== 1 || typeof body.enabled !== "boolean") {
      return {
        ok: false as const,
        response: errorResponse(400, "invalid_request", "Nur enabled als Boolean ist erlaubt."),
      };
    }
    return { ok: true as const, enabled: body.enabled };
  } catch {
    return {
      ok: false as const,
      response: errorResponse(400, "invalid_json", "Request-Body ist kein gültiges JSON."),
    };
  }
}

function schemaUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table.*automation_rules|automation_rules.*does not exist|no such column.*automation_rules/iu.test(
    message,
  );
}

export async function handleAutomationsApi(
  request: Request,
  db: D1DatabaseLike,
): Promise<Response | null> {
  const route = parseAutomationsRoute(new URL(request.url).pathname);
  if (!route) return null;

  if (request.method !== "GET" && !sameOrigin(request)) {
    return errorResponse(403, "origin_forbidden", "Cross-Origin-Schreibzugriffe sind nicht erlaubt.");
  }
  if (request.method !== "GET" && request.method !== "PATCH") {
    return errorResponse(405, "method_not_allowed", "Für Automationen sind nur GET und PATCH erlaubt.");
  }

  try {
    const access = await resolveAccess(db, request, route.campaignId);
    if (!access) return errorResponse(401, "access_required", "Gültiger Campaign-Zugriff ist erforderlich.");
    if (access.role !== "admin") {
      return errorResponse(403, "automation_admin_required", "Nur Campaign-Admins dürfen Automationen verwalten.");
    }
    if (!(await hasAutomationSchema(db))) {
      return errorResponse(
        503,
        "automation_schema_unavailable",
        "Automationen sind vorbereitet, aber Migration 0009 ist noch nicht angewendet.",
      );
    }

    if (request.method === "GET") {
      if (route.ruleType !== null) {
        return errorResponse(404, "automation_not_found", "Automation-Regel ist nicht bekannt.");
      }
      const automations = await Promise.all(
        AUTOMATION_REGISTRY.map((definition) => readRule(db, route.campaignId, definition.ruleType)),
      );
      return json({ automations });
    }

    const ruleType = route.ruleType ? automationDefinition(route.ruleType) : null;
    if (!ruleType) {
      return errorResponse(404, "automation_not_found", "Automation-Regel ist nicht bekannt.");
    }

    const body = await readBody(request);
    if (!body.ok) return body.response;
    const timestamp = new Date().toISOString();
    const result = await db.batch([
      db
        .prepare(
          `INSERT INTO automation_rules (
             campaign_id, rule_type, enabled, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (campaign_id, rule_type) DO UPDATE SET
             enabled = excluded.enabled,
             updated_at = excluded.updated_at`,
        )
        .bind(route.campaignId, ruleType.ruleType, body.enabled ? 1 : 0, timestamp, timestamp),
    ]);
    if ((result[0]?.meta?.changes ?? 0) < 1) {
      return errorResponse(500, "automation_write_failed", "Automation-Status konnte nicht gespeichert werden.");
    }
    return json({ automation: await readRule(db, route.campaignId, ruleType.ruleType) });
  } catch (error) {
    if (schemaUnavailable(error)) {
      return errorResponse(
        503,
        "automation_schema_unavailable",
        "Automationen sind vorbereitet, aber Migration 0009 ist noch nicht angewendet.",
      );
    }
    return errorResponse(500, "automation_failed", "Automation-Konfiguration konnte nicht verarbeitet werden.");
  }
}
