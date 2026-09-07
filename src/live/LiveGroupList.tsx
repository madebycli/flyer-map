import {
  liveGroupTeamFilters,
  visibleLiveGroups,
  type LiveGroupDiscoveryItem,
  type LiveGroupFilter,
} from "../domain/liveGroupDiscovery.ts";
import "./live-group-list.css";

type Labels = {
  title: string;
  allInCampaign: string;
  noGroups: string;
  join: string;
  unavailable: string;
  hiddenNote: string;
};

type Props = {
  campaignId: string;
  groups: LiveGroupDiscoveryItem[];
  filter: LiveGroupFilter;
  onFilterChange: (filter: LiveGroupFilter) => void;
  onJoin: (groupId: string) => void;
  labels: Labels;
};

export function LiveGroupList({
  campaignId,
  groups,
  filter,
  onFilterChange,
  onJoin,
  labels,
}: Props) {
  const visible = visibleLiveGroups(groups, campaignId, filter);
  const teams = liveGroupTeamFilters(groups, campaignId);

  return (
    <section className="live-group-list" aria-labelledby="live-group-list-title">
      <div className="live-group-list__header">
        <div>
          <h2 id="live-group-list-title">{labels.title}</h2>
          <p>{labels.hiddenNote}</p>
        </div>
      </div>

      <div className="live-group-list__filters" role="group" aria-label={labels.title}>
        <button
          type="button"
          className={filter.scope === "all" ? "is-active" : undefined}
          aria-pressed={filter.scope === "all"}
          onClick={() => onFilterChange({ scope: "all" })}
        >
          {labels.allInCampaign}
        </button>
        {teams.map((team) => {
          const active = filter.scope === "team" && filter.teamId === team.teamId;
          return (
            <button
              key={team.teamId}
              type="button"
              className={active ? "is-active" : undefined}
              aria-pressed={active}
              onClick={() => onFilterChange({ scope: "team", teamId: team.teamId })}
            >
              <span className="live-group-list__team-dot" style={{ backgroundColor: team.teamColor }} />
              {team.teamName}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="live-group-list__empty">{labels.noGroups}</p>
      ) : (
        <ul className="live-group-list__items">
          {visible.map((group) => (
            <li key={group.id}>
              <div className="live-group-list__identity">
                <span
                  className="live-group-list__team-dot"
                  style={{ backgroundColor: group.teamColor }}
                  aria-hidden="true"
                />
                <div>
                  <strong>{group.label}</strong>
                  <span>{group.teamName}</span>
                </div>
              </div>
              <button
                type="button"
                disabled={!group.joinAvailable}
                onClick={() => onJoin(group.id)}
              >
                {group.joinAvailable ? labels.join : labels.unavailable}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
