export type StatisticsScopeKind = "campaign" | "team" | "field-group";

export type StatisticsProgress = {
  denominator: "street-tasks" | "house-tasks";
  total: number;
  completed: number;
  open: number;
  later: number;
  notDeliverable: number;
  remaining: number;
  percentCompleted: number | null;
};

export type StatisticsTeam = {
  teamId: string;
  name: string;
  color: string;
  areaCount: number;
  streets: StatisticsProgress;
  houses: StatisticsProgress | null;
};

export type StatisticsArea = {
  areaId: string;
  teamId: string;
  name: string;
  teamName: string;
  teamColor: string;
  streets: StatisticsProgress;
  houses: StatisticsProgress | null;
};

export type StatisticsSessionMode = "distribution" | "collection";

export type StatisticsSessionTotals = {
  mode: StatisticsSessionMode;
  outings: number;
  activeOutings: number;
  closedOutings: number;
  totalDurationSeconds: number;
  knownParticipantSessions: number;
  participantCountTotal: number;
  totalPersonSeconds: number;
  affectedTaskCount: number;
};

export type StatisticsRecentSession = {
  id: string;
  teamId: string;
  teamName: string;
  mode: StatisticsSessionMode;
  startedAt: string;
  endedAt: string | null;
  endReason: "manual-close" | "group-expired" | null;
  durationSeconds: number | null;
  participantCount: number | null;
  personSeconds: number | null;
  affectedTaskCount: number;
  status: "active" | "closed";
};

export type StatisticsProgressBucket = {
  date: string;
  statusChanges: number;
  completedTransitions: number;
};

export type CampaignStatistics = {
  schemaVersion: 1;
  scope: {
    kind: StatisticsScopeKind;
    teamId: string | null;
  };
  campaign: {
    streets: StatisticsProgress;
    houses: StatisticsProgress | null;
  } | null;
  housesAvailable: boolean;
  teams: StatisticsTeam[];
  areas: StatisticsArea[];
  sessions: {
    distribution: StatisticsSessionTotals;
    collection: StatisticsSessionTotals;
  };
  recentSessions: StatisticsRecentSession[];
  recentSessionsTruncated: boolean;
  progressOverTime: StatisticsProgressBucket[];
};
