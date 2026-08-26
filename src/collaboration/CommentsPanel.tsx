import { useState } from "react";
import "./comments-panel.css";

export type CommentListItem = {
  id: string;
  body: string;
  authorLabel: string;
  createdAt: string;
};

type Props = {
  targetLabel: string;
  comments: readonly CommentListItem[];
  canCreate: boolean;
  onSubmit: (body: string) => void | Promise<void>;
  labels: {
    title: string;
    context: string;
    empty: string;
    placeholder: string;
    submit: string;
    submitting: string;
    invalid: string;
    readOnly: string;
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

export function CommentsPanel({ targetLabel, comments, canCreate, onSubmit, labels }: Props) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const submit = async () => {
    const normalized = body.trim();
    if (!canCreate || normalized.length < 1 || normalized.length > 2_000) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setSubmitting(true);
    try {
      await onSubmit(normalized);
      setBody("");
    } finally {
      setSubmitting(false);
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
            <p>{comment.body}</p>
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
            }}
          />
          <div className="comment-composer-footer">
            <span>{body.length} / 2000</span>
            <button type="button" disabled={submitting} onClick={() => void submit()}>
              {submitting ? labels.submitting : labels.submit}
            </button>
          </div>
          {invalid ? <p className="comment-error" role="alert">{labels.invalid}</p> : null}
        </div>
      ) : (
        <p className="comments-readonly">{labels.readOnly}</p>
      )}
    </section>
  );
}
