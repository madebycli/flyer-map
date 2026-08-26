import type {
  ManualSyncActionSignal,
  ProgressThresholdSignal,
} from "../domain/automationSignals.ts";
import "./automation-signals-panel.css";

export type AutomationUiSignal =
  | ProgressThresholdSignal
  | ManualSyncActionSignal;

type Props = {
  signals: readonly AutomationUiSignal[];
  labels: {
    title: string;
    empty: string;
    progressThreshold: (threshold: number) => string;
    conflict: string;
    blockedAuth: string;
    invalid: string;
    informational: string;
    actionRequired: string;
  };
};

function signalCopy(signal: AutomationUiSignal, labels: Props["labels"]) {
  if (signal.type === "progress-threshold") {
    return {
      title: labels.progressThreshold(signal.threshold),
      kind: labels.informational,
      severity: "info" as const,
    };
  }
  const title =
    signal.state === "conflict"
      ? labels.conflict
      : signal.state === "blocked-auth"
        ? labels.blockedAuth
        : labels.invalid;
  return {
    title,
    kind: labels.actionRequired,
    severity: "warning" as const,
  };
}

export function AutomationSignalsPanel({ signals, labels }: Props) {
  return (
    <section className="automation-signals-panel" aria-label={labels.title}>
      <header>
        <strong>{labels.title}</strong>
        <span>{signals.length}</span>
      </header>
      {signals.length === 0 ? <p className="automation-empty">{labels.empty}</p> : null}
      <div className="automation-signal-list" aria-live="polite">
        {signals.map((signal, index) => {
          const copy = signalCopy(signal, labels);
          const key =
            signal.type === "progress-threshold"
              ? `progress:${signal.threshold}:${signal.currentPercent}`
              : `sync:${signal.state}:${index}`;
          return (
            <article className={`automation-signal is-${copy.severity}`} key={key}>
              <span>{copy.kind}</span>
              <strong>{copy.title}</strong>
            </article>
          );
        })}
      </div>
    </section>
  );
}
