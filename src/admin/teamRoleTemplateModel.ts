export const TEAM_ROLE_CAPABILITIES = [
  "area.create",
  "area.edit-own-team",
  "area.delete",
  "task.edit-own-team",
  "task.delete",
  "team.rename",
  "team.change-color",
  "team.member-manage",
  "invite.manage-own-team",
  "live-group.create",
  "live-group.manage",
  "live-group.discoverability",
] as const;

export type TeamRoleCapability = (typeof TEAM_ROLE_CAPABILITIES)[number];
export type TeamRolePresetId = "team-member" | "team-leader";

export type TeamRolePreset = {
  id: TeamRolePresetId;
  label: string;
  description: string;
  capabilities: TeamRoleCapability[];
};

const TEAM_MEMBER_DEFAULT: TeamRoleCapability[] = [
  "area.create",
  "area.edit-own-team",
  "area.delete",
  "task.edit-own-team",
  "task.delete",
  "live-group.create",
];

const TEAM_LEADER_EXTRA_DEFAULT: TeamRoleCapability[] = [
  "team.rename",
  "team.change-color",
  "team.member-manage",
  "invite.manage-own-team",
  "live-group.manage",
  "live-group.discoverability",
];

export const DEFAULT_TEAM_ROLE_PRESETS: readonly TeamRolePreset[] = [
  {
    id: "team-member",
    label: "Teammitglied",
    description: "Operative Arbeit im eigenen Team bearbeiten.",
    capabilities: [...TEAM_MEMBER_DEFAULT],
  },
  {
    id: "team-leader",
    label: "Teamleiter",
    description: "Teammitglied plus optionale Team-Verwaltung.",
    capabilities: [...TEAM_MEMBER_DEFAULT, ...TEAM_LEADER_EXTRA_DEFAULT],
  },
] as const;

const KNOWN = new Set<string>(TEAM_ROLE_CAPABILITIES);

export function normalizeTeamRoleCapabilities(values: readonly string[]): TeamRoleCapability[] {
  const unique = new Set<TeamRoleCapability>();
  for (const value of values) {
    if (!KNOWN.has(value)) {
      throw new Error("unknown_team_role_capability");
    }
    unique.add(value as TeamRoleCapability);
  }
  return TEAM_ROLE_CAPABILITIES.filter((capability) => unique.has(capability));
}

export function teamRolePresetById(id: TeamRolePresetId): TeamRolePreset {
  const preset = DEFAULT_TEAM_ROLE_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error("unknown_team_role_preset");
  return {
    ...preset,
    capabilities: [...preset.capabilities],
  };
}

export function toggleTeamRoleCapability(
  current: readonly TeamRoleCapability[],
  capability: TeamRoleCapability,
): TeamRoleCapability[] {
  const next = new Set(current);
  if (next.has(capability)) next.delete(capability);
  else next.add(capability);
  return normalizeTeamRoleCapabilities([...next]);
}
