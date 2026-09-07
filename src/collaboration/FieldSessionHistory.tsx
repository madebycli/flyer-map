import { useState } from "react";
import {
  FIELD_SESSION_NOTE_MAX_LENGTH,
  type FieldSessionSummary,
} from "../data/fieldSessionApi.ts";
import "./field-session-history.css";

type Props = {
  items: readonly FieldSessionSummary[];
  highlightingSessionId?: string | null;
  noteSavingSessionId?: string | null;
  canEditNote?: (item: FieldSessionSummary) => boolean;
  onSaveNote?: (item: FieldSessionSummary, note: string) => Promise<boolean>;
  onShowOnMap?: (item: FieldSessionSummary) => void;
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

export function FieldSessionHistory({
  items,
  highlightingSessionId = null,
  noteSavingSessionId = null,
  canEditNote,
  onSaveNote,
  onShowOnMap,
}: Props) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const beginEdit = (item: FieldSessionSummary) => {
    setEditingSessionId(item.id);
    setNoteDraft(item.note ?? "");
  };

  const cancelEdit = () => {
    setEditingSessionId(null);
    setNoteDraft("");
  };

  const saveNote = async (item: FieldSessionSummary) => {
    if (!onSaveNote) return;
    const saved = await onSaveNote(item, noteDraft);
    if (saved) cancelEdit();
  };

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
        {items.map((item) => {
          const editing = editingSessionId === item.id;
          const saving = noteSavingSessionId === item.id;
          const editable = Boolean(canEditNote?.(item) && onSaveNote);

          return (
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
                  <dt>Aufgaben</dt>
                  <dd>{item.affectedTaskCount}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{endReasonLabel(item)}</dd>
                </div>
              </dl>

              <div className="field-session-history-note">
                <div className="field-session-history-note-heading">
                  <span>Notiz</span>
                  {editable && !editing ? (
                    <button type="button" onClick={() => beginEdit(item)}>
                      {item.note ? "Bearbeiten" : "Hinzufügen"}
                    </button>
                  ) : null}
                </div>
                {editing ? (
                  <div className="field-session-history-note-editor">
                    <textarea
                      value={noteDraft}
                      maxLength={FIELD_SESSION_NOTE_MAX_LENGTH}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      aria-label={`Notiz für Einsatz ${formatDate(item.startedAt)}`}
                      disabled={saving}
                    />
                    <div className="field-session-history-note-editor-footer">
                      <span>{noteDraft.length}/{FIELD_SESSION_NOTE_MAX_LENGTH}</span>
                      <div>
                        <button type="button" onClick={cancelEdit} disabled={saving}>
                          Abbrechen
                        </button>
                        <button type="button" onClick={() => void saveNote(item)} disabled={saving}>
                          {saving ? "Speichert ..." : "Speichern"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : item.note ? (
                  <p>{item.note}</p>
                ) : (
                  <p className="field-session-history-note-empty">Keine Notiz.</p>
                )}
              </div>

              {onShowOnMap && item.affectedTaskCount > 0 ? (
                <button
                  className="field-session-history-map-button"
                  type="button"
                  onClick={() => onShowOnMap(item)}
                  disabled={highlightingSessionId !== null}
                >
                  {highlightingSessionId === item.id ? "Karte wird vorbereitet ..." : "Auf Karte zeigen"}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
