import type { AccessRole } from "../data/campaignApi.ts";

export type PlatformAppCommand =
  | {
      id: number;
      type: "open-settings" | "open-team-management" | "start-area-drawing";
    }
  | {
      id: number;
      type: "select-active-team";
      teamId: string;
    };

export type PlatformAppCommandType = PlatformAppCommand["type"];

export type PlatformActiveTeam = {
  id: string;
  name: string;
  color: string;
};

export type PlatformTeam = PlatformActiveTeam;

export type PlatformAppContext = {
  campaignId: string;
  accessRole: AccessRole | null;
  accessTeamId: string | null;
  activeGroupId: string | null;
  activeTeam: PlatformActiveTeam | null;
  teams: PlatformTeam[];
  launcherAvailable: boolean;
  canManageTeams: boolean;
  canCreateArea: boolean;
};

export type PlatformLauncherItem = {
  id: "map" | "settings" | "team" | "sessions" | "area-create";
  label: string;
  icon: string;
  command: Exclude<PlatformAppCommandType, "select-active-team"> | null;
  opensTeamHub?: boolean;
  opensFieldSessions?: boolean;
};

export function buildPlatformLauncherItems(
  context: PlatformAppContext | null,
): PlatformLauncherItem[] {
  const items: PlatformLauncherItem[] = [
    { id: "map", label: "Karte", icon: "🗺️", command: null },
    { id: "team", label: "Team", icon: "👥", command: null, opensTeamHub: true },
  ];

  if (context?.accessRole) {
    items.push({
      id: "sessions",
      label: "Einsätze",
      icon: "🕘",
      command: null,
      opensFieldSessions: true,
    });
  }

  items.push({ id: "settings", label: "Einstellungen", icon: "⚙️", command: "open-settings" });

  if (context?.canCreateArea) {
    items.push({ id: "area-create", label: "Gebiet", icon: "➕", command: "start-area-drawing" });
  }

  return items;
}
