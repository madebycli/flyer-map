import { useMemo } from "react";
import type { SmartBuildingCandidate } from "../domain/smartCandidates.ts";
import {
  smartBuildingStreetOptions,
  selectSmartBuildingsForStreet,
  smartBuildingLabel,
  toggleSmartBuildingSourceId,
} from "../domain/smartBuildingSelection.ts";
import { HOUSE_CREATE_BATCH_MAX } from "../domain/mutations.ts";
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
    noSelection: string;
    selectionLimit: string;
    moreStreets: string;
  };
};

export function SmartHouseSelectionPanel({
  buildings,
  selectedSourceIds,
  onSelectionChange,
  labels,
}: Props) {
  const selected = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);
  const selectedBuildings = useMemo(
    () => buildings.filter((building) => selected.has(building.sourceId)),
    [buildings, selected],
  );
  const streetOptions = useMemo(() => smartBuildingStreetOptions(buildings), [buildings]);
  const allStreetOptions = useMemo(
    () => smartBuildingStreetOptions(buildings, Number.MAX_SAFE_INTEGER),
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
    onSelectionChange(
      buildings
        .filter((building) => next.has(building.sourceId))
        .slice(0, HOUSE_CREATE_BATCH_MAX)
        .map((building) => building.sourceId),
    );
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
          {allStreetOptions.length > streetOptions.length ? (
            <span className="smart-house-bounded-note">{labels.moreStreets}</span>
          ) : null}
        </div>
      ) : null}

      <div className="smart-house-list">
        {buildings.length === 0 ? <p>{labels.noBuildings}</p> : null}
        {buildings.length > 0 && selectedBuildings.length === 0 ? <p>{labels.noSelection}</p> : null}
        {selectedBuildings.map((building) => {
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
                <small>{building.buildingType}</small>
              </span>
            </label>
          );
        })}
        {selected.size >= HOUSE_CREATE_BATCH_MAX ? (
          <p className="smart-house-bounded-note">{labels.selectionLimit}</p>
        ) : null}
      </div>
    </section>
  );
}
