import { useEffect, useMemo, useRef, useState } from "react";
import {
  createComment,
  deleteComment,
  editComment,
  fetchComments,
  type CommentItem,
  type CommentTargetType,
} from "../data/commentsApi.ts";
import { CampaignApiError, type AccessInfo } from "../data/campaignApi.ts";
import type { Language } from "../i18n.ts";
import { CommentsPanel, type CommentListItem } from "./CommentsPanel.tsx";
import "./comments-context-panel.css";

type Props = {
  campaignId: string;
  targetType: CommentTargetType;
  targetId: string;
  targetLabel: string;
  targetTeamId: string | null;
  access: AccessInfo | null;
  online: boolean;
  language: Language;
};

function errorMessage(error: unknown, language: Language) {
  if (error instanceof CampaignApiError) {
    if (error.code === "pickup_comments_schema_unavailable") {
      return language === "de"
        ? "Pickup-Kommentare sind vorbereitet, aber Migration 0013 ist noch nicht ausgerollt."
        : "Pickup comments are prepared, but migration 0013 has not been rolled out yet.";
    }
    if (error.code === "comments_schema_unavailable") {
      return language === "de"
        ? "Kommentare sind vorbereitet, aber Migration 0008 ist noch nicht ausgerollt."
        : "Comments are prepared, but migration 0008 has not been rolled out yet.";
    }
    if (error.status === 401) {
      return language === "de" ? "Für Kommentare fehlt ein gültiger Zugriff." : "Valid access is required for comments.";
    }
    if (error.status === 403) {
      return language === "de" ? "Dieser Kommentar-Kontext liegt außerhalb deines Zugriffs." : "This comment context is outside your access scope.";
    }
    if (error.code === "network_error") {
      return language === "de" ? "Kommentare sind gerade nicht erreichbar." : "Comments are currently unavailable.";
    }
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return language === "de" ? "Kommentare konnten nicht geladen werden." : "Comments could not be loaded.";
}

export function commentErrorCanRetry(error: unknown) {
  if (!(error instanceof CampaignApiError)) return false;
  if (
    error.code === "comments_schema_unavailable" ||
    error.code === "pickup_comments_schema_unavailable" ||
    error.status === 401 ||
    error.status === 403
  ) {
    return false;
  }
  return error.code === "network_error" || error.status >= 500;
}

function clientCanCreate(
  access: AccessInfo | null,
  targetType: CommentTargetType,
  targetTeamId: string | null,
) {
  if (!access || access.role === "viewer") return false;
  if (access.role === "admin") return true;
  if (access.role === "collection-collector") {
    return targetType === "pickup-task" && Boolean(access.collectorId);
  }
  return (
    targetType !== "campaign" &&
    Boolean(targetTeamId && access.teamId === targetTeamId) &&
    (access.role === "team-editor" || Boolean(access.role === "field-group-member" && access.groupId))
  );
}

function toPanelComment(comment: CommentItem): CommentListItem {
  return comment;
}

export function CommentsContextPanel({
  campaignId,
  targetType,
  targetId,
  targetLabel,
  targetTeamId,
  access,
  online,
  language,
}: Props) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [serverCanCreate, setServerCanCreate] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCanRetry, setErrorCanRetry] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const pendingCreate = useRef<{ id: string; body: string } | null>(null);

  const contextKey = `${campaignId}:${targetType}:${targetId}`;
  const canCreateFallback = useMemo(
    () => clientCanCreate(access, targetType, targetTeamId),
    [access, targetTeamId, targetType],
  );

  useEffect(() => {
    setComments([]);
    setNextCursor(null);
    setServerCanCreate(null);
    setError(null);
    setErrorCanRetry(false);
    pendingCreate.current = null;
  }, [contextKey]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    if (!online) {
      setLoading(false);
      setError(language === "de"
        ? "Offline. Bereits geladene Kommentare bleiben sichtbar."
        : "Offline. Previously loaded comments remain visible.");
      setErrorCanRetry(false);
      return () => controller.abort();
    }

    setLoading(true);
    setError(null);
    void fetchComments(campaignId, targetType, targetId, { signal: controller.signal })
      .then((page) => {
        if (cancelled) return;
        setComments(page.comments);
        setNextCursor(page.nextCursor);
        setServerCanCreate(page.canCreate);
        setError(null);
        setErrorCanRetry(false);
      })
      .catch((reason: unknown) => {
        if (cancelled || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setError(errorMessage(reason, language));
        setErrorCanRetry(commentErrorCanRetry(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [campaignId, language, online, retryToken, targetId, targetType]);

  const retry = () => setRetryToken((current) => current + 1);

  const loadMore = async () => {
    if (!online || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchComments(campaignId, targetType, targetId, { cursor: nextCursor });
      setComments((current) => [...current, ...page.comments]);
      setNextCursor(page.nextCursor);
      setServerCanCreate(page.canCreate);
      setError(null);
      setErrorCanRetry(false);
    } catch (reason) {
      setError(errorMessage(reason, language));
      setErrorCanRetry(commentErrorCanRetry(reason));
    } finally {
      setLoadingMore(false);
    }
  };

  const submit = async (body: string) => {
    if (!online) throw new Error(language === "de" ? "Offline. Kommentar wurde nicht gespeichert." : "Offline. Comment was not saved.");
    const existing = pendingCreate.current;
    const id = existing && existing.body === body
      ? existing.id
      : `comment_${crypto.randomUUID()}`;
    pendingCreate.current = { id, body };
    try {
      const result = await createComment(campaignId, {
        commentId: id,
        targetType,
        targetId,
        body,
      });
      setComments((current) => [result.comment, ...current.filter((comment) => comment.id !== result.comment.id)]);
      setServerCanCreate(true);
      setError(null);
      setErrorCanRetry(false);
      pendingCreate.current = null;
    } catch (reason) {
      setError(errorMessage(reason, language));
      setErrorCanRetry(commentErrorCanRetry(reason));
      throw reason;
    }
  };

  const edit = async (commentId: string, body: string, expectedUpdatedAt: string) => {
    if (!online) throw new Error(language === "de" ? "Offline. Kommentar wurde nicht geändert." : "Offline. Comment was not edited.");
    try {
      const result = await editComment(campaignId, commentId, {
        body,
        expectedUpdatedAt,
        requestId: `edit:${commentId}:${expectedUpdatedAt}`,
      });
      setComments((current) => current.map((comment) => comment.id === commentId ? result.comment : comment));
      setError(null);
      setErrorCanRetry(false);
    } catch (reason) {
      setError(errorMessage(reason, language));
      setErrorCanRetry(commentErrorCanRetry(reason));
      throw reason;
    }
  };

  const remove = async (commentId: string) => {
    if (!online) throw new Error(language === "de" ? "Offline. Kommentar wurde nicht gelöscht." : "Offline. Comment was not deleted.");
    try {
      const result = await deleteComment(campaignId, commentId, `delete:${commentId}`);
      setComments((current) => current.map((comment) => comment.id === commentId ? result.comment : comment));
      setError(null);
      setErrorCanRetry(false);
    } catch (reason) {
      setError(errorMessage(reason, language));
      setErrorCanRetry(commentErrorCanRetry(reason));
      throw reason;
    }
  };

  const labels = language === "de"
    ? {
        title: "Kommentare",
        context: "Kontext",
        empty: loading ? "Kommentare werden geladen …" : "Noch keine Kommentare.",
        placeholder: "Hinweis für diesen Kontext …",
        submit: "Kommentar speichern",
        submitting: "Speichern …",
        invalid: "Kommentar muss 1 bis 2000 Zeichen enthalten.",
        readOnly: "Nur-Lese-Zugriff",
        edit: "Bearbeiten",
        saveEdit: "Änderung speichern",
        cancelEdit: "Abbrechen",
        delete: "Löschen",
        deleting: "Löschen …",
        deleted: "Kommentar gelöscht",
        requestFailed: "Aktion konnte nicht gespeichert werden.",
      }
    : {
        title: "Comments",
        context: "Context",
        empty: loading ? "Loading comments …" : "No comments yet.",
        placeholder: "Add a note for this context …",
        submit: "Save comment",
        submitting: "Saving …",
        invalid: "Comment must contain 1 to 2000 characters.",
        readOnly: "Read-only access",
        edit: "Edit",
        saveEdit: "Save change",
        cancelEdit: "Cancel",
        delete: "Delete",
        deleting: "Deleting …",
        deleted: "Comment deleted",
        requestFailed: "The action could not be saved.",
      };

  const initialReadFailed = Boolean(error && !loading && serverCanCreate === null && comments.length === 0);
  const canCreate = online && !loading && !initialReadFailed && (serverCanCreate ?? canCreateFallback);

  return (
    <section className="comments-context-panel" aria-label={labels.title}>
      {error ? (
        <div className="comments-context-error" role="alert">
          <span>{error}</span>
          {online && errorCanRetry ? <button type="button" onClick={retry}>{language === "de" ? "Erneut versuchen" : "Retry"}</button> : null}
        </div>
      ) : null}
      {!initialReadFailed ? (
        <CommentsPanel
          targetLabel={targetLabel}
          comments={comments.map(toPanelComment)}
          canCreate={canCreate}
          onSubmit={submit}
          onEdit={edit}
          onDelete={remove}
          labels={labels}
        />
      ) : null}
      {nextCursor ? (
        <button className="comments-load-more" type="button" disabled={!online || loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? (language === "de" ? "Weitere Kommentare werden geladen …" : "Loading more comments …") : (language === "de" ? "Weitere Kommentare" : "Load more comments")}
        </button>
      ) : null}
    </section>
  );
}
