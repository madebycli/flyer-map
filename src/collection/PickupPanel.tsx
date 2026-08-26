import { useMemo, useState } from "react";
import {
  summarizePickupStatuses,
  validatePickupDraft,
  type PickupDraft,
  type PickupStatus,
} from "../domain/pickup.ts";
import "./pickup-panel.css";

export type PickupListItem = {
  id: string;
  address: string;
  note: string;
  status: PickupStatus;
};

type Props = {
  items: readonly PickupListItem[];
  canEdit: boolean;
  onCreate: (draft: PickupDraft) => void | Promise<void>;
  onStatusChange: (id: string, status: PickupStatus) => void | Promise<void>;
  labels: {
    title: string;
    progress: string;
    address: string;
    note: string;
    add: string;
    adding: string;
    open: string;
    collected: string;
    unavailable: string;
    needsFollowUp: string;
    empty: string;
    invalidAddress: string;
    readOnly: string;
  };
};

const STATUS_ORDER: readonly PickupStatus[] = [
  "open",
  "collected",
  "unavailable",
  "needs-follow-up",
];

export function PickupPanel({ items, canEdit, onCreate, onStatusChange, labels }: Props) {
  const [draft, setDraft] = useState<PickupDraft>({ address: "", note: "", sourceBuildingId: null });
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const summary = useMemo(() => summarizePickupStatuses(items.map((item) => item.status)), [items]);

  const create = async () => {
    const validation = validatePickupDraft(draft);
    if (!canEdit || !validation.valid) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setSubmitting(true);
    try {
      await onCreate(validation.value);
      setDraft({ address: "", note: "", sourceBuildingId: null });
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = (status: PickupStatus) => {
    if (status === "collected") return labels.collected;
    if (status === "unavailable") return labels.unavailable;
    if (status === "needs-follow-up") return labels.needsFollowUp;
    return labels.open;
  };

  return (
    <section className="pickup-panel" aria-label={labels.title}>
      <header className="pickup-panel-header">
        <div>
          <strong>{labels.title}</strong>
          <span>{labels.progress}</span>
        </div>
        <div className="pickup-progress" aria-label={labels.progress}>
          <strong>{summary.percentCollected === null ? "–" : `${Math.round(summary.percentCollected)} %`}</strong>
          <span>{summary.collected} / {summary.total}</span>
        </div>
      </header>

      <div className="pickup-list">
        {items.length === 0 ? <p className="pickup-empty">{labels.empty}</p> : null}
        {items.map((item) => (
          <article className="pickup-card" key={item.id}>
            <div className="pickup-card-copy">
              <strong>{item.address}</strong>
              {item.note ? <p>{item.note}</p> : null}
            </div>
            {canEdit ? (
              <select
                aria-label={`${item.address}: ${labels.progress}`}
                value={item.status}
                onChange={(event) => void onStatusChange(item.id, event.target.value as PickupStatus)}
              >
                {STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>{statusLabel(status)}</option>
                ))}
              </select>
            ) : (
              <span className={`pickup-status is-${item.status}`}>{statusLabel(item.status)}</span>
            )}
          </article>
        ))}
      </div>

      {canEdit ? (
        <div className="pickup-composer">
          <label>
            <span>{labels.address}</span>
            <input
              value={draft.address}
              maxLength={240}
              autoComplete="street-address"
              onChange={(event) => {
                setDraft((current) => ({ ...current, address: event.target.value }));
                if (invalid) setInvalid(false);
              }}
            />
          </label>
          <label>
            <span>{labels.note}</span>
            <textarea
              rows={3}
              value={draft.note}
              maxLength={2_000}
              onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
            />
          </label>
          {invalid ? <p className="pickup-error" role="alert">{labels.invalidAddress}</p> : null}
          <button type="button" disabled={submitting} onClick={() => void create()}>
            {submitting ? labels.adding : labels.add}
          </button>
        </div>
      ) : (
        <p className="pickup-readonly">{labels.readOnly}</p>
      )}
    </section>
  );
}
