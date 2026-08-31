import { useEffect, useMemo, useState } from "react";
import "./pickup-assignment.css";

export type PickupAssignmentOption = {
  id: string;
  label: string;
};

type Props = {
  assignedRunIds: readonly string[];
  assignedCollectorIds: readonly string[];
  runOptions: readonly PickupAssignmentOption[];
  collectorOptions: readonly PickupAssignmentOption[];
  canAssign: boolean;
  language: "de" | "en";
  onSave: (runIds: string[], collectorIds: string[]) => void | Promise<void>;
};

type DisplayOption = PickupAssignmentOption & { active: boolean };

function copy(language: Props["language"], german: string, english: string) {
  return language === "en" ? english : german;
}

function mergeOptions(
  options: readonly PickupAssignmentOption[],
  assignedIds: readonly string[],
  language: Props["language"],
): DisplayOption[] {
  const seen = new Set<string>();
  const result: DisplayOption[] = [];
  for (const option of options) {
    if (seen.has(option.id)) continue;
    seen.add(option.id);
    result.push({ ...option, active: true });
  }
  for (const id of assignedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      label: `${id} · ${copy(language, "nicht mehr aktiv", "no longer active")}`,
      active: false,
    });
  }
  return result;
}

function sameSelection(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

export function PickupAssignmentEditor({
  assignedRunIds,
  assignedCollectorIds,
  runOptions,
  collectorOptions,
  canAssign,
  language,
  onSave,
}: Props) {
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([...assignedRunIds]);
  const [selectedCollectorIds, setSelectedCollectorIds] = useState<string[]>([
    ...assignedCollectorIds,
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setSelectedRunIds([...assignedRunIds]);
    setSelectedCollectorIds([...assignedCollectorIds]);
    setError(false);
  }, [assignedRunIds, assignedCollectorIds]);

  const runs = useMemo(
    () => mergeOptions(runOptions, assignedRunIds, language),
    [assignedRunIds, language, runOptions],
  );
  const collectors = useMemo(
    () => mergeOptions(collectorOptions, assignedCollectorIds, language),
    [assignedCollectorIds, collectorOptions, language],
  );
  const dirty =
    !sameSelection(selectedRunIds, assignedRunIds) ||
    !sameSelection(selectedCollectorIds, assignedCollectorIds);

  const toggle = (
    id: string,
    selected: string[],
    setSelected: (value: string[]) => void,
  ) => {
    if (!canAssign || saving) return;
    setError(false);
    setSelected(
      selected.includes(id)
        ? selected.filter((candidate) => candidate !== id)
        : [...selected, id],
    );
  };

  const save = async () => {
    if (!canAssign || !dirty || saving) return;
    setSaving(true);
    setError(false);
    try {
      const orderedRuns = runs
        .filter((option) => selectedRunIds.includes(option.id))
        .map((option) => option.id);
      const orderedCollectors = collectors
        .filter((option) => selectedCollectorIds.includes(option.id))
        .map((option) => option.id);
      await onSave(orderedRuns, orderedCollectors);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const group = (
    title: string,
    empty: string,
    options: readonly DisplayOption[],
    selectedIds: string[],
    setSelected: (value: string[]) => void,
  ) => (
    <fieldset className="pickup-assignment-group" disabled={!canAssign || saving}>
      <legend>{title}</legend>
      {options.length === 0 ? <small>{empty}</small> : null}
      <div className="pickup-assignment-options">
        {options.map((option) => (
          <label
            className={`pickup-assignment-option${option.active ? "" : " is-inactive"}`}
            key={option.id}
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(option.id)}
              onChange={() => toggle(option.id, selectedIds, setSelected)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <section
      className="pickup-assignment-editor"
      aria-label={copy(language, "Pickup-Zuweisung", "Pickup assignment")}
    >
      <div className="pickup-assignment-heading">
        <strong>{copy(language, "Zuweisung", "Assignment")}</strong>
        <small>
          {copy(
            language,
            "Ein Pickup kann mehreren aktiven Runs oder Geräten zugewiesen werden.",
            "A pickup can be assigned to multiple active runs or devices.",
          )}
        </small>
      </div>

      {group(
        copy(language, "Collection Runs", "Collection runs"),
        copy(language, "Keine aktiven Runs verfügbar.", "No active runs available."),
        runs,
        selectedRunIds,
        setSelectedRunIds,
      )}
      {group(
        copy(language, "Collector", "Collectors"),
        copy(language, "Keine aktiven Geräte verfügbar.", "No active devices available."),
        collectors,
        selectedCollectorIds,
        setSelectedCollectorIds,
      )}

      {canAssign ? (
        <div className="pickup-assignment-actions">
          <button type="button" disabled={!dirty || saving} onClick={() => void save()}>
            {saving
              ? copy(language, "Wird gespeichert…", "Saving…")
              : copy(language, "Zuweisung speichern", "Save assignment")}
          </button>
          {!dirty ? (
            <span className="pickup-assignment-readonly">
              {copy(language, "Keine Änderung", "No changes")}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="pickup-assignment-readonly">
          {copy(
            language,
            "Zuweisung ist für diesen Zugang nur lesbar.",
            "Assignment is read-only for this access.",
          )}
        </p>
      )}
      {error ? (
        <p className="pickup-assignment-error" role="alert">
          {copy(language, "Zuweisung konnte nicht gespeichert werden.", "Assignment could not be saved.")}
        </p>
      ) : null}
    </section>
  );
}
