import type { CampaignSnapshot } from "./campaign.ts";
import {
  calculateAreaProgress,
  calculateCampaignProgress,
  calculateTeamProgress,
  type ProgressSummary,
} from "./progressStats.ts";

export type ProgressTeamRow = {
  teamId: string;
  name: string;
  color: string;
  areaCount: number;
  progress: ProgressSummary;
};

export type ProgressAreaRow = {
  areaId: string;
  teamId: string;
  name: string;
  teamName: string;
  teamColor: string;
  progress: ProgressSummary;
};

export type ProgressOverview = {
  campaign: ProgressSummary;
  teams: ProgressTeamRow[];
  areas: ProgressAreaRow[];
};

export function buildProgressOverview(snapshot: CampaignSnapshot): ProgressOverview {
  const teamById = new Map(snapshot.teams.map((team) => [team.id, team]));

  const teams = snapshot.teams.map((team) => {
    const teamProgress = calculateTeamProgress(snapshot, team.id);
    return {
      teamId: team.id,
      name: team.name,
      color: team.color,
      areaCount: teamProgress.areaCount,
      progress: teamProgress,
    };
  });

  const areas = snapshot.areas.flatMap((area) => {
    const progress = calculateAreaProgress(snapshot, area.id);
    const team = teamById.get(area.teamId);
    if (!progress || !team) return [];
    return [
      {
        areaId: area.id,
        teamId: area.teamId,
        name: area.name,
        teamName: team.name,
        teamColor: team.color,
        progress,
      },
    ];
  });

  return {
    campaign: calculateCampaignProgress(snapshot),
    teams,
    areas,
  };
}
