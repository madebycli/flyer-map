import type { ProgressSummary } from "../domain/progressStats.ts";
import "./active-team-context.css";

type Props = {
  teamName: string;
  teamColor: string;
  progress: ProgressSummary;
  label: string;
  onOpen: () => void;
};

function percent(progress: ProgressSummary) {
  if (progress.percentCompleted === null) return null;
  return Math.max(0, Math.min(100, Math.round(progress.percentCompleted)));
}

export function ActiveTeamContext({ teamName, teamColor, progress, label, onOpen }: Props) {
  const completedPercent = percent(progress);

  return (
    <button
      className="active-team-context"
      type="button"
      onClick={onOpen}
      aria-label={label}
      title={label}
    >
      <span className="active-team-context-row">
        <span
          className="active-team-context-dot"
          style={{ backgroundColor: teamColor }}
          aria-hidden="true"
        />
        <span className="active-team-context-name">{teamName}</span>
        <span className="active-team-context-percent">
          {completedPercent === null ? "–" : `${completedPercent} %`}
        </span>
      </span>
      <span className="active-team-context-track" aria-hidden="true">
        <span style={{ width: `${completedPercent ?? 0}%`, backgroundColor: teamColor }} />
      </span>
    </button>
  );
}
