import { CampaignApiError } from "./campaignApi";

export type CommentTargetType =
  | "campaign"
  | "area"
  | "street-task"
  | "house-task"
  | "pickup-task";

export type CommentItem = {
  id: string;
  targetType: CommentTargetType;
  targetId: string;
  body: string | null;
  authorLabel: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deleted: boolean;
  version: number;
  canEdit: boolean;
  canDelete: boolean;
};

export type CommentPage = {
  comments: CommentItem[];
  nextCursor: string | null;
  canCreate: boolean;
};

async function parseError(response: Response) {
  let payload: { error?: { code?: string; message?: string } } | null = null;
  try {
    payload = (await response.json()) as { error?: { code?: string; message?: string } };
  } catch {
    // Keep the generic fallback below.
  }
  return new CampaignApiError(
    response.status,
    payload?.error?.code ?? "request_failed",
    payload?.error?.message ?? `Serveranfrage fehlgeschlagen (${response.status}).`,
  );
}

async function commentsFetch(path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
    });
  } catch {
    throw new CampaignApiError(0, "network_error", "Server ist momentan nicht erreichbar.");
  }
  if (!response.ok) throw await parseError(response);
  return response;
}

function commentsPath(campaignId: string) {
  return `/api/campaigns/${encodeURIComponent(campaignId)}/comments`;
}

export async function fetchComments(
  campaignId: string,
  targetType: CommentTargetType,
  targetId: string,
  options: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {},
) {
  const params = new URLSearchParams({
    targetType,
    targetId,
    limit: String(options.limit ?? 20),
  });
  if (options.cursor) params.set("cursor", options.cursor);
  const response = await commentsFetch(`${commentsPath(campaignId)}?${params.toString()}`, {
    signal: options.signal,
  });
  return (await response.json()) as CommentPage;
}

export async function createComment(
  campaignId: string,
  input: {
    commentId?: string;
    targetType: CommentTargetType;
    targetId: string;
    body: string;
  },
) {
  const response = await commentsFetch(commentsPath(campaignId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as { comment: CommentItem; alreadyCreated: boolean };
}

export async function editComment(
  campaignId: string,
  commentId: string,
  input: { body: string; expectedUpdatedAt: string; requestId?: string },
) {
  const response = await commentsFetch(
    `${commentsPath(campaignId)}/${encodeURIComponent(commentId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return (await response.json()) as { comment: CommentItem; alreadyEdited: boolean };
}

export async function deleteComment(
  campaignId: string,
  commentId: string,
  requestId?: string,
) {
  const response = await commentsFetch(
    `${commentsPath(campaignId)}/${encodeURIComponent(commentId)}`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestId ? { requestId } : {}),
    },
  );
  return (await response.json()) as { comment: CommentItem; alreadyDeleted: boolean };
}
