import { useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { SmartRoadCandidate } from "../domain/smartCandidates.ts";
import type { SmartRoadPointAnchor } from "../domain/smartRoadPointAnchor.ts";
import { smartRoadPointAnchorCandidates } from "../domain/smartRoadPointAnchor.ts";
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

const PREVIEW_BOUNDS = {
  minLng: 13.389,
  maxLng: 13.441,
  minLat: 52.504,
  maxLat: 52.516,
};

function roadLabel(sourceId: string | null) {
  if (!sourceId) return "noch nicht gewählt";
  const road = PREVIEW_ROADS.find((candidate) => candidate.sourceId === sourceId);
  return road ? `${road.name ?? "Unbenannte Straße"} (${road.sourceId})` : sourceId;
}

function routeLabel(sourceIds: string[]) {
  return sourceIds.map((sourceId) => roadLabel(sourceId).replace(/ \(way\/\d+\)$/u, "")).join(" → ");
}

function anchorLabel(anchor: SmartRoadPointAnchor | null) {
  if (!anchor) return "noch nicht gewählt";
  return `${roadLabel(anchor.sourceId)} · ${anchor.snapped[1].toFixed(5)}, ${anchor.snapped[0].toFixed(5)}`;
}

function roadMidAnchor(road: SmartRoadCandidate): SmartRoadPointAnchor {
  const start = road.geometry.coordinates[0];
  const end = road.geometry.coordinates[1] ?? start;
  return {
    sourceId: road.sourceId,
    snapped: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    segmentIndex: 0,
    segmentT: 0.5,
    distanceMeters: 0,
  };
}

function toSketchPoint([lng, lat]: [number, number]) {
  const x = ((lng - PREVIEW_BOUNDS.minLng) / (PREVIEW_BOUNDS.maxLng - PREVIEW_BOUNDS.minLng)) * 100;
  const y = 60 - ((lat - PREVIEW_BOUNDS.minLat) / (PREVIEW_BOUNDS.maxLat - PREVIEW_BOUNDS.minLat)) * 60;
  return [x, y] as const;
}

function fromSketchPoint(x: number, y: number): [number, number] {
  return [
    PREVIEW_BOUNDS.minLng + (x / 100) * (PREVIEW_BOUNDS.maxLng - PREVIEW_BOUNDS.minLng),
    PREVIEW_BOUNDS.minLat + ((60 - y) / 60) * (PREVIEW_BOUNDS.maxLat - PREVIEW_BOUNDS.minLat),
  ];
}

export function M6SelectionPreview() {
  const [startAnchor, setStartAnchor] = useState<SmartRoadPointAnchor | null>(null);
  const [endAnchor, setEndAnchor] = useState<SmartRoadPointAnchor | null>(null);
  const [waypoints, setWaypoints] = useState<SmartRoadPointAnchor[]>([]);
  const [addingWaypoint, setAddingWaypoint] = useState(false);
  const [chosenRouteIds, setChosenRouteIds] = useState<string[] | null>(null);
  const [pendingAnchorCandidates, setPendingAnchorCandidates] = useState<SmartRoadPointAnchor[]>([]);
  const [tapMessage, setTapMessage] = useState<string | null>(null);

  const startSourceId = startAnchor?.sourceId ?? null;
  const endSourceId = endAnchor?.sourceId ?? null;
  const waypointSourceIds = waypoints.map((waypoint) => waypoint.sourceId);

  const selection = useMemo(() => {
    if (!startSourceId || !endSourceId) return null;
    if (waypointSourceIds.length > 0) {
      return selectSmartRoadRangeViaWaypoints(PREVIEW_ROADS, [
        startSourceId,
        ...waypointSourceIds,
        endSourceId,
      ]);
    }
    return selectSmartRoadRange(PREVIEW_ROADS, startSourceId, endSourceId);
  }, [startSourceId, endSourceId, waypointSourceIds.join("|")]);

  const routeOptions = useMemo(() => {
    if (!startSourceId || !endSourceId || waypointSourceIds.length > 0) return [];
    if (selection?.state !== "ambiguous") return [];
    return smartRoadRouteOptions(PREVIEW_ROADS, startSourceId, endSourceId, 3);
  }, [startSourceId, endSourceId, selection, waypointSourceIds.length]);

  const selectedIds = chosenRouteIds ?? (selection?.state === "selected" ? selection.sourceIds : []);
  const label = smartRoadSelectionLabel(PREVIEW_ROADS, selectedIds);

  const applyAnchor = (anchor: SmartRoadPointAnchor) => {
    setPendingAnchorCandidates([]);
    setTapMessage(null);

    if (addingWaypoint && startAnchor && endAnchor) {
      setWaypoints((current) => [...current, anchor]);
      setChosenRouteIds(null);
      setAddingWaypoint(false);
      return;
    }

    if (!startAnchor || endAnchor) {
      setStartAnchor(anchor);
      setEndAnchor(null);
      setWaypoints([]);
      setChosenRouteIds(null);
      setAddingWaypoint(false);
      return;
    }

    setEndAnchor(anchor);
    setChosenRouteIds(null);
  };

  const handleSketchTap = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 60;
    const point = fromSketchPoint(x, y);
    const candidates = smartRoadPointAnchorCandidates(PREVIEW_ROADS, point, 100, 4);

    if (candidates.length === 0) {
      setPendingAnchorCandidates([]);
      setTapMessage("Hier liegt innerhalb der Fangdistanz keine vorbereitete Straße.");
      return;
    }
    if (candidates.length === 1) {
      applyAnchor(candidates[0]);
      return;
    }

    setPendingAnchorCandidates(candidates);
    setTapMessage("Mehrere Straßen liegen an diesem Punkt. Bitte den gemeinten Treffer wählen.");
  };

  const reset = () => {
    setStartAnchor(null);
    setEndAnchor(null);
    setWaypoints([]);
    setChosenRouteIds(null);
    setAddingWaypoint(false);
    setPendingAnchorCandidates([]);
    setTapMessage(null);
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
          <strong>Start und Ende direkt auf der Straße setzen</strong>
          <p>
            Tippe auf die Straßenskizze. Der Punkt wird auf die nächste echte Straßenlinie gezogen.
            An Kreuzungen mit mehreren Treffern musst du die gemeinte Straße auswählen. Danach gelten
            weiterhin Route wählen oder Zwischenpunkte setzen. Straßennamen erweitern nichts automatisch.
          </p>
        </div>

        <section className="m6-sketch-section" aria-labelledby="m6-sketch-title">
          <div>
            <strong id="m6-sketch-title">Touch-Vorschau</strong>
            <span>Tippen setzt Start, danach Ende. Die Liste darunter bleibt als Tastatur-Alternative.</span>
          </div>
          <div className="m6-road-sketch" onPointerDown={handleSketchTap}>
            <svg viewBox="0 0 100 60" aria-hidden="true" focusable="false">
              {PREVIEW_ROADS.map((road) => {
                const points = road.geometry.coordinates.map(toSketchPoint).map(([x, y]) => `${x},${y}`).join(" ");
                const selected = selectedIds.includes(road.sourceId);
                return (
                  <polyline
                    key={road.sourceId}
                    points={points}
                    className={selected ? "m6-sketch-road is-selected" : "m6-sketch-road"}
                  />
                );
              })}
              {startAnchor ? (() => {
                const [x, y] = toSketchPoint(startAnchor.snapped);
                return <circle cx={x} cy={y} r="2.2" className="m6-sketch-anchor is-start" />;
              })() : null}
              {endAnchor ? (() => {
                const [x, y] = toSketchPoint(endAnchor.snapped);
                return <circle cx={x} cy={y} r="2.2" className="m6-sketch-anchor is-end" />;
              })() : null}
              {waypoints.map((waypoint, index) => {
                const [x, y] = toSketchPoint(waypoint.snapped);
                return <circle key={`${waypoint.sourceId}-${index}`} cx={x} cy={y} r="1.8" className="m6-sketch-anchor is-waypoint" />;
              })}
            </svg>
          </div>
          {tapMessage ? <p className="m6-sketch-message" aria-live="polite">{tapMessage}</p> : null}
          {pendingAnchorCandidates.length > 1 ? (
            <div className="m6-snap-candidates" aria-label="Straßentreffer auswählen">
              {pendingAnchorCandidates.map((anchor) => (
                <button type="button" key={anchor.sourceId} onClick={() => applyAnchor(anchor)}>
                  <strong>{roadLabel(anchor.sourceId)}</strong>
                  <span>{anchor.distanceMeters.toFixed(1)} m vom Tipp</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="m6-mode-picker" aria-label="Aktuelle Ankerpunkte">
          <strong>Start: {anchorLabel(startAnchor)}</strong>
          <strong>Ende: {anchorLabel(endAnchor)}</strong>
          <span>Zwischenpunkte: {waypoints.length ? waypoints.map(anchorLabel).join(" · ") : "keine"}</span>
          <div className="m6-anchor-actions">
            <button
              type="button"
              onClick={() => setAddingWaypoint(true)}
              disabled={!startAnchor || !endAnchor || addingWaypoint}
            >
              {addingWaypoint ? "Jetzt auf Straße tippen" : "Zwischenpunkt setzen"}
            </button>
            <button type="button" onClick={reset} disabled={!startAnchor && !endAnchor}>
              Zurücksetzen
            </button>
          </div>
        </section>

        <section className="m6-road-list" aria-label="OSM-Straßenabschnitte als Tastatur-Alternative">
          {PREVIEW_ROADS.map((road) => {
            const selected = selectedIds.includes(road.sourceId);
            const isStart = startSourceId === road.sourceId;
            const isEnd = endSourceId === road.sourceId;
            const isWaypoint = waypointSourceIds.includes(road.sourceId);
            return (
              <button
                type="button"
                key={road.sourceId}
                className={`m6-road-row ${selected ? "is-selected" : ""} ${isStart || isEnd || isWaypoint ? "is-clicked" : ""}`}
                onClick={() => applyAnchor(roadMidAnchor(road))}
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
              <strong>{startAnchor ? "Jetzt Ende wählen" : "Start wählen"}</strong>
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
              <p>Start, Ende oder Zwischenpunkte liegen nicht auf einem verbundenen vorbereiteten Straßennetz.</p>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
