import {
  TEAM_ROLE_CAPABILITIES,
  type TeamRoleCapability,
  type TeamRolePresetId,
  teamRolePresetById,
  toggleTeamRoleCapability,
} from "./teamRoleTemplateModel.ts";
import "./team-role-template-panel.css";

const CAPABILITY_LABELS: Record<TeamRoleCapability, string> = {
  "area.create": "Gebiete anlegen",
  "area.edit-own-team": "Eigene Team-Gebiete bearbeiten",
  "area.delete": "Eigene Team-Gebiete löschen",
  "task.edit-own-team": "Straßen/Häuser/Pickups bearbeiten",
  "task.delete": "Eigene Team-Aufgaben löschen",
  "team.rename": "Teamname ändern",
  "team.change-color": "Teamfarbe ändern",
  "team.member-manage": "Teammitglieder verwalten",
  "invite.manage-own-team": "Einladungen verwalten",
  "live-group.create": "Einsatzgruppe starten",
  "live-group.manage": "Einsatzgruppen verwalten",
  "live-group.discoverability": "Online-Sichtbarkeit verwalten",
};

type Props = {
  presetId: TeamRolePresetId;
  capabilities: TeamRoleCapability[];
  canEdit: boolean;
  onCapabilitiesChange: (next: TeamRoleCapability[]) => void;
};

export function TeamRoleTemplatePanel({
  presetId,
  capabilities,
  canEdit,
  onCapabilitiesChange,
}: Props) {
  const preset = teamRolePresetById(presetId);
  const enabled = new Set(capabilities);

  return (
    <section className="team-role-template-panel" aria-labelledby={`team-role-${presetId}`}>
      <header>
        <div>
          <span>Rollen-Vorschau</span>
          <h2 id={`team-role-${presetId}`}>{preset.label}</h2>
          <p>{preset.description}</p>
        </div>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => onCapabilitiesChange([...preset.capabilities])}
        >
          Standard wiederherstellen
        </button>
      </header>

      <fieldset disabled={!canEdit}>
        <legend>Rechte innerhalb des eigenen Teams</legend>
        {TEAM_ROLE_CAPABILITIES.map((capability) => (
          <label key={capability}>
            <input
              type="checkbox"
              checked={enabled.has(capability)}
              onChange={() => onCapabilitiesChange(toggleTeamRoleCapability(capabilities, capability))}
            />
            <span>{CAPABILITY_LABELS[capability]}</span>
          </label>
        ))}
      </fieldset>

      <p className="team-role-template-panel__note">
        Diese Oberfläche bearbeitet nur einen lokalen Rollen-Entwurf. Sie vergibt keine Rechte und
        kennt absichtlich keine Cross-Team-, Admin- oder Organisator-Rechte. Spätere Speicherung und
        jede wirksame Berechtigungsprüfung müssen serverseitig erfolgen.
      </p>
    </section>
  );
}
