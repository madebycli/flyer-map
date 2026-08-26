import { useMemo, useState } from "react";
import { buildLiveGroupCreateDraft, type LiveGroupCreateDraft } from "../domain/liveGroupDraft.ts";
import { LiveGroupVisibilitySetting } from "./LiveGroupVisibilitySetting.tsx";
import { liveGroupCreationDefaults } from "./liveGroupDefaults.ts";
import "./live-group-create-panel.css";

export type LiveGroupCreateTeamOption = {
  id: string;
  name: string;
  color: string;
};

type Props = {
  teams: LiveGroupCreateTeamOption[];
  canCreate: boolean;
  onCreateDraft: (draft: LiveGroupCreateDraft) => void;
};

export function LiveGroupCreatePanel({ teams, canCreate, onCreateDraft }: Props) {
  const defaults = liveGroupCreationDefaults();
  const [label, setLabel] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [discoverable, setDiscoverable] = useState(defaults.discoverable);
  const [error, setError] = useState<string | null>(null);

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === teamId) ?? null,
    [teams, teamId],
  );

  const createDraft = () => {
    if (!canCreate) return;
    try {
      const draft = buildLiveGroupCreateDraft(
        { label, teamId, discoverable },
        teams.map((team) => team.id),
      );
      onCreateDraft(draft);
      setError(null);
      setLabel("");
      setDiscoverable(defaults.discoverable);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "invalid_live_group_draft");
    }
  };

  return (
    <section className="live-group-create-panel" aria-labelledby="live-group-create-title">
      <header>
        <span>Neue Einsatzgruppe</span>
        <h2 id="live-group-create-title">Online-Gruppe starten</h2>
        <p>
          Dieser Workbench erstellt nur einen lokalen Entwurf. Room-Code und QR-Zugang werden später
          ausschließlich serverseitig erzeugt.
        </p>
      </header>

      <label>
        Name der Einsatzgruppe
        <input
          type="text"
          value={label}
          maxLength={80}
          disabled={!canCreate}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="z. B. Auto 1 oder Gruppe Nord"
        />
      </label>

      <label>
        Team
        <select
          value={teamId}
          disabled={!canCreate || teams.length === 0}
          onChange={(event) => setTeamId(event.target.value)}
        >
          {teams.map((team) => (
            <option value={team.id} key={team.id}>{team.name}</option>
          ))}
        </select>
      </label>

      {selectedTeam ? (
        <div className="live-group-create-panel__team-preview">
          <span style={{ backgroundColor: selectedTeam.color }} aria-hidden="true" />
          <strong>{selectedTeam.name}</strong>
        </div>
      ) : null}

      <LiveGroupVisibilitySetting
        discoverable={discoverable}
        disabled={!canCreate}
        onChange={setDiscoverable}
        labels={{
          title: "Online anzeigen",
          description: "Standardmäßig in Alle in der Aktion sichtbar. Kann jederzeit ausgeschaltet werden.",
        }}
      />

      {error ? <p className="live-group-create-panel__error" role="alert">Entwurf ungültig: {error}</p> : null}

      <button type="button" disabled={!canCreate || teams.length === 0} onClick={createDraft}>
        Einsatzgruppen-Entwurf erstellen
      </button>
    </section>
  );
}
