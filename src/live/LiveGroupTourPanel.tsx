import { useEffect, useState } from "react";
import type { LiveGroupTour } from "../domain/liveGroupTour.ts";
import "./live-group-tour-panel.css";

type Props = {
  tour: LiveGroupTour;
  groupLabel: string;
  teamName: string;
  canManage: boolean;
  onParticipantCountChange: (participantCount: number) => void;
  onClose: () => void;
};

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function stateLabel(state: LiveGroupTour["state"]) {
  if (state === "active") return "Aktiv";
  if (state === "closed") return "Beendet";
  return "Automatisch abgelaufen";
}

export function LiveGroupTourPanel({
  tour,
  groupLabel,
  teamName,
  canManage,
  onParticipantCountChange,
  onClose,
}: Props) {
  const [participantDraft, setParticipantDraft] = useState(
    tour.participantCount === null ? "" : String(tour.participantCount),
  );

  useEffect(() => {
    setParticipantDraft(tour.participantCount === null ? "" : String(tour.participantCount));
  }, [tour.groupId, tour.participantCount]);

  const parsedParticipants = Number(participantDraft);
  const participantDraftValid =
    Number.isSafeInteger(parsedParticipants) && parsedParticipants >= 1 && parsedParticipants <= 500;
  const active = tour.state === "active";

  return (
    <section className="live-group-tour-panel" aria-labelledby={`tour-${tour.groupId}`}>
      <header>
        <div>
          <span>{teamName}</span>
          <h2 id={`tour-${tour.groupId}`}>{groupLabel}</h2>
        </div>
        <strong data-state={tour.state}>{stateLabel(tour.state)}</strong>
      </header>

      <dl className="live-group-tour-panel__facts">
        <div>
          <dt>Tour gestartet</dt>
          <dd>{formatTimestamp(tour.createdAt)}</dd>
        </div>
        <div>
          <dt>Harte Ablaufgrenze</dt>
          <dd>{formatTimestamp(tour.hardExpiresAt)}</dd>
        </div>
        <div>
          <dt>Teilnehmer</dt>
          <dd>{tour.participantCount ?? "Noch nicht final"}</dd>
        </div>
      </dl>

      <label>
        Personen in dieser Tour
        <div className="live-group-tour-panel__participant-row">
          <input
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            value={participantDraft}
            disabled={!canManage || !active}
            onChange={(event) => setParticipantDraft(event.target.value)}
          />
          <button
            type="button"
            disabled={!canManage || !active || !participantDraftValid}
            onClick={() => onParticipantCountChange(parsedParticipants)}
          >
            Übernehmen
          </button>
        </div>
      </label>

      <p className="live-group-tour-panel__hint">
        Die Teilnehmerzahl dient nur Einsatz-, Personenzeit- und Statistikdaten. Sie vergibt keine Rechte.
      </p>

      <button
        className="live-group-tour-panel__close"
        type="button"
        disabled={!canManage || !active || tour.participantCount === null}
        onClick={onClose}
      >
        Tour manuell beenden
      </button>

      {active && tour.participantCount === null ? (
        <p className="live-group-tour-panel__warning" role="status">
          Vor dem Beenden muss die endgültige Teilnehmerzahl feststehen.
        </p>
      ) : null}
    </section>
  );
}
