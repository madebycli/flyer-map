import "./field-session-history.css";

export type FieldSessionHistoryItem = {
  id: string;
  mode: "distribution" | "collection";
  startedAt: string;
  durationMinutes: number;
  participantCount: number;
  personMinutes: number;
  affectedTaskCount: number;
  note: string;
};

type Props = {
  items: readonly FieldSessionHistoryItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  labels: {
    title: string;
    empty: string;
    distribution: string;
    collection: string;
    participants: string;
    duration: string;
    personTime: string;
    affectedTasks: string;
    selected: string;
  };
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatHours(minutes: number) {
  if (!Number.isFinite(minutes) || minutes < 0) return "–";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

export function FieldSessionHistory({ items, selectedId, onSelect, labels }: Props) {
  return (
    <section className="field-session-history" aria-label={labels.title}>
      <header>
        <strong>{labels.title}</strong>
        <span>{items.length}</span>
      </header>
      {items.length === 0 ? <p className="field-session-history-empty">{labels.empty}</p> : null}
      <div className="field-session-history-list">
        {items.map((item) => {
          const selected = item.id === selectedId;
          return (
            <button
              type="button"
              key={item.id}
              className={`field-session-history-card ${selected ? "is-selected" : ""}`}
              aria-pressed={selected}
              onClick={() => onSelect(selected ? null : item.id)}
            >
              <span className="field-session-history-date">{formatDate(item.startedAt)}</span>
              <strong>{item.mode === "distribution" ? labels.distribution : labels.collection}</strong>
              <dl>
                <div>
                  <dt>{labels.duration}</dt>
                  <dd>{formatHours(item.durationMinutes)}</dd>
                </div>
                <div>
                  <dt>{labels.participants}</dt>
                  <dd>{item.participantCount}</dd>
                </div>
                <div>
                  <dt>{labels.personTime}</dt>
                  <dd>{formatHours(item.personMinutes)}</dd>
                </div>
                <div>
                  <dt>{labels.affectedTasks}</dt>
                  <dd>{item.affectedTaskCount}</dd>
                </div>
              </dl>
              {item.note ? <p>{item.note}</p> : null}
              {selected ? <span className="field-session-history-selected">{labels.selected}</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
