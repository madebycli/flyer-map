import { useMemo, useState } from "react";
import type { LngLat } from "../domain/campaign.ts";
import {
  summarizePickupStatuses,
  validatePickupDraft,
  type PickupDraft,
  type PickupSource,
  type PickupStatus,
} from "../domain/pickup.ts";
import "./pickup-panel.css";

export type PickupListItem = {
  id: string;
  title: string;
  address: string;
  description: string;
  status: PickupStatus;
};

type Props = {
  items: readonly PickupListItem[];
  canEdit: boolean;
  position: LngLat | null;
  areaId?: string | null;
  source?: PickupSource | null;
  onCreate: (draft: PickupDraft & { position: LngLat }) => void | Promise<void>;
  onStatusChange: (id: string, status: PickupStatus) => void | Promise<void>;
  labels: {
    title: string;
    progress: string;
    pickupTitle: string;
    address: string;
    description: string;
    add: string;
    adding: string;
    open: string;
    collected: string;
    unavailable: string;
    needsFollowUp: string;
    empty: string;
    invalidDraft: string;
    positionRequired: string;
    readOnly: string;
  };
};

const STATUS_ORDER: readonly PickupStatus[] = [
  "open",
  "collected",
  "unavailable",
  "needs-follow-up",
];

export function PickupPanel({
  items,
  canEdit,
  position,
  areaId = null,
  source = null,
  onCreate,
  onStatusChange,
  labels,
}: Props) {
  const [draft, setDraft] = useState({ title: "", address: "", description: "" });
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const summary = useMemo(() => summarizePickupStatuses(items.map((item) => item.status)), [items]);

  const create = async () => {
    const validation = validatePickupDraft({
      ...draft,
      position,
      areaId,
      source,
    });
    if (!canEdit || !validation.valid) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setSubmitting(true);
    try {
      await onCreate(validation.value);
      setDraft({ title: "", address: "", description: "" });
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
              <strong>{item.title}</strong>
              <small>{item.address}</small>
              {item.description ? <p>{item.description}</p> : null}
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
            <span>{labels.pickupTitle}</span>
            <input
              value={draft.title}
              maxLength={160}
              onChange={(event) => {
                setDraft((current) => ({ ...current, title: event.target.value }));
                if (invalid) setInvalid(false);
              }}
            />
          </label>
          <label>
            <span>{labels.address}</span>
            <input
              value={draft.address}
              maxLength={320}
              autoComplete="street-address"
              onChange={(event) => {
                setDraft((current) => ({ ...current, address: event.target.value }));
                if (invalid) setInvalid(false);
              }}
            />
          </label>
          <label>
            <span>{labels.description}</span>
            <textarea
              rows={3}
              value={draft.description}
              maxLength={4_000}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          {!position ? <p className="pickup-error">{labels.positionRequired}</p> : null}
          {invalid ? <p className="pickup-error" role="alert">{labels.invalidDraft}</p> : null}
          <button type="button" disabled={submitting || !position} onClick={() => void create()}>
            {submitting ? labels.adding : labels.add}
          </button>
        </div>
      ) : (
        <p className="pickup-readonly">{labels.readOnly}</p>
      )}
    </section>
  );
}
