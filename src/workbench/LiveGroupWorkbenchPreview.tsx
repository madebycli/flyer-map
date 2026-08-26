import { useState } from "react";
import {
  DEFAULT_LIVE_GROUP_FILTER,
  type LiveGroupDiscoveryItem,
  type LiveGroupFilter,
} from "../domain/liveGroupDiscovery.ts";
import type { LiveGroupCreateDraft } from "../domain/liveGroupDraft.ts";
import { LiveGroupCreatePanel } from "../live/LiveGroupCreatePanel.tsx";
import { LiveGroupList } from "../live/LiveGroupList.tsx";
import "./live-group-workbench-preview.css";

const CAMPAIGN_ID = "campaign_preview";
const TEAMS = [
  { id: "team_orange", name: "Orange", color: "#ea580c" },
  { id: "team_blue", name: "Blau", color: "#2563eb" },
  { id: "team_green", name: "Grün", color: "#16a34a" },
];

const INITIAL_GROUPS: LiveGroupDiscoveryItem[] = [
  {
    id: "group_1",
    campaignId: CAMPAIGN_ID,
    teamId: "team_orange",
    teamName: "Orange",
    teamColor: "#ea580c",
    label: "Gruppe Nord",
    state: "active",
    discoverable: true,
    joinAvailable: true,
  },
  {
    id: "group_2",
    campaignId: CAMPAIGN_ID,
    teamId: "team_blue",
    teamName: "Blau",
    teamColor: "#2563eb",
    label: "Auto 2",
    state: "active",
    discoverable: true,
    joinAvailable: true,
  },
  {
    id: "group_hidden",
    campaignId: CAMPAIGN_ID,
    teamId: "team_green",
    teamName: "Grün",
    teamColor: "#16a34a",
    label: "Nicht öffentlich sichtbar",
    state: "active",
    discoverable: false,
    joinAvailable: true,
  },
];

export function LiveGroupWorkbenchPreview() {
  const [groups, setGroups] = useState(INITIAL_GROUPS);
  const [filter, setFilter] = useState<LiveGroupFilter>(DEFAULT_LIVE_GROUP_FILTER);
  const [message, setMessage] = useState(
    "Nur lokale Vorschau. Codes, QR-Tokens und Mitgliedschaften werden nicht erzeugt.",
  );

  const addDraft = (draft: LiveGroupCreateDraft) => {
    const team = TEAMS.find((candidate) => candidate.id === draft.teamId);
    if (!team) return;
    const id = `preview_group_${groups.length + 1}`;
    setGroups((current) => [
      ...current,
      {
        id,
        campaignId: CAMPAIGN_ID,
        teamId: team.id,
        teamName: team.name,
        teamColor: team.color,
        label: draft.label,
        state: draft.state,
        discoverable: draft.discoverable,
        joinAvailable: false,
      },
    ]);
    setMessage(
      draft.discoverable
        ? `Lokaler Entwurf ${draft.label} erstellt und in der sichtbaren Liste ergänzt.`
        : `Lokaler Entwurf ${draft.label} erstellt, aber wegen Online anzeigen = aus nicht gelistet.`,
    );
  };

  return (
    <main className="live-group-workbench-preview">
      <header className="live-group-workbench-preview__header">
        <div>
          <span>Experimenteller Workbench</span>
          <strong>Online-Gruppen & Team-Filter</strong>
          <p>Alle in der Aktion ist Standard. Team-Filter bleiben optional.</p>
        </div>
        <a href="?">Normale App</a>
      </header>

      <div className="live-group-workbench-preview__message" role="status">{message}</div>

      <div className="live-group-workbench-preview__grid">
        <LiveGroupCreatePanel teams={TEAMS} canCreate onCreateDraft={addDraft} />

        <section className="live-group-workbench-preview__list-card">
          <LiveGroupList
            campaignId={CAMPAIGN_ID}
            groups={groups}
            filter={filter}
            onFilterChange={setFilter}
            onJoin={(groupId) => setMessage(`Preview: Join für ${groupId}. Kein Credential wurde eingelöst.`)}
            labels={{
              title: "Online-Gruppen",
              allInCampaign: "Alle in der Aktion",
              noGroups: "Keine sichtbaren aktiven Gruppen für diesen Filter.",
              join: "Beitreten",
              unavailable: "Noch kein Zugang",
              hiddenNote: "Nur aktive Gruppen mit Online anzeigen = an erscheinen hier.",
            }}
          />
        </section>
      </div>

      <section className="live-group-workbench-preview__policy">
        <strong>Credential-Lifetime noch offen</strong>
        <p>
          Dieser Workbench erzeugt absichtlich keinen Room-Code und keinen QR-Token. Laufzeit,
          Rotation, Revocation und Rate-Limits bleiben ADR-0014-Entscheidungen.
        </p>
      </section>
    </main>
  );
}
