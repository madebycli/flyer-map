import { useMemo, useState } from "react";
import type { AdminActionSeriesExportPackage } from "../domain/adminActionSeriesExport.ts";
import "./admin-action-comparison-panel.css";

export type AdminActionComparisonOption = {
  id: string;
  label: string;
  detail?: string;
};

type Props = {
  authorized: boolean;
  actions: AdminActionComparisonOption[];
  onPrepareComparison: (
    selectedActionIds: string[],
  ) => Promise<AdminActionSeriesExportPackage> | AdminActionSeriesExportPackage;
  onComparisonReady: (pkg: AdminActionSeriesExportPackage) => void;
};

export function AdminActionComparisonPanel({
  authorized,
  actions,
  onPrepareComparison,
  onComparisonReady,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => actions.slice(0, 2).map((action) => action.id));
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const canPrepare = authorized && selectedIds.length >= 2;

  const toggle = (actionId: string) => {
    setSelectedIds((current) =>
      current.includes(actionId)
        ? current.filter((id) => id !== actionId)
        : [...current, actionId],
    );
  };

  const prepare = async () => {
    if (!canPrepare) return;
    const pkg = await onPrepareComparison(selectedIds);
    onComparisonReady(pkg);
  };

  return (
    <section className="admin-action-comparison" aria-labelledby="admin-action-comparison-title">
      <header>
        <span>Admin</span>
        <h2 id="admin-action-comparison-title">Aktionen vergleichen</h2>
        <p>
          Mehrere vergangene Runden auswählen und ein Vergleichspaket mit Trends und AI-Prompt erstellen.
        </p>
      </header>

      <fieldset disabled={!authorized}>
        <legend>Mindestens zwei Aktionen auswählen</legend>
        {actions.map((action) => (
          <label key={action.id}>
            <input
              type="checkbox"
              checked={selected.has(action.id)}
              onChange={() => toggle(action.id)}
            />
            <span>
              <strong>{action.label}</strong>
              {action.detail ? <small>{action.detail}</small> : null}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="admin-action-comparison__files">
        <code>comparison.json</code>
        <code>actions.csv</code>
        <code>AI_VERGLEICHS_PROMPT.md</code>
      </div>

      <p className="admin-action-comparison__note">
        Der Vergleich erstellt kein pauschales Team-Ranking. Geänderte Gebiete, Aufgabenmengen und
        Teamzuschnitte müssen bei Empfehlungen berücksichtigt werden.
      </p>

      <button type="button" disabled={!canPrepare} onClick={() => void prepare()}>
        {!authorized
          ? "Nur für berechtigte Admins"
          : selectedIds.length < 2
            ? "Mindestens zwei Aktionen auswählen"
            : `${selectedIds.length} Aktionen vergleichen`}
      </button>
    </section>
  );
}
