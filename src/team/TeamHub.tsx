
import type { PlatformAppContext } from "../platform/platformContract.ts";
import { FieldBottomSheet } from "../platform/FieldBottomSheet.tsx";
import "./team-center.css";

type Props = {
  context: PlatformAppContext | null;
  online: boolean;
  onClose: () => void;
  onSelectTeam: (teamId: string) => void;
  onManageTeams: () => void;
};

export function TeamHub({ context, online, onClose, onSelectTeam, onManageTeams }: Props) {
  const activeTeam = context?.activeTeam ?? null;
  const accessibleTeams = (context?.teams ?? []).filter(
    (team) => context?.accessRole === "admin" || team.id === context?.accessTeamId,
  );

  return (
    <FieldBottomSheet open title={activeTeam?.name ?? "Team"} kicker="Team" onClose={onClose} initialSnap="expanded">
      <div className="team-center-view">
        {!online ? <div className="team-center-notice">Offline: Die aktive Team-Auswahl bleibt lokal verfügbar.</div> : null}
        <section className="team-center-card">
          <div className="team-center-section-heading">
            <div><span>Aktuelles Team</span><strong>{activeTeam?.name ?? "Noch kein Team aktiv"}</strong></div>
            <span className="team-center-team-dot" style={{ backgroundColor: activeTeam?.color ?? "#64748b" }} aria-hidden="true" />
          </div>
          {context && accessibleTeams.length > 1 ? (
            <label className="team-center-field">
              <span>Team wechseln</span>
              <select value={activeTeam?.id ?? ""} onChange={(event) => onSelectTeam(event.target.value)}>
                {accessibleTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
          ) : null}
          {context?.canManageTeams ? (
            <button className="team-center-secondary" type="button" onClick={onManageTeams}>Teams verwalten</button>
          ) : null}
        </section>
      </div>
    </FieldBottomSheet>
  );
}
