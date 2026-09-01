import { useState } from "react";
import {
  DEFAULT_LIVE_GROUP_FILTER,
  type LiveGroupDiscoveryItem,
  type LiveGroupFilter,
} from "../domain/liveGroupDiscovery.ts";
import type { LiveGroupCreateDraft } from "../domain/liveGroupDraft.ts";
import {
  closeLiveGroupTour,
  createLiveGroupTour,
  updateLiveGroupParticipantCount,
  type LiveGroupTour,
} from "../domain/liveGroupTour.ts";
import { LiveGroupCreatePanel } from "../live/LiveGroupCreatePanel.tsx";
import { LiveGroupList } from "../live/LiveGroupList.tsx";
import { LiveGroupTourPanel } from "../live/LiveGroupTourPanel.tsx";
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

type TourMap = Record<string, LiveGroupTour>;

function initialTours(): TourMap {
  const now = Date.now();
  return {
    group_1: createLiveGroupTour({
      groupId: "group_1",
      mode: "distribution",
      createdAt: new Date(now - 90 * 60_000).toISOString(),
      participantCount: 3,
    }),
    group_2: createLiveGroupTour({
      groupId: "group_2",
      mode: "distribution",
      createdAt: new Date(now - 45 * 60_000).toISOString(),
      participantCount: 2,
    }),
    group_hidden: createLiveGroupTour({
      groupId: "group_hidden",
      mode: "distribution",
      createdAt: new Date(now - 30 * 60_000).toISOString(),
      participantCount: 4,
    }),
  };
}

export function LiveGroupWorkbenchPreview() {
  const [groups, setGroups] = useState(INITIAL_GROUPS);
  const [tours, setTours] = useState<TourMap>(initialTours);
  const [managedGroupId, setManagedGroupId] = useState("group_1");
  const [filter, setFilter] = useState<LiveGroupFilter>(DEFAULT_LIVE_GROUP_FILTER);
  const [message, setMessage] = useState(
    "Nur lokale Vorschau. Codes, QR-Tokens und Mitgliedschaften werden nicht erzeugt.",
  );

  const managedGroup = groups.find((group) => group.id === managedGroupId) ?? null;
  const managedTour = tours[managedGroupId] ?? null;

  const applyTour = (tour: LiveGroupTour) => {
    setTours((current) => ({ ...current, [tour.groupId]: tour }));
    if (tour.state !== "active") {
      setGroups((current) =>
        current.map((group) =>
          group.id === tour.groupId
            ? { ...group, state: tour.state, joinAvailable: false }
            : group,
        ),
      );
    }
  };

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
    setTours((current) => ({
      ...current,
      [id]: createLiveGroupTour({
        groupId: id,
        mode: "distribution",
        createdAt: new Date().toISOString(),
      }),
    }));
    setManagedGroupId(id);
    setMessage(
      draft.discoverable
        ? `Lokaler Entwurf ${draft.label} erstellt. Teilnehmerzahl kann jetzt für diese Tour gepflegt werden.`
        : `Lokaler Entwurf ${draft.label} erstellt, aber wegen Online anzeigen = aus nicht gelistet.`,
    );
  };

  const updateParticipants = (participantCount: number) => {
    if (!managedTour) return;
    const result = updateLiveGroupParticipantCount(
      managedTour,
      participantCount,
      new Date().toISOString(),
    );
    applyTour(result.tour);
    if (!result.ok) {
      setMessage(
        result.reason === "not-active"
          ? "Diese Tour ist nicht mehr aktiv. Die Teilnehmerzahl wurde nicht geändert."
          : "Die Teilnehmerzahl muss zwischen 1 und 500 liegen.",
      );
      return;
    }
    setMessage(`Teilnehmerzahl für ${managedGroup?.label ?? managedTour.groupId}: ${participantCount}.`);
  };

  const closeManagedTour = () => {
    if (!managedTour) return;
    const result = closeLiveGroupTour(managedTour, new Date().toISOString());
    applyTour(result.tour);
    if (!result.ok) {
      setMessage(
        result.reason === "final-participants-required"
          ? "Vor dem Beenden muss die endgültige Teilnehmerzahl feststehen."
          : result.reason === "not-active"
            ? "Die Tour ist bereits beendet oder automatisch abgelaufen."
            : "Der Tourzeitraum ist ungültig.",
      );
      return;
    }

    setMessage(
      `Tour beendet: ${Math.round(result.session.metrics.durationMinutes)} min, ${result.session.participantCount} Personen, ${Math.round(result.session.metrics.personMinutes)} Personenminuten.`,
    );
  };

  return (
    <main className="live-group-workbench-preview">
      <header className="live-group-workbench-preview__header">
        <div>
          <span>Experimenteller Workbench</span>
          <strong>Online-Gruppen, Tour & Team-Filter</strong>
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

      {managedGroup && managedTour ? (
        <div className="live-group-workbench-preview__tour">
          <LiveGroupTourPanel
            tour={managedTour}
            groupLabel={managedGroup.label}
            teamName={managedGroup.teamName}
            canManage
            onParticipantCountChange={updateParticipants}
            onClose={closeManagedTour}
          />
        </div>
      ) : null}

      <section className="live-group-workbench-preview__policy">
        <strong>Manuell beenden, spätestens nach 24 Stunden abgelaufen</strong>
        <p>
          Die normale Tour endet bewusst per Hand. Eine vergessene aktive Gruppe fällt spätestens 24 Stunden nach ihrer Erstellung auf expired. Eine spätere Credential-Rotation darf diese ursprüngliche Grenze nicht verlängern.
        </p>
        <p>
          Dieser Workbench erzeugt weiterhin keinen Room-Code und keinen QR-Token. Rotation, Revocation, temporäre Capability-Matrix, Session-Beziehung, Rate-Limits und sichere Audit-Events bleiben unter ADR-0014 vor echter Credential-Runtime offen.
        </p>
      </section>
    </main>
  );
}
