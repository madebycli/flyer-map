import { liveGroupCreationDefaults } from "../live/liveGroupDefaults.ts";

export type LiveGroupCreateDraft = {
  label: string;
  teamId: string;
  discoverable: boolean;
  state: "active";
};

export function buildLiveGroupCreateDraft(
  input: {
    label: string;
    teamId: string;
    discoverable?: boolean;
  },
  allowedTeamIds: readonly string[],
): LiveGroupCreateDraft {
  const label = input.label.trim().replace(/\s+/gu, " ");
  if (!label || label.length > 80) {
    throw new Error("invalid_live_group_label");
  }

  if (!allowedTeamIds.includes(input.teamId)) {
    throw new Error("invalid_live_group_team");
  }

  const defaults = liveGroupCreationDefaults();
  return {
    label,
    teamId: input.teamId,
    discoverable: input.discoverable ?? defaults.discoverable,
    state: defaults.state,
  };
}
