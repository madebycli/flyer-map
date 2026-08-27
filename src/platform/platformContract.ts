import type { AccessRole } from "../data/campaignApi.ts";

export type PlatformAppCommandType =
  | "open-settings"
  | "open-team-management"
  | "start-area-drawing";

export type PlatformAppCommand = {
  id: number;
  type: PlatformAppCommandType;
};

export type PlatformActiveTeam = {
  id: string;
  name: string;
  color: string;
};

export type PlatformAppContext = {
  accessRole: AccessRole | null;
  activeTeam: PlatformActiveTeam | null;
  launcherAvailable: boolean;
  canManageTeams: boolean;
  canCreateArea: boolean;
};

export type PlatformLauncherItem = {
  id: "map" | "settings" | "team" | "area-create";
  label: string;
  icon: string;
  command: PlatformAppCommandType | null;
};

const BASE_LAUNCHER_ITEMS: readonly PlatformLauncherItem[] = [
  { id: "map", label: "Karte", icon: "🗺️", command: null },
  { id: "settings", label: "Einstellungen", icon: "⚙️", command: "open-settings" },
];

export function buildPlatformLauncherItems(
  context: PlatformAppContext | null,
): PlatformLauncherItem[] {
  const items = [...BASE_LAUNCHER_ITEMS];

  if (context?.canManageTeams) {
    items.push({ id: "team", label: "Team", icon: "👥", command: "open-team-management" });
  }

  if (context?.canCreateArea) {
    items.push({ id: "area-create", label: "Gebiet", icon: "➕", command: "start-area-drawing" });
  }

  return items;
}
