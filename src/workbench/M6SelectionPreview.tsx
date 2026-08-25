import { useMemo, useState } from "react";
import type { SmartRoadCandidate } from "../domain/smartCandidates.ts";
import {
  selectSmartRoadSourceIds,
  smartRoadSelectionLabel,
  type SmartRoadSelectionMode,
} from "../domain/smartRoadSelection.ts";
import "./m6-selection-preview.css";

const PREVIEW_ROADS: SmartRoadCandidate[] = [
  {
    sourceId: "way/101",
    osmId: 101,
    name: "Hauptstraße",
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates: [[13.39, 52.51], [13.4, 52.51]] },
  },
  {
    sourceId: "way/102",
    osmId: 102,
    name: "Hauptstraße",
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates: [[13.4, 52.51], [13.41, 52.51]] },
  },
  {
    sourceId: "way/103",
    osmId: 103,
    name: "Hauptstraße",
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates: [[13.41, 52.51], [13.42, 52.515]] },
  },
  {
    sourceId: "way/104",
    osmId: 104,
    name: "Nebenstraße",
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates: [[13.41, 52.51], [13.41, 52.5]] },
  },
  {
    sourceId: "way/105",
    osmId: 105,
    name: "Hauptstraße",
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates: [[13.5, 52.51], [13.51, 52.51]] },
  },
];

function modeText(mode: SmartRoadSelectionMode) {
  return mode === "source-segment" ? "Nur angeklicktes Segment" : "Verbundene gleichnamige Straße";
}

export function M6SelectionPreview() {
  const [selectedSourceId, setSelectedSourceId] = useState("way/102");
  const [mode, setMode] = useState<SmartRoadSelectionMode>("source-segment");

  const selectedIds = useMemo(
    () => selectSmartRoadSourceIds(PREVIEW_ROADS, selectedSourceId, mode),
    [selectedSourceId, mode],
  );
  const label = smartRoadSelectionLabel(PREVIEW_ROADS, selectedIds);

  return (
    <main className="m6-selection-preview">
      <header className="m6-selection-header">
        <div>
          <span>Experimentelle M6-Auswahl</span>
          <strong>Smart Streets</strong>
        </div>
        <a href="?" className="m6-preview-exit">Normale App</a>
      </header>

      <section className="m6-selection-content">
        <div className="m6-preview-note">
          <strong>Noch keine Speicherung</strong>
          <p>Diese Vorschau entscheidet nur, welche OSM-Quellsegmente ein Klick auswählen würde.</p>
        </div>

        <fieldset className="m6-mode-picker">
          <legend>Auswahlverhalten</legend>
          {(["source-segment", "connected-same-name"] as const).map((candidateMode) => (
            <label key={candidateMode}>
              <input
                type="radio"
                name="selection-mode"
                value={candidateMode}
                checked={mode === candidateMode}
                onChange={() => setMode(candidateMode)}
              />
              <span>{modeText(candidateMode)}</span>
            </label>
          ))}
        </fieldset>

        <section className="m6-road-list" aria-label="OSM-Straßenabschnitte">
          {PREVIEW_ROADS.map((road) => {
            const selected = selectedIds.includes(road.sourceId);
            const clicked = selectedSourceId === road.sourceId;
            return (
              <button
                type="button"
                key={road.sourceId}
                className={`m6-road-row ${selected ? "is-selected" : ""} ${clicked ? "is-clicked" : ""}`}
                onClick={() => setSelectedSourceId(road.sourceId)}
              >
                <span className="m6-road-name">{road.name ?? "Unbenannte Straße"}</span>
                <span className="m6-road-meta">{road.sourceId} · {road.highway}</span>
                <span className="m6-road-state">
                  {clicked ? "angeklickt" : selected ? "mit ausgewählt" : "nicht ausgewählt"}
                </span>
              </button>
            );
          })}
        </section>

        <section className="m6-selection-summary" aria-live="polite">
          <span>Aktuelle Auswahl</span>
          <strong>{label ?? "Keine Auswahl"}</strong>
          <p>{selectedIds.length} OSM-Segment{selectedIds.length === 1 ? "" : "e"}</p>
        </section>
      </section>
    </main>
  );
}
