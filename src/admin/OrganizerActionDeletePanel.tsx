import { useMemo, useState } from "react";
import type { ActionDeleteCandidate } from "../domain/organizerActionDelete.ts";
import {
  ACTION_DELETE_CONFIRMATION,
  actionDeleteReadiness,
} from "../domain/organizerActionDelete.ts";
import "./organizer-action-delete-panel.css";

type Props = {
  action: ActionDeleteCandidate;
  isOrganizer: boolean;
  canArchive: boolean;
  onArchive?: (actionId: string) => void;
  onPermanentDelete?: (actionId: string) => void;
};

export function OrganizerActionDeletePanel({
  action,
  isOrganizer,
  canArchive,
  onArchive,
  onPermanentDelete,
}: Props) {
  const [confirmation, setConfirmation] = useState("");
  const readiness = useMemo(
    () => actionDeleteReadiness(action, isOrganizer, confirmation),
    [action, isOrganizer, confirmation],
  );

  return (
    <section className="organizer-action-delete" aria-labelledby="organizer-action-delete-title">
      <div>
        <span>Gefahrenbereich</span>
        <h2 id="organizer-action-delete-title">Aktion archivieren oder löschen</h2>
        <p>
          <strong>{action.actionName}</strong> wird normalerweise archiviert. Verlauf und Statistik bleiben dabei erhalten.
        </p>
      </div>

      <div className="organizer-action-delete__archive">
        <button
          type="button"
          disabled={!canArchive || !onArchive || action.status === "archived"}
          onClick={() => onArchive?.(action.actionId)}
        >
          {action.status === "archived" ? "Bereits archiviert" : "Aktion archivieren"}
        </button>
        <small>Archivieren ist der normale Weg für abgeschlossene Aktionen.</small>
      </div>

      <div className="organizer-action-delete__danger">
        <strong>Dauerhaft löschen</strong>
        <p>
          Nur Organisatoren dürfen diesen Vorgang auslösen. Die spätere Server-Implementierung muss Organizer-Rechte erneut prüfen und den Vorgang auditieren.
        </p>

        {!isOrganizer ? (
          <p className="organizer-action-delete__blocked">Nur für Organisatoren.</p>
        ) : (
          <label>
            Zum Bestätigen exakt <code>{ACTION_DELETE_CONFIRMATION}</code> eingeben
            <input
              type="text"
              value={confirmation}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        )}

        <button
          type="button"
          className="organizer-action-delete__delete-button"
          disabled={!readiness.ready || !onPermanentDelete}
          onClick={() => {
            if (!readiness.ready || !onPermanentDelete) return;
            onPermanentDelete(action.actionId);
            setConfirmation("");
          }}
        >
          Aktion dauerhaft löschen
        </button>
      </div>
    </section>
  );
}
