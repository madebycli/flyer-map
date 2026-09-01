import type { ProgressSummary } from "../domain/progressStats.ts";
import "./progress-summary.css";

export type ProgressSummaryLabels = {
  completed: string;
  total: string;
  open: string;
  later: string;
  notDeliverable: string;
  noTasks: string;
};

type Props = {
  title: string;
  summary: ProgressSummary;
  labels: ProgressSummaryLabels;
};

function displayPercent(value: number | null) {
  if (value === null) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function ProgressSummaryCard({ title, summary, labels }: Props) {
  const percent = displayPercent(summary.percentCompleted);

  return (
    <section className="progress-summary-card" aria-labelledby="progress-summary-title">
      <div className="progress-summary-heading">
        <h3 id="progress-summary-title">{title}</h3>
        <strong>{percent === null ? labels.noTasks : `${percent} %`}</strong>
      </div>

      <div
        className="progress-summary-bar"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent === null ? labels.noTasks : `${percent} %`}
      >
        <span style={{ width: `${percent ?? 0}%` }} />
      </div>

      <dl className="progress-summary-grid">
        <div>
          <dt>{labels.completed}</dt>
          <dd>{summary.completed}</dd>
        </div>
        <div>
          <dt>{labels.total}</dt>
          <dd>{summary.total}</dd>
        </div>
        <div>
          <dt>{labels.open}</dt>
          <dd>{summary.open}</dd>
        </div>
        <div>
          <dt>{labels.later}</dt>
          <dd>{summary.later}</dd>
        </div>
        <div>
          <dt>{labels.notDeliverable}</dt>
          <dd>{summary.notDeliverable}</dd>
        </div>
      </dl>
    </section>
  );
}
