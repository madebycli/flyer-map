import { useMemo, useState } from "react";
import type { SmartRoadCandidate } from "../domain/smartCandidates.ts";
import {
  selectSmartRoadRange,
  selectSmartRoadRangeViaWaypoints,
  smartRoadRouteOptions,
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

function routeLabel(sourceIds: string[]) {
  return sourceIds.map((sourceId) => roadLabel(sourceId).replace(/ \(way\/\d+\)$/u, "")).join(" → ");
}

export function M6SelectionPreview() {
  const [startSourceId, setStartSourceId] = useState<string | null>(null);
  const [endSourceId, setEndSourceId] = useState<string | null>(null);
  const [waypoints, setWaypoints] = useState<string[]>([]);
  const [addingWaypoint, setAddingWaypoint] = useState(false);
  const [chosenRouteIds, setChosenRouteIds] = useState<string[] | null>(null);

  const selection = useMemo(() => {
    if (!startSourceId || !endSourceId) return null;
    if (waypoints.length > 0) {
      return selectSmartRoadRangeViaWaypoints(PREVIEW_ROADS, [
        startSourceId,
        ...waypoints,
        endSourceId,
      ]);
    }
    return selectSmartRoadRange(PREVIEW_ROADS, startSourceId, endSourceId);
  }, [startSourceId, endSourceId, waypoints]);

  const routeOptions = useMemo(() => {
    if (!startSourceId || !endSourceId || waypoints.length > 0) return [];
    if (selection?.state !== "ambiguous") return [];
    return smartRoadRouteOptions(PREVIEW_ROADS, startSourceId, endSourceId, 3);
  }, [startSourceId, endSourceId, selection, waypoints]);

  const selectedIds = chosenRouteIds ?? (selection?.state === "selected" ? selection.sourceIds : []);
  const label = smartRoadSelectionLabel(PREVIEW_ROADS, selectedIds);

  const chooseRoad = (sourceId: string) => {
    if (addingWaypoint && startSourceId && endSourceId) {
      setWaypoints((current) => [...current, sourceId]);
      setChosenRouteIds(null);
      setAddingWaypoint(false);
      return;
    }

    if (!startSourceId || endSourceId) {
      setStartSourceId(sourceId);
      setEndSourceId(null);
      setWaypoints([]);
      setChosenRouteIds(null);
      setAddingWaypoint(false);
      return;
    }

    setEndSourceId(sourceId);
    setChosenRouteIds(null);
  };

  const reset = () => {
    setStartSourceId(null);
    setEndSourceId(null);
    setWaypoints([]);
    setChosenRouteIds(null);
    setAddingWaypoint(false);
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
          <strong>Start, Ende und Kreuzungen präzise wählen</strong>
          <p>
            Erster Klick setzt den Anfang, zweiter das Ende. Bei mehreren Wegen kannst du eine Route
            antippen oder mit Zwischenpunkten den exakten Verlauf erzwingen. Straßennamen erweitern
            die Auswahl nie automatisch.
          </p>
        </div>

        <section className="m6-mode-picker" aria-label="Aktuelle Ankerpunkte">
          <strong>Start: {roadLabel(startSourceId)}</strong>
          <strong>Ende: {roadLabel(endSourceId)}</strong>
          <span>Zwischenpunkte: {waypoints.length ? waypoints.map(roadLabel).join(" · ") : "keine"}</span>
          <div className="m6-anchor-actions">
            <button
              type="button"
              onClick={() => setAddingWaypoint(true)}
              disabled={!startSourceId || !endSourceId || addingWaypoint}
            >
              {addingWaypoint ? "Jetzt Abschnitt antippen" : "Zwischenpunkt setzen"}
            </button>
            <button type="button" onClick={reset} disabled={!startSourceId && !endSourceId}>
              Zurücksetzen
            </button>
          </div>
        </section>

        <section className="m6-road-list" aria-label="OSM-Straßenabschnitte">
          {PREVIEW_ROADS.map((road) => {
            const selected = selectedIds.includes(road.sourceId);
            const isStart = startSourceId === road.sourceId;
            const isEnd = endSourceId === road.sourceId;
            const isWaypoint = waypoints.includes(road.sourceId);
            return (
              <button
                type="button"
                key={road.sourceId}
                className={`m6-road-row ${selected ? "is-selected" : ""} ${isStart || isEnd || isWaypoint ? "is-clicked" : ""}`}
                onClick={() => chooseRoad(road.sourceId)}
              >
                <span className="m6-road-name">{road.name ?? "Unbenannte Straße"}</span>
                <span className="m6-road-meta">{road.sourceId} · {road.highway}</span>
                <span className="m6-road-state">
                  {isStart
                    ? "Start"
                    : isEnd
                      ? "Ende"
                      : isWaypoint
                        ? "Zwischenpunkt"
                        : selected
                          ? "gewählt"
                          : addingWaypoint
                            ? "als Zwischenpunkt"
                            : "wählen"}
                </span>
              </button>
            );
          })}
        </section>

        {routeOptions.length > 1 && !chosenRouteIds ? (
          <section className="m6-route-options" aria-label="Mögliche Routen">
            <span>Mehrere Wege möglich</span>
            <p>Wähle direkt eine Variante oder setze einen Zwischenpunkt für noch mehr Kontrolle.</p>
            <div>
              {routeOptions.map((option, index) => (
                <button
                  type="button"
                  key={option.sourceIds.join("|")}
                  onClick={() => setChosenRouteIds(option.sourceIds)}
                >
                  <strong>Route {index + 1}</strong>
                  <span>{routeLabel(option.sourceIds)}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="m6-selection-summary" aria-live="polite">
          <span>Aktuelle Auswahl</span>
          {chosenRouteIds ? (
            <>
              <strong>{label ?? "Gewählte Route"}</strong>
              <p>{chosenRouteIds.length} Straßenabschnitte, Route bewusst ausgewählt.</p>
            </>
          ) : !selection ? (
            <>
              <strong>{startSourceId ? "Jetzt Ende wählen" : "Start wählen"}</strong>
              <p>Die Vorschau speichert nichts.</p>
            </>
          ) : selection.state === "selected" ? (
            <>
              <strong>{label ?? "Ausgewählter Abschnitt"}</strong>
              <p>{selectedIds.length} OSM-Segment{selectedIds.length === 1 ? "" : "e"} zwischen den Ankern.</p>
            </>
          ) : selection.state === "ambiguous" ? (
            <>
              <strong>Mehrere Wege möglich</strong>
              <p>Route antippen oder einen weiteren Zwischenpunkt setzen. Die App rät nicht.</p>
            </>
          ) : (
            <>
              <strong>Keine Verbindung</strong>
              <p>Start, Ende oder Zwischenpunkte liegen nicht auf einem eindeutig verbundenen vorbereiteten Straßennetz.</p>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
