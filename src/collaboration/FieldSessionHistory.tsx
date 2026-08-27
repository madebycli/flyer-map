import type { FieldSessionSummary } from "../data/fieldSessionApi.ts";
import "./field-session-history.css";

type Props = {
  items: readonly FieldSessionSummary[];
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "–";
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

function endReasonLabel(item: FieldSessionSummary) {
  if (item.status === "active") return "Aktiv";
  if (item.endReason === "group-expired") return "Automatisch beendet";
  return "Abgeschlossen";
}

export function FieldSessionHistory({ items }: Props) {
  return (
    <section className="field-session-history" aria-label="Einsatzhistorie">
      <header>
        <strong>Einsatzhistorie</strong>
        <span>{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="field-session-history-empty">Noch keine gespeicherten Einsätze.</p>
      ) : null}
      <div className="field-session-history-list">
        {items.map((item) => (
          <article className="field-session-history-card" key={item.id}>
            <div className="field-session-history-card-topline">
              <span className="field-session-history-date">{formatDate(item.startedAt)}</span>
              <span
                className="field-session-history-team-dot"
                style={{ backgroundColor: item.teamColor }}
                aria-hidden="true"
              />
            </div>
            <strong>
              {item.mode === "distribution" ? "Flyer verteilen" : "Kleidersammlung"}
            </strong>
            <span className="field-session-history-team">{item.teamName}</span>
            <dl>
              <div>
                <dt>Dauer</dt>
                <dd>{formatDuration(item.durationSeconds)}</dd>
              </div>
              <div>
                <dt>Personen</dt>
                <dd>{item.participantCount ?? "–"}</dd>
              </div>
              <div>
                <dt>Personenzeit</dt>
                <dd>{formatDuration(item.personSeconds)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{endReasonLabel(item)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
