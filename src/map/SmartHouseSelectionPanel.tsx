import { useMemo } from "react";
import type { SmartBuildingCandidate } from "../domain/smartCandidates.ts";
import {
  selectSmartBuildingsForStreet,
  smartBuildingLabel,
  toggleSmartBuildingSourceId,
} from "../domain/smartBuildingSelection.ts";
import "./smart-house-selection.css";

type Props = {
  buildings: readonly SmartBuildingCandidate[];
  selectedSourceIds: readonly string[];
  onSelectionChange: (sourceIds: string[]) => void;
  labels: {
    title: string;
    selected: string;
    unnamedBuilding: string;
    selectStreet: string;
    clear: string;
    noBuildings: string;
  };
};

export function SmartHouseSelectionPanel({
  buildings,
  selectedSourceIds,
  onSelectionChange,
  labels,
}: Props) {
  const selected = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);
  const streetOptions = useMemo(
    () =>
      [...new Set(buildings.map((building) => building.street?.trim()).filter(Boolean) as string[])]
        .sort((a, b) => a.localeCompare(b, "de-DE")),
    [buildings],
  );

  const toggle = (sourceId: string) => {
    onSelectionChange(
      toggleSmartBuildingSourceId([...selectedSourceIds], sourceId, [...buildings]),
    );
  };

  const selectStreet = (street: string) => {
    const streetIds = selectSmartBuildingsForStreet([...buildings], street);
    const next = new Set(selectedSourceIds);
    streetIds.forEach((sourceId) => next.add(sourceId));
    onSelectionChange(buildings.filter((building) => next.has(building.sourceId)).map((building) => building.sourceId));
  };

  return (
    <section className="smart-house-selection" aria-label={labels.title}>
      <header>
        <div>
          <strong>{labels.title}</strong>
          <span>{labels.selected}: {selected.size}</span>
        </div>
        {selected.size > 0 ? (
          <button type="button" className="smart-house-clear" onClick={() => onSelectionChange([])}>
            {labels.clear}
          </button>
        ) : null}
      </header>

      {streetOptions.length > 0 ? (
        <div className="smart-house-street-actions" aria-label={labels.selectStreet}>
          {streetOptions.map((street) => (
            <button type="button" key={street} onClick={() => selectStreet(street)}>
              {labels.selectStreet}: {street}
            </button>
          ))}
        </div>
      ) : null}

      <div className="smart-house-list">
        {buildings.length === 0 ? <p>{labels.noBuildings}</p> : null}
        {buildings.map((building) => {
          const checked = selected.has(building.sourceId);
          const addressLabel = smartBuildingLabel(building);
          return (
            <label className={`smart-house-row ${checked ? "is-selected" : ""}`} key={building.sourceId}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(building.sourceId)}
              />
              <span className="smart-house-copy">
                <strong>{addressLabel || labels.unnamedBuilding}</strong>
                <small>{building.sourceId} · {building.buildingType}</small>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
