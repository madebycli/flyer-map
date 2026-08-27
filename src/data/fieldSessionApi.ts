import { CampaignApiError } from "./campaignApi.ts";

export type FieldSessionMode = "distribution" | "collection";
export type FieldSessionStatus = "active" | "closed";
export type FieldSessionEndReason = "manual-close" | "group-expired" | null;
export type FieldSessionTaskEntityType = "street-task" | "house-task";

export type FieldSessionSummary = {
  id: string;
  campaignId: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  fieldGroupId: string | null;
  mode: FieldSessionMode;
  startedAt: string;
  endedAt: string | null;
  endReason: FieldSessionEndReason;
  durationSeconds: number | null;
  participantCount: number | null;
  personSeconds: number | null;
  affectedTaskCount: number;
  status: FieldSessionStatus;
};

export type FieldSessionHistoryPage = {
  sessions: FieldSessionSummary[];
  nextCursor: string | null;
};

export type FieldSessionTaskRef = {
  entityType: FieldSessionTaskEntityType;
  entityId: string;
};

export type FieldSessionTaskRefPage = {
  taskRefs: FieldSessionTaskRef[];
  nextCursor: string | null;
};

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

async function parseError(response: Response) {
  let payload: ApiErrorPayload | null = null;
  try {
    payload = (await response.json()) as ApiErrorPayload;
  } catch {
    // Keep generic fallback below.
  }
  return new CampaignApiError(
    response.status,
    payload?.error?.code ?? "request_failed",
    payload?.error?.message ?? `Serveranfrage fehlgeschlagen (${response.status}).`,
  );
}

export async function fetchFieldSessions(
  campaignId: string,
  options: {
    teamId?: string | null;
    cursor?: string | null;
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<FieldSessionHistoryPage> {
  const params = new URLSearchParams();
  if (options.teamId) params.set("team", options.teamId);
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.size > 0 ? `?${params.toString()}` : "";

  let response: Response;
  try {
    response = await fetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/field-sessions${query}`,
      {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal: options.signal,
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new CampaignApiError(0, "network_error", "Server ist momentan nicht erreichbar.");
  }

  if (!response.ok) throw await parseError(response);
  return (await response.json()) as FieldSessionHistoryPage;
}

export async function fetchFieldSessionTaskRefs(
  campaignId: string,
  sessionId: string,
  options: {
    cursor?: string | null;
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<FieldSessionTaskRefPage> {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.size > 0 ? `?${params.toString()}` : "";

  let response: Response;
  try {
    response = await fetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/field-sessions/${encodeURIComponent(sessionId)}/tasks${query}`,
      {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal: options.signal,
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new CampaignApiError(0, "network_error", "Server ist momentan nicht erreichbar.");
  }

  if (!response.ok) throw await parseError(response);
  return (await response.json()) as FieldSessionTaskRefPage;
}

export async function fetchAllFieldSessionTaskRefs(
  campaignId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<FieldSessionTaskRef[]> {
  const taskRefs: FieldSessionTaskRef[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const page = await fetchFieldSessionTaskRefs(campaignId, sessionId, {
      cursor,
      limit: 1000,
      signal,
    });
    taskRefs.push(...page.taskRefs);
    if (!page.nextCursor) return taskRefs;
    if (seenCursors.has(page.nextCursor)) {
      throw new CampaignApiError(0, "field_session_task_cursor_loop", "Einsatz-Aufgaben konnten nicht vollständig geladen werden.");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  throw new CampaignApiError(
    0,
    "field_session_task_limit_exceeded",
    "Dieser Einsatz enthält zu viele Aufgaben für die Kartenansicht.",
  );
}
