
import { useMemo, useState } from "react";
import type { PlatformAppContext } from "../platform/platformContract.ts";
import { FieldBottomSheet } from "../platform/FieldBottomSheet.tsx";
import "../team/team-center.css";

function statusLabel(status: string) {
  if (status === "completed") return "Erledigt";
  if (status === "later") return "Später";
  if (status === "not-deliverable") return "Nicht zustellbar";
  return "Offen";
}

export function StreetsHub({
  context,
  onClose,
  onManualStreet,
  onOpenStreet,
}: {
  context: PlatformAppContext | null;
  onClose: () => void;
  onManualStreet: () => void;
  onOpenStreet: (taskId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const streets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("de-DE");
    const scoped = (context?.streets ?? []).filter((street) => !context?.activeTeam || street.teamId === context.activeTeam.id);
    if (!normalized) return scoped;
    return scoped.filter((street) => `${street.label} ${street.areaName}`.toLocaleLowerCase("de-DE").includes(normalized));
  }, [context?.activeTeam, context?.streets, query]);

  return (
    <FieldBottomSheet open title="Streets" kicker={context?.activeTeam?.name ?? "Karte"} onClose={onClose}>
      <div className="team-center-view">
        <section className="team-center-card">
          <div className="team-center-section-heading"><div><span>Straßen</span><strong>{streets.length} im aktiven Team</strong></div></div>
          <label className="team-center-field"><span>Straße suchen</span><input value={query} placeholder="Name oder Gebiet" onChange={(event) => setQuery(event.target.value)} /></label>
          {context?.canCreateManualStreet ? <button className="team-center-primary" type="button" onClick={onManualStreet}>Straße manuell hinzufügen</button> : null}
          <p className="team-center-help">Smart Street wird später genau hier an die bestehende Karten- und Straßenlogik angebunden. Es existiert bewusst keine zweite Karten-Engine.</p>
          <div className="team-center-room-list">
            {streets.slice(0, 80).map((street) => (
              <button key={street.id} type="button" onClick={() => onOpenStreet(street.id)}>
                <span className="team-center-team-dot" style={{ backgroundColor: context?.teams.find((team) => team.id === street.teamId)?.color ?? "#64748b" }} aria-hidden="true" />
                <span><strong>{street.label}</strong><small>{street.areaName} · {statusLabel(street.status)}</small></span>
              </button>
            ))}
          </div>
          {streets.length === 0 ? <div className="team-center-empty">Keine passende Straße gefunden.</div> : null}
        </section>
      </div>
    </FieldBottomSheet>
  );
}
