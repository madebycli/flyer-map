
import type { AccessRole } from "../data/campaignApi.ts";

export type PlatformSyncState = "healthy" | "refreshing" | "offline" | "new-data" | "conflict" | "error";

export type PlatformAppCommand =
  | {
      id: number;
      type:
        | "open-settings"
        | "open-team-management"
        | "open-campaign-comments"
        | "start-area-drawing"
        | "start-manual-street";
    }
  | {
      id: number;
      type: "select-active-team";
      teamId: string;
    }
  | {
      id: number;
      type: "open-street-task";
      taskId: string;
    };

export type PlatformAppCommandType = PlatformAppCommand["type"];

export type PlatformActiveTeam = {
  id: string;
  name: string;
  color: string;
};

export type PlatformTeam = PlatformActiveTeam;

export type PlatformStreetSummary = {
  id: string;
  label: string;
  areaId: string;
  areaName: string;
  teamId: string;
  teamName: string;
  status: "open" | "completed" | "later" | "not-deliverable";
};

export type PlatformAppContext = {
  campaignId: string;
  accessRole: AccessRole | null;
  accessTeamId: string | null;
  activeGroupId: string | null;
  activeTeam: PlatformActiveTeam | null;
  teams: PlatformTeam[];
  streets: PlatformStreetSummary[];
  launcherAvailable: boolean;
  canManageTeams: boolean;
  canCreateArea: boolean;
  canCreateManualStreet: boolean;
  syncState: PlatformSyncState;
  syncLabel: string | null;
};

export type PlatformLauncherItem = {
  id: "team" | "rooms" | "stats" | "comments" | "streets" | "settings" | "area-create";
  label: string;
  icon: string;
  command: Exclude<PlatformAppCommandType, "select-active-team" | "open-street-task"> | null;
  opensTeamHub?: boolean;
  opensRoomsHub?: boolean;
  opensProgressHub?: boolean;
  opensCommentsHub?: boolean;
  opensStreetsHub?: boolean;
};

export function buildPlatformLauncherItems(
  context: PlatformAppContext | null,
): PlatformLauncherItem[] {
  const items: PlatformLauncherItem[] = [
    { id: "team", label: "Team", icon: "👥", command: null, opensTeamHub: true },
  ];

  if (context?.accessRole && context.accessRole !== "collection-collector") {
    items.push(
      { id: "rooms", label: "Rooms", icon: "🚐", command: null, opensRoomsHub: true },
      { id: "stats", label: "Fortschritt", icon: "📊", command: null, opensProgressHub: true },
      { id: "comments", label: "Kommentare", icon: "💬", command: null, opensCommentsHub: true },
      { id: "streets", label: "Streets", icon: "🛣️", command: null, opensStreetsHub: true },
    );
  }

  if (context?.canCreateArea) {
    items.push({ id: "area-create", label: "Gebiet", icon: "➕", command: "start-area-drawing" });
  }

  items.push({ id: "settings", label: "Einstellungen", icon: "⚙️", command: "open-settings" });

  return items;
}
