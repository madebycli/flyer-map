import { useState } from "react";
import "./comments-panel.css";

export type CommentListItem = {
  id: string;
  body: string | null;
  authorLabel: string;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
  deleted?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
};

type Props = {
  targetLabel: string;
  comments: readonly CommentListItem[];
  canCreate: boolean;
  onSubmit: (body: string) => void | Promise<void>;
  onEdit?: (commentId: string, body: string, expectedUpdatedAt: string) => void | Promise<void>;
  onDelete?: (commentId: string) => void | Promise<void>;
  labels: {
    title: string;
    context: string;
    empty: string;
    placeholder: string;
    submit: string;
    submitting: string;
    invalid: string;
    readOnly: string;
    edit: string;
    saveEdit: string;
    cancelEdit: string;
    delete: string;
    deleting: string;
    deleted: string;
    requestFailed: string;
  };
};

function formatCommentTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function CommentsPanel({ targetLabel, comments, canCreate, onSubmit, onEdit, onDelete, labels }: Props) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionErrorId, setActionErrorId] = useState<string | null>(null);

  const submit = async () => {
    const normalized = body.trim();
    if (!canCreate || normalized.length < 1 || normalized.length > 2_000) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setSubmitError(false);
    setSubmitting(true);
    try {
      await onSubmit(normalized);
      setBody("");
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const saveEdit = async (comment: CommentListItem) => {
    const normalized = editBody.trim();
    if (!onEdit || !comment.updatedAt || normalized.length < 1 || normalized.length > 2_000) {
      setActionErrorId(comment.id);
      return;
    }
    setActionErrorId(null);
    setActionId(comment.id);
    try {
      await onEdit(comment.id, normalized, comment.updatedAt);
      setEditingId(null);
      setEditBody("");
    } catch {
      setActionErrorId(comment.id);
    } finally {
      setActionId(null);
    }
  };

  const removeComment = async (comment: CommentListItem) => {
    if (!onDelete) return;
    setActionErrorId(null);
    setActionId(comment.id);
    try {
      await onDelete(comment.id);
    } catch {
      setActionErrorId(comment.id);
    } finally {
      setActionId(null);
    }
  };

  return (
    <section className="comments-panel" aria-label={labels.title}>
      <header className="comments-panel-header">
        <div>
          <span>{labels.context}</span>
          <strong>{targetLabel}</strong>
        </div>
        <span>{comments.length}</span>
      </header>

      <div className="comments-list" aria-live="polite">
        {comments.length === 0 ? <p className="comments-empty">{labels.empty}</p> : null}
        {comments.map((comment) => (
          <article className="comment-card" key={comment.id}>
            <div className="comment-card-meta">
              <strong>{comment.authorLabel}</strong>
              <time dateTime={comment.createdAt}>{formatCommentTime(comment.createdAt)}</time>
            </div>
            {editingId === comment.id ? (
              <div className="comment-edit-form">
                <textarea
                  value={editBody}
                  maxLength={2_000}
                  rows={4}
                  aria-label={labels.edit}
                  onChange={(event) => setEditBody(event.target.value)}
                />
                <div className="comment-card-actions">
                  <button
                    type="button"
                    className="comment-action"
                    disabled={actionId === comment.id}
                    onClick={() => {
                      setEditingId(null);
                      setEditBody("");
                    }}
                  >
                    {labels.cancelEdit}
                  </button>
                  <button
                    type="button"
                    className="comment-action comment-action-primary"
                    disabled={actionId === comment.id}
                    onClick={() => void saveEdit(comment)}
                  >
                    {actionId === comment.id ? labels.submitting : labels.saveEdit}
                  </button>
                </div>
              </div>
            ) : (
              <p className={comment.deleted ? "comment-tombstone" : undefined}>
                {comment.deleted ? labels.deleted : comment.body}
              </p>
            )}
            {!comment.deleted && editingId !== comment.id && (comment.canEdit || comment.canDelete) ? (
              <div className="comment-card-actions">
                {comment.canEdit && onEdit ? (
                  <button
                    type="button"
                    className="comment-action"
                    disabled={actionId === comment.id}
                    onClick={() => {
                      setEditingId(comment.id);
                      setEditBody(comment.body ?? "");
                      setActionErrorId(null);
                    }}
                  >
                    {labels.edit}
                  </button>
                ) : null}
                {comment.canDelete && onDelete ? (
                  <button
                    type="button"
                    className="comment-action comment-action-danger"
                    disabled={actionId === comment.id}
                    onClick={() => void removeComment(comment)}
                  >
                    {actionId === comment.id ? labels.deleting : labels.delete}
                  </button>
                ) : null}
              </div>
            ) : null}
            {actionErrorId === comment.id ? <p className="comment-error" role="alert">{labels.requestFailed}</p> : null}
          </article>
        ))}
      </div>

      {canCreate ? (
        <div className="comment-composer">
          <textarea
            value={body}
            maxLength={2_000}
            rows={4}
            placeholder={labels.placeholder}
            onChange={(event) => {
              setBody(event.target.value);
              if (invalid) setInvalid(false);
              if (submitError) setSubmitError(false);
            }}
          />
          <div className="comment-composer-footer">
            <span>{body.length} / 2000</span>
            <button type="button" disabled={submitting} onClick={() => void submit()}>
              {submitting ? labels.submitting : labels.submit}
            </button>
          </div>
          {invalid || submitError ? (
            <p className="comment-error" role="alert">{submitError ? labels.requestFailed : labels.invalid}</p>
          ) : null}
        </div>
      ) : (
        <p className="comments-readonly">{labels.readOnly}</p>
      )}
    </section>
  );
}
