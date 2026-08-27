import { resolveAccess, type AccessContext } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { parseCampaignId } from "./snapshotValidation.ts";

const MAX_NOTE_LENGTH = 1_000;
const MAX_BODY_BYTES = 4_096;

type FieldSessionNoteRoute = {
  campaignId: string;
  sessionId: string;
};

type SessionScopeRow = {
  id: string;
  team_id: string;
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

function validSelector(value: string) {
  return /^[A-Za-z0-9._:-]{1,200}$/u.test(value);
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export function parseFieldSessionNoteRoute(pathname: string): FieldSessionNoteRoute | null {
  const match = pathname.match(
    /^\/api\/campaigns\/([^/]+)\/field-sessions\/([^/]+)\/note$/u,
  );
  if (!match) return null;
  try {
    const campaignId = parseCampaignId(decodeURIComponent(match[1]));
    const sessionId = decodeURIComponent(match[2]);
    if (!campaignId || !validSelector(sessionId)) return null;
    return { campaignId, sessionId };
  } catch {
    return null;
  }
}

function canEditSessionNote(access: AccessContext, session: SessionScopeRow) {
  if (access.role === "admin") return true;
  return access.role === "team-editor" && Boolean(access.teamId && access.teamId === session.team_id);
}

async function parseNoteBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { ok: false as const, response: errorResponse(413, "request_too_large", "Notiz-Anfrage ist zu groß.") };
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return { ok: false as const, response: errorResponse(413, "request_too_large", "Notiz-Anfrage ist zu groß.") };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false as const, response: errorResponse(400, "invalid_json", "Notiz-Anfrage ist ungültig.") };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false as const, response: errorResponse(400, "invalid_note", "Notiz ist ungültig.") };
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.note !== "string") {
    return { ok: false as const, response: errorResponse(400, "invalid_note", "Notiz ist ungültig.") };
  }

  const note = record.note.trim();
  if (note.length > MAX_NOTE_LENGTH) {
    return {
      ok: false as const,
      response: errorResponse(400, "note_too_long", `Notiz darf höchstens ${MAX_NOTE_LENGTH} Zeichen lang sein.`),
    };
  }
  return { ok: true as const, note: note || null };
}

function schemaUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table.*field_sessions|field_sessions.*does not exist|no such column.*note/iu.test(message);
}

export async function handleFieldSessionNoteApi(
  request: Request,
  db: D1DatabaseLike,
): Promise<Response | null> {
  const route = parseFieldSessionNoteRoute(new URL(request.url).pathname);
  if (!route) return null;
  if (request.method !== "PATCH") {
    return errorResponse(405, "method_not_allowed", "Für Einsatz-Notizen ist nur PATCH erlaubt.");
  }
  if (!sameOrigin(request)) {
    return errorResponse(403, "origin_forbidden", "Cross-Origin-Schreibzugriffe sind nicht erlaubt.");
  }

  try {
    const access = await resolveAccess(db, request, route.campaignId);
    if (!access) {
      return errorResponse(401, "access_required", "Gültiger Campaign-Zugriff ist erforderlich.");
    }

    const session = await db
      .prepare(
        `SELECT id, team_id
         FROM field_sessions
         WHERE id = ? AND campaign_id = ?
         LIMIT 1`,
      )
      .bind(route.sessionId, route.campaignId)
      .first<SessionScopeRow>();
    if (!session) {
      return errorResponse(404, "field_session_not_found", "Einsatz wurde nicht gefunden.");
    }
    if (!canEditSessionNote(access, session)) {
      return errorResponse(403, "field_session_note_forbidden", "Du darfst diese Einsatz-Notiz nicht ändern.");
    }

    const body = await parseNoteBody(request);
    if (!body.ok) return body.response;

    const updatedAt = new Date().toISOString();
    const result = await db
      .prepare(
        `UPDATE field_sessions
         SET note = ?, updated_at = ?
         WHERE id = ? AND campaign_id = ?`,
      )
      .bind(body.note, updatedAt, route.sessionId, route.campaignId)
      .run();
    if ((result.meta?.changes ?? 0) !== 1) {
      return errorResponse(409, "field_session_note_conflict", "Einsatz-Notiz konnte nicht aktualisiert werden.");
    }

    return json({ note: body.note, updatedAt });
  } catch (error) {
    if (schemaUnavailable(error)) {
      return errorResponse(
        503,
        "field_session_schema_unavailable",
        "Field-Session-Datenbankmigration ist noch nicht angewendet.",
      );
    }
    return errorResponse(500, "field_session_note_failed", "Einsatz-Notiz konnte nicht gespeichert werden.");
  }
}
