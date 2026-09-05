
import type { PlatformAppContext } from "../platform/platformContract.ts";
import { FieldBottomSheet } from "../platform/FieldBottomSheet.tsx";
import { TeamProgressPanel } from "./TeamProgressPanel.tsx";
import "./team-center.css";

export function TeamProgressHub({
  context,
  online,
  onClose,
  onSelectTeam,
}: {
  context: PlatformAppContext | null;
  online: boolean;
  onClose: () => void;
  onSelectTeam: (teamId: string) => void;
}) {
  const activeTeam = context?.activeTeam ?? null;
  const accessibleTeams = (context?.teams ?? []).filter(
    (team) => context?.accessRole === "admin" || team.id === context?.accessTeamId,
  );

  return (
    <FieldBottomSheet open title={activeTeam?.name ? `Fortschritt · ${activeTeam.name}` : "Fortschritt"} kicker="Team" onClose={onClose}>
      <section className="team-center-card">
        <div className="team-center-section-heading">
          <div><span>Team-Fortschritt</span><strong>{activeTeam?.name ?? "Team"}</strong></div>
          <span className="team-center-team-dot" style={{ backgroundColor: activeTeam?.color ?? "#64748b" }} aria-hidden="true" />
        </div>
        {accessibleTeams.length > 1 ? (
          <label className="team-center-field"><span>Team</span><select value={activeTeam?.id ?? ""} onChange={(event) => onSelectTeam(event.target.value)}>{accessibleTeams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label>
        ) : null}
        <TeamProgressPanel campaignId={context?.campaignId ?? null} teamId={activeTeam?.id ?? null} online={online} />
      </section>
    </FieldBottomSheet>
  );
}
