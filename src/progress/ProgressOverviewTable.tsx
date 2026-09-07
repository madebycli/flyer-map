import type { ProgressOverview } from "../domain/progressOverview.ts";
import "./progress-overview-table.css";

export type ProgressOverviewTableLabels = {
  team: string;
  area: string;
  completed: string;
  total: string;
  progress: string;
  noTasks: string;
};

type Props = {
  overview: ProgressOverview;
  labels: ProgressOverviewTableLabels;
};

function percent(value: number | null, noTasks: string) {
  return value === null ? noTasks : `${Math.round(value)} %`;
}

export function ProgressOverviewTable({ overview, labels }: Props) {
  return (
    <div className="progress-overview-scroll" role="region" aria-label={labels.progress} tabIndex={0}>
      <table className="progress-overview-table">
        <thead>
          <tr>
            <th scope="col">{labels.team}</th>
            <th scope="col">{labels.area}</th>
            <th scope="col">{labels.completed}</th>
            <th scope="col">{labels.total}</th>
            <th scope="col">{labels.progress}</th>
          </tr>
        </thead>
        <tbody>
          {overview.areas.map((row) => (
            <tr key={row.areaId}>
              <td>
                <span className="progress-overview-team">
                  <span style={{ backgroundColor: row.teamColor }} aria-hidden="true" />
                  {row.teamName}
                </span>
              </td>
              <td>{row.name}</td>
              <td>{row.progress.completed}</td>
              <td>{row.progress.total}</td>
              <td>{percent(row.progress.percentCompleted, labels.noTasks)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
