import { useState } from "react";
import { OrganizerActionDeletePanel } from "../admin/OrganizerActionDeletePanel.tsx";
import {
  OrganizerAdminPanel,
  type AdminAccountListItem,
} from "../admin/OrganizerAdminPanel.tsx";
import { TeamRoleTemplatePanel } from "../admin/TeamRoleTemplatePanel.tsx";
import {
  teamRolePresetById,
  type TeamRoleCapability,
} from "../admin/teamRoleTemplateModel.ts";
import "./admin-workbench-preview.css";

const PREVIEW_ACCOUNTS: AdminAccountListItem[] = [
  { id: "org-1", username: "hauptorga", role: "organizer", status: "active" },
  { id: "org-2", username: "orga-zwei", role: "organizer", status: "active" },
  {
    id: "admin-1",
    username: "koordination",
    role: "admin",
    status: "active",
    adminManagementDelegated: true,
  },
  { id: "admin-2", username: "statistik", role: "admin", status: "active" },
];

export function AdminWorkbenchPreview() {
  const [memberCapabilities, setMemberCapabilities] = useState<TeamRoleCapability[]>(
    () => teamRolePresetById("team-member").capabilities,
  );
  const [leaderCapabilities, setLeaderCapabilities] = useState<TeamRoleCapability[]>(
    () => teamRolePresetById("team-leader").capabilities,
  );
  const [message, setMessage] = useState("Nur lokale Vorschau. Es wird nichts gespeichert.");

  return (
    <main className="admin-workbench-preview">
      <header className="admin-workbench-preview__header">
        <div>
          <span>Experimenteller Admin-Workbench</span>
          <strong>Organisation & Rollen</strong>
          <p>Fake-Daten, keine Accounts, keine Serverrechte, keine D1-Schreibvorgänge.</p>
        </div>
        <a href="?">Normale App</a>
      </header>

      <div className="admin-workbench-preview__status" role="status">
        {message}
      </div>

      <section className="admin-workbench-preview__section">
        <OrganizerAdminPanel
          accounts={PREVIEW_ACCOUNTS}
          canManageAdmins
          canManageOrganizers
          onAddAdmin={() => setMessage("Preview: Admin-hinzufügen Flow würde geöffnet.")}
          onAddOrganizer={() => setMessage("Preview: Organisator-hinzufügen Flow würde geöffnet.")}
          onManageAccount={(account) => setMessage(`Preview: ${account.username} verwalten.`)}
        />
      </section>

      <section className="admin-workbench-preview__roles" aria-label="Team-Rollen konfigurieren">
        <TeamRoleTemplatePanel
          presetId="team-member"
          capabilities={memberCapabilities}
          canEdit
          onCapabilitiesChange={(next) => {
            setMemberCapabilities(next);
            setMessage("Lokaler Teammitglied-Entwurf geändert.");
          }}
        />
        <TeamRoleTemplatePanel
          presetId="team-leader"
          capabilities={leaderCapabilities}
          canEdit
          onCapabilitiesChange={(next) => {
            setLeaderCapabilities(next);
            setMessage("Lokaler Teamleiter-Entwurf geändert.");
          }}
        />
      </section>

      <section className="admin-workbench-preview__section">
        <OrganizerActionDeletePanel
          action={{
            actionId: "campaign_12345678-abcd-1234-abcd-123456789abc",
            actionName: "Frühjahr 2027 Flyer-Verteilung",
            status: "archived",
          }}
          isOrganizer
          canArchive
          onArchive={() => setMessage("Preview: Aktion wäre archiviert.")}
          onPermanentDelete={() => setMessage("Preview: permanentes Löschen wurde nur lokal bestätigt.")}
        />
      </section>
    </main>
  );
}
