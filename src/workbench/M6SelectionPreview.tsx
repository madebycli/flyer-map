import { useMemo, useState } from "react";
import type { SmartRoadCandidate } from "../domain/smartCandidates.ts";
import {
  selectSmartRoadRange,
  smartRoadSelectionLabel,
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
    name: "Nebenstraße",
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates: [[13.4, 52.51], [13.41, 52.515]] },
  },
  {
    sourceId: "way/103",
    osmId: 103,
    name: "Marktweg",
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates: [[13.41, 52.515], [13.42, 52.51]] },
  },
  {
    sourceId: "way/104",
    osmId: 104,
    name: "Kirchweg",
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates: [[13.4, 52.51], [13.41, 52.505]] },
  },
  {
    sourceId: "way/105",
    osmId: 105,
    name: "Schulweg",
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates: [[13.41, 52.505], [13.42, 52.51]] },
  },
  {
    sourceId: "way/106",
    osmId: 106,
    name: "Hauptstraße",
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates: [[13.42, 52.51], [13.43, 52.51]] },
  },
  {
    sourceId: "way/107",
    osmId: 107,
    name: "Hauptstraße",
    ref: null,
    highway: "residential",
    geometry: { type: "LineString", coordinates: [[13.43, 52.51], [13.44, 52.51]] },
  },
];

function roadLabel(sourceId: string | null) {
  if (!sourceId) return "noch nicht gewählt";
  const road = PREVIEW_ROADS.find((candidate) => candidate.sourceId === sourceId);
  return road ? `${road.name ?? "Unbenannte Straße"} (${road.sourceId})` : sourceId;
}

export function M6SelectionPreview() {
  const [startSourceId, setStartSourceId] = useState<string | null>(null);
  const [endSourceId, setEndSourceId] = useState<string | null>(null);

  const selection = useMemo(() => {
    if (!startSourceId || !endSourceId) return null;
    return selectSmartRoadRange(PREVIEW_ROADS, startSourceId, endSourceId);
  }, [startSourceId, endSourceId]);

  const selectedIds = selection?.state === "selected" ? selection.sourceIds : [];
  const label = smartRoadSelectionLabel(PREVIEW_ROADS, selectedIds);

  const chooseRoad = (sourceId: string) => {
    if (!startSourceId || endSourceId) {
      setStartSourceId(sourceId);
      setEndSourceId(null);
      return;
    }
    setEndSourceId(sourceId);
  };

  const reset = () => {
    setStartSourceId(null);
    setEndSourceId(null);
  };

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
          <strong>Start und Ende statt Straßenname</strong>
          <p>
            Erster Klick setzt den Anfang, zweiter Klick das Ende. Nur der eindeutige verbundene Weg
            dazwischen wird gewählt. Bei mehreren möglichen Wegen wird nichts geraten.
          </p>
        </div>

        <section className="m6-mode-picker" aria-label="Aktuelle Ankerpunkte">
          <strong>Start: {roadLabel(startSourceId)}</strong>
          <strong>Ende: {roadLabel(endSourceId)}</strong>
          <button type="button" onClick={reset} disabled={!startSourceId && !endSourceId}>
            Auswahl zurücksetzen
          </button>
        </section>

        <section className="m6-road-list" aria-label="OSM-Straßenabschnitte">
          {PREVIEW_ROADS.map((road) => {
            const selected = selectedIds.includes(road.sourceId);
            const isStart = startSourceId === road.sourceId;
            const isEnd = endSourceId === road.sourceId;
            return (
              <button
                type="button"
                key={road.sourceId}
                className={`m6-road-row ${selected ? "is-selected" : ""} ${isStart || isEnd ? "is-clicked" : ""}`}
                onClick={() => chooseRoad(road.sourceId)}
              >
                <span className="m6-road-name">{road.name ?? "Unbenannte Straße"}</span>
                <span className="m6-road-meta">{road.sourceId} · {road.highway}</span>
                <span className="m6-road-state">
                  {isStart ? "Start" : isEnd ? "Ende" : selected ? "dazwischen" : "wählen"}
                </span>
              </button>
            );
          })}
        </section>

        <section className="m6-selection-summary" aria-live="polite">
          <span>Aktuelle Auswahl</span>
          {!selection ? (
            <>
              <strong>{startSourceId ? "Jetzt Ende wählen" : "Start wählen"}</strong>
              <p>Die Vorschau speichert nichts.</p>
            </>
          ) : selection.state === "selected" ? (
            <>
              <strong>{label ?? "Ausgewählter Abschnitt"}</strong>
              <p>{selectedIds.length} OSM-Segment{selectedIds.length === 1 ? "" : "e"} zwischen Start und Ende</p>
            </>
          ) : selection.state === "ambiguous" ? (
            <>
              <strong>Mehrere Wege möglich</strong>
              <p>Die App darf hier nicht raten. Dafür ist noch Zwischenpunkt- oder Routenwahl-UX zu entscheiden.</p>
            </>
          ) : (
            <>
              <strong>Keine Verbindung</strong>
              <p>Start und Ende liegen nicht auf einem zusammenhängenden vorbereiteten Straßennetz.</p>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
