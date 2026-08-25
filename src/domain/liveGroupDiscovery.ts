export type LiveGroupDiscoveryItem = {
  id: string;
  campaignId: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  label: string;
  state: "active" | "closed";
  discoverable: boolean;
  joinAvailable: boolean;
};

export type LiveGroupFilter = { scope: "all" } | { scope: "team"; teamId: string };

export const DEFAULT_LIVE_GROUP_FILTER: LiveGroupFilter = { scope: "all" };

export function visibleLiveGroups(
  groups: LiveGroupDiscoveryItem[],
  campaignId: string,
  filter: LiveGroupFilter = DEFAULT_LIVE_GROUP_FILTER,
) {
  return groups
    .filter((group) => group.campaignId === campaignId)
    .filter((group) => group.state === "active" && group.discoverable)
    .filter((group) => filter.scope === "all" || group.teamId === filter.teamId);
}

export function liveGroupTeamFilters(groups: LiveGroupDiscoveryItem[], campaignId: string) {
  const teams = new Map<string, { teamId: string; teamName: string; teamColor: string }>();
  for (const group of visibleLiveGroups(groups, campaignId)) {
    if (!teams.has(group.teamId)) {
      teams.set(group.teamId, {
        teamId: group.teamId,
        teamName: group.teamName,
        teamColor: group.teamColor,
      });
    }
  }
  return [...teams.values()].sort((first, second) =>
    first.teamName.localeCompare(second.teamName, "de"),
  );
}
