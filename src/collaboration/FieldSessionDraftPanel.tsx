import { useMemo, useState } from "react";
import {
  validateFieldSessionDraft,
  type FieldSessionDraft,
  type ValidatedFieldSessionDraft,
} from "../domain/fieldSessionDraft.ts";
import "./field-session-draft.css";

type Props = {
  draft: FieldSessionDraft;
  onChange: (draft: FieldSessionDraft) => void;
  onSubmit: (draft: ValidatedFieldSessionDraft) => void | Promise<void>;
  labels: {
    title: string;
    distribution: string;
    collection: string;
    startedAt: string;
    endedAt: string;
    participants: string;
    note: string;
    duration: string;
    personTime: string;
    submit: string;
    submitting: string;
    invalidTime: string;
    invalidParticipants: string;
    noteTooLong: string;
  };
};

function errorLabel(
  reason: "invalid-time" | "invalid-participants" | "note-too-long",
  labels: Props["labels"],
) {
  if (reason === "invalid-time") return labels.invalidTime;
  if (reason === "invalid-participants") return labels.invalidParticipants;
  return labels.noteTooLong;
}

export function FieldSessionDraftPanel({ draft, onChange, onSubmit, labels }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const validation = useMemo(() => validateFieldSessionDraft(draft), [draft]);

  const change = <K extends keyof FieldSessionDraft>(key: K, value: FieldSessionDraft[K]) => {
    onChange({ ...draft, [key]: value });
  };

  const submit = async () => {
    if (!validation.valid || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(validation.value);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="field-session-draft" aria-label={labels.title}>
      <header>
        <strong>{labels.title}</strong>
        <div className="field-session-mode" role="radiogroup" aria-label={labels.title}>
          {(["distribution", "collection"] as const).map((mode) => (
            <label key={mode}>
              <input
                type="radio"
                name="field-session-mode"
                checked={draft.mode === mode}
                onChange={() => change("mode", mode)}
              />
              <span>{mode === "distribution" ? labels.distribution : labels.collection}</span>
            </label>
          ))}
        </div>
      </header>

      <div className="field-session-grid">
        <label>
          <span>{labels.startedAt}</span>
          <input
            type="datetime-local"
            value={draft.startedAt}
            onChange={(event) => change("startedAt", event.target.value)}
          />
        </label>
        <label>
          <span>{labels.endedAt}</span>
          <input
            type="datetime-local"
            value={draft.endedAt}
            onChange={(event) => change("endedAt", event.target.value)}
          />
        </label>
        <label>
          <span>{labels.participants}</span>
          <input
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            value={draft.participantCount}
            onChange={(event) => change("participantCount", Number(event.target.value))}
          />
        </label>
      </div>

      <label className="field-session-note">
        <span>{labels.note}</span>
        <textarea
          rows={3}
          maxLength={1_000}
          value={draft.note}
          onChange={(event) => change("note", event.target.value)}
        />
      </label>

      {validation.valid ? (
        <dl className="field-session-metrics">
          <div>
            <dt>{labels.duration}</dt>
            <dd>{Math.round(validation.value.metrics.durationMinutes)} min</dd>
          </div>
          <div>
            <dt>{labels.personTime}</dt>
            <dd>{Math.round(validation.value.metrics.personMinutes)} Personenminuten</dd>
          </div>
        </dl>
      ) : (
        <p className="field-session-error" role="status">
          {errorLabel(validation.reason, labels)}
        </p>
      )}

      <button type="button" disabled={!validation.valid || submitting} onClick={() => void submit()}>
        {submitting ? labels.submitting : labels.submit}
      </button>
    </section>
  );
}
