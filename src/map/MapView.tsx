import { useEffect, useMemo, useRef, useState } from "react";
import { GeolocateControl, Map, NavigationControl } from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import type { Area, DistributionTask, LngLat, MapCameraView } from "../domain/campaign";
import type { Language } from "../i18n";
import { t } from "../i18n";
import { loadPersonalMapView, savePersonalMapView } from "./cameraStore";
import "maplibre-gl/dist/maplibre-gl.css";

type MapMode = "browse" | "draw" | "edit" | "street-draw";
type RenderArea = Area & { color: string };
type RenderTask = DistributionTask & { color: string };
type AreaGroup = { key: string; color: string; areas: RenderArea[] };
type StreetGroup = {
  key: string;
  color: string;
  status: DistributionTask["status"];
  tasks: RenderTask[];
};

export type MapRefreshState = "idle" | "loading" | "current" | "error" | "available";
export type MapCameraCommand = { id: number; view: MapCameraView; persist?: boolean } | null;

type MapViewProps = {
  campaignId: string;
  campaignDefaultView: MapCameraView | null;
  language: Language;
  areas: RenderArea[];
  tasks: RenderTask[];
  selectedTaskId: string | null;
  mode: MapMode;
  draftVertices: LngLat[];
  draftColor: string;
  editingVertices: LngLat[];
  editingColor: string;
  selectedVertexIndex: number | null;
  streetDraftVertices: LngLat[];
  streetDraftColor: string;
  refreshState: MapRefreshState;
  cameraCommand: MapCameraCommand;
  onCameraChange: (camera: MapCameraView) => void;
  onRefresh: () => void;
  onAreaSelect: (areaId: string | null) => void;
  onTaskSelect: (taskId: string | null) => void;
  onDrawPoint: (point: LngLat) => void;
  onEditVertexSelect: (index: number) => void;
  onEditVertexMove: (index: number, point: LngLat) => void;
  onStreetDrawPoint: (point: LngLat) => void;
};

const GERMANY_VIEW: MapCameraView = { center: [10.45, 51.16], zoom: 5.3, bearing: 0 };
const CARTO_VOYAGER_RETINA_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 20,
      attribution:
        '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a> · <a href="https://carto.com/attributions" target="_blank">© CARTO</a>',
    },
  },
  layers: [
    {
      id: "map-background",
      type: "background",
      paint: { "background-color": "#fbf8f3" },
    },
    {
      id: "carto-basemap",
      type: "raster",
      source: "carto",
      minzoom: 0,
      maxzoom: 20,
      paint: { "raster-fade-duration": 0 },
    },
  ],
};

function samePoint(a: LngLat, b: LngLat) {
  return a[0] === b[0] && a[1] === b[1];
}

function openAreaRing(area: RenderArea): LngLat[] {
  const ring = area.geometry.coordinates[0] as LngLat[];
  return ring.length > 1 && samePoint(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
}

function pointInPolygon(point: LngLat, polygon: LngLat[]) {
  if (polygon.length < 3) return false;
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y) {
      const boundaryX = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (x < boundaryX) inside = !inside;
    }
  }
  return inside;
}

function pointToSegmentDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const factor = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(
    point.x - (start.x + factor * dx),
    point.y - (start.y + factor * dy),
  );
}

function taskHitDistance(map: Map, task: RenderTask, point: { x: number; y: number }) {
  const coordinates = task.geometry.coordinates as LngLat[];
  let best = Infinity;
  for (let index = 1; index < coordinates.length; index += 1) {
    best = Math.min(
      best,
      pointToSegmentDistance(
        point,
        map.project(coordinates[index - 1]),
        map.project(coordinates[index]),
      ),
    );
  }
  return best;
}

function findTaskHit(map: Map, tasks: RenderTask[], point: { x: number; y: number }) {
  let hitId: string | null = null;
  let best = 15;
  for (const task of tasks) {
    const distance = taskHitDistance(map, task, point);
    if (distance <= best) {
      hitId = task.id;
      best = distance;
    }
  }
  return hitId;
}

function findEditVertex(map: Map, vertices: LngLat[], point: { x: number; y: number }) {
  let hit: number | null = null;
  let best = 24;
  for (let index = 0; index < vertices.length; index += 1) {
    const projected = map.project(vertices[index]);
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (distance <= best) {
      hit = index;
      best = distance;
    }
  }
  return hit;
}

function projectedPoints(map: Map | null, coordinates: LngLat[]) {
  if (!map) return "";
  return coordinates
    .map((coordinate) => {
      const point = map.project(coordinate);
      return `${point.x},${point.y}`;
    })
    .join(" ");
}

function cameraFromMap(map: Map): MapCameraView {
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
  };
}

function groupAreas(areas: RenderArea[]) {
  const groups = new Map<string, RenderArea[]>();
  for (const area of areas) {
    const current = groups.get(area.color);
    if (current) current.push(area);
    else groups.set(area.color, [area]);
  }
  return [...groups.entries()].map(([color, groupedAreas]) => ({
    key: color,
    color,
    areas: groupedAreas,
  }));
}

function groupStreets(tasks: RenderTask[]) {
  const groups = new Map<string, StreetGroup>();
  for (const task of tasks) {
    const key = `${task.color}:${task.status}`;
    const current = groups.get(key);
    if (current) current.tasks.push(task);
    else {
      groups.set(key, {
        key,
        color: task.color,
        status: task.status,
        tasks: [task],
      });
    }
  }
  return [...groups.values()];
}

function intersectsViewport(map: Map, coordinates: LngLat[]) {
  if (coordinates.length === 0) return false;
  const bounds = map.getBounds();
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coordinates) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return !(
    maxLng < bounds.getWest() ||
    minLng > bounds.getEast() ||
    maxLat < bounds.getSouth() ||
    minLat > bounds.getNorth()
  );
}

function polygonPath(map: Map, areas: RenderArea[]) {
  let path = "";
  for (const area of areas) {
    const coordinates = openAreaRing(area);
    if (coordinates.length < 3 || !intersectsViewport(map, coordinates)) continue;
    coordinates.forEach((coordinate, index) => {
      const point = map.project(coordinate);
      path += `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    });
    path += "Z";
  }
  return path;
}

function linePath(map: Map, tasks: RenderTask[]) {
  let path = "";
  for (const task of tasks) {
    const coordinates = task.geometry.coordinates as LngLat[];
    if (coordinates.length < 2 || !intersectsViewport(map, coordinates)) continue;
    coordinates.forEach((coordinate, index) => {
      const point = map.project(coordinate);
      path += `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    });
  }
  return path;
}

function oneTaskPath(map: Map, task: RenderTask | null) {
  if (!task) return "";
  return linePath(map, [task]);
}

function interpolateWidth(zoom: number, stops: Array<[number, number]>) {
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let index = 1; index < stops.length; index += 1) {
    const [nextZoom, nextWidth] = stops[index];
    const [previousZoom, previousWidth] = stops[index - 1];
    if (zoom <= nextZoom) {
      const factor = (zoom - previousZoom) / (nextZoom - previousZoom);
      return previousWidth + (nextWidth - previousWidth) * factor;
    }
  }
  return stops[stops.length - 1][1];
}

function streetWidth(zoom: number) {
  return interpolateWidth(zoom, [
    [5, 0.35],
    [8, 0.5],
    [11, 0.8],
    [14, 1.35],
    [17, 2.2],
    [20, 3.2],
  ]);
}

function areaWidth(zoom: number) {
  return interpolateWidth(zoom, [
    [5, 0.3],
    [8, 0.45],
    [11, 0.7],
    [14, 1.05],
    [17, 1.55],
    [20, 2.1],
  ]);
}

function statusPresentation(status: DistributionTask["status"]) {
  switch (status) {
    case "completed":
      return { opacity: 0.38, dash: undefined as string | undefined, widthFactor: 0.9 };
    case "later":
      return { opacity: 0.84, dash: "7 5", widthFactor: 1 };
    case "not-deliverable":
      return { opacity: 0.72, dash: "2 6", widthFactor: 1 };
    default:
      return { opacity: 0.96, dash: undefined as string | undefined, widthFactor: 1 };
  }
}

function ProjectedMarkers({
  map,
  coordinates,
  color,
  selectedIndex = null,
  radius = 8,
}: {
  map: Map | null;
  coordinates: LngLat[];
  color: string;
  selectedIndex?: number | null;
  radius?: number;
}) {
  if (!map) return null;
  return coordinates.map((coordinate, index) => {
    const point = map.project(coordinate);
    const selected = selectedIndex === index;
    return (
      <circle
        key={`${coordinate[0]}:${coordinate[1]}:${index}`}
        cx={point.x}
        cy={point.y}
        r={selected ? radius + 3 : radius}
        fill={selected ? "#ffffff" : color}
        stroke={selected ? color : "#ffffff"}
        strokeWidth={selected ? 4.5 : 3.5}
        vectorEffect="non-scaling-stroke"
      />
    );
  });
}

export function MapView({
  campaignId,
  campaignDefaultView,
  language,
  areas,
  tasks,
  selectedTaskId,
  mode,
  draftVertices,
  draftColor,
  editingVertices,
  editingColor,
  selectedVertexIndex,
  streetDraftVertices,
  streetDraftColor,
  refreshState,
  cameraCommand,
  onCameraChange,
  onRefresh,
  onAreaSelect,
  onTaskSelect,
  onDrawPoint,
  onEditVertexSelect,
  onEditVertexMove,
  onStreetDrawPoint,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const cameraSaveTimerRef = useRef<number | null>(null);
  const suppressNextCameraSaveRef = useRef(false);
  const savedFrameRef = useRef<number | null>(null);
  const requestSavedRedrawRef = useRef<(() => void) | null>(null);
  const areaPathRefs = useRef(new Map<string, SVGPathElement>());
  const streetPathRefs = useRef(new Map<string, SVGPathElement>());
  const selectedStreetPathRef = useRef<SVGPathElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, forceActiveOverlayRender] = useState(0);

  const areaGroups = useMemo(() => groupAreas(areas), [areas]);
  const streetGroups = useMemo(() => groupStreets(tasks), [tasks]);
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );
  const savedRenderRef = useRef({ areaGroups, streetGroups, selectedTask });
  savedRenderRef.current = { areaGroups, streetGroups, selectedTask };

  const interactionRef = useRef({
    areas,
    tasks,
    mode,
    editingVertices,
    selectedVertexIndex,
    onAreaSelect,
    onTaskSelect,
    onDrawPoint,
    onEditVertexSelect,
    onEditVertexMove,
    onStreetDrawPoint,
  });

  useEffect(() => {
    interactionRef.current = {
      areas,
      tasks,
      mode,
      editingVertices,
      selectedVertexIndex,
      onAreaSelect,
      onTaskSelect,
      onDrawPoint,
      onEditVertexSelect,
      onEditVertexMove,
      onStreetDrawPoint,
    };
  }, [
    areas,
    tasks,
    mode,
    editingVertices,
    selectedVertexIndex,
    onAreaSelect,
    onTaskSelect,
    onDrawPoint,
    onEditVertexSelect,
    onEditVertexMove,
    onStreetDrawPoint,
  ]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let active = true;
    const initialCamera = loadPersonalMapView(campaignId) ?? campaignDefaultView ?? GERMANY_VIEW;

    try {
      const map = new Map({
        container: containerRef.current,
        style: CARTO_VOYAGER_RETINA_STYLE,
        center: initialCamera.center,
        zoom: initialCamera.zoom,
        bearing: initialCamera.bearing,
        maxZoom: 20,
        renderWorldCopies: false,
        cancelPendingTileRequestsWhileZooming: false,
        validateStyle: import.meta.env.DEV,
      });
      mapRef.current = map;

      const drawSavedGeometry = () => {
        const render = savedRenderRef.current;
        const zoom = map.getZoom();
        const currentAreaWidth = areaWidth(zoom).toFixed(2);
        const currentStreetWidth = streetWidth(zoom);

        for (const group of render.areaGroups) {
          const path = areaPathRefs.current.get(group.key);
          if (!path) continue;
          path.setAttribute("d", polygonPath(map, group.areas));
          path.setAttribute("stroke-width", currentAreaWidth);
        }

        for (const group of render.streetGroups) {
          const path = streetPathRefs.current.get(group.key);
          if (!path) continue;
          path.setAttribute("d", linePath(map, group.tasks));
          path.setAttribute(
            "stroke-width",
            (currentStreetWidth * statusPresentation(group.status).widthFactor).toFixed(2),
          );
        }

        if (selectedStreetPathRef.current) {
          selectedStreetPathRef.current.setAttribute("d", oneTaskPath(map, render.selectedTask));
          selectedStreetPathRef.current.setAttribute(
            "stroke-width",
            (currentStreetWidth * 2.15 + 1.4).toFixed(2),
          );
        }
      };

      const scheduleSavedRedraw = () => {
        if (!active || savedFrameRef.current !== null) return;
        savedFrameRef.current = window.requestAnimationFrame(() => {
          savedFrameRef.current = null;
          if (active) drawSavedGeometry();
        });
      };
      requestSavedRedrawRef.current = scheduleSavedRedraw;

      const redraw = () => {
        scheduleSavedRedraw();
        if (active && interactionRef.current.mode !== "browse") {
          forceActiveOverlayRender((value) => value + 1);
        }
      };

      const persistCamera = () => {
        if (suppressNextCameraSaveRef.current) {
          suppressNextCameraSaveRef.current = false;
          onCameraChange(cameraFromMap(map));
          return;
        }
        if (cameraSaveTimerRef.current !== null) window.clearTimeout(cameraSaveTimerRef.current);
        cameraSaveTimerRef.current = window.setTimeout(() => {
          const camera = cameraFromMap(map);
          savePersonalMapView(campaignId, camera);
          onCameraChange(camera);
        }, 350);
      };

      map.on("load", redraw);
      map.on("move", redraw);
      map.on("rotate", redraw);
      map.on("zoom", redraw);
      map.on("resize", redraw);
      map.on("moveend", persistCamera);
      map.on("click", (event) => {
        const interaction = interactionRef.current;
        const lngLat: LngLat = [event.lngLat.lng, event.lngLat.lat];

        if (interaction.mode === "draw") {
          interaction.onDrawPoint(lngLat);
          return;
        }
        if (interaction.mode === "street-draw") {
          interaction.onStreetDrawPoint(lngLat);
          return;
        }
        if (interaction.mode === "edit") {
          const vertexIndex = findEditVertex(map, interaction.editingVertices, event.point);
          if (vertexIndex !== null) {
            interaction.onEditVertexSelect(vertexIndex);
            return;
          }
          if (interaction.selectedVertexIndex !== null) {
            interaction.onEditVertexMove(interaction.selectedVertexIndex, lngLat);
          }
          return;
        }

        const taskId = findTaskHit(map, interaction.tasks, event.point);
        if (taskId) {
          interaction.onTaskSelect(taskId);
          return;
        }
        interaction.onTaskSelect(null);
        const areaHit = [...interaction.areas]
          .reverse()
          .find((area) => pointInPolygon(lngLat, openAreaRing(area)));
        interaction.onAreaSelect(areaHit?.id ?? null);
      });

      map.addControl(new NavigationControl({ showCompass: true, showZoom: true }), "top-right");
      map.addControl(
        new GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: false,
          showUserLocation: true,
          showAccuracyCircle: true,
        }),
        "top-right",
      );
      onCameraChange(initialCamera);
      redraw();
    } catch (cause) {
      console.error("Map initialization failed", cause);
      if (active) setError(t(language, "mapInitError"));
    }

    return () => {
      active = false;
      requestSavedRedrawRef.current = null;
      if (cameraSaveTimerRef.current !== null) window.clearTimeout(cameraSaveTimerRef.current);
      if (savedFrameRef.current !== null) window.cancelAnimationFrame(savedFrameRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [campaignId]);

  useEffect(() => {
    requestSavedRedrawRef.current?.();
  }, [areaGroups, streetGroups, selectedTask]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mode === "browse") map.doubleClickZoom.enable();
    else map.doubleClickZoom.disable();
    requestSavedRedrawRef.current?.();
    if (mode !== "browse") forceActiveOverlayRender((value) => value + 1);
  }, [mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cameraCommand) return;
    if (cameraCommand.persist === false) suppressNextCameraSaveRef.current = true;
    map.jumpTo({
      center: cameraCommand.view.center,
      zoom: cameraCommand.view.zoom,
      bearing: cameraCommand.view.bearing,
    });
  }, [cameraCommand?.id]);

  const map = mapRef.current;

  return (
    <section className={`map-region map-mode-${mode}`} aria-label={t(language, "map")}>
      <div ref={containerRef} className="map" />

      <svg className="application-overlay saved-geometry-overlay" aria-hidden="true">
        {areaGroups.map((group) => (
          <path
            key={group.key}
            ref={(node) => {
              if (node) areaPathRefs.current.set(group.key, node);
              else areaPathRefs.current.delete(group.key);
            }}
            d=""
            fill={group.color}
            fillOpacity={0.1}
            stroke={group.color}
            strokeOpacity={0.94}
            strokeLinejoin="round"
          />
        ))}

        {selectedTask ? (
          <path
            ref={selectedStreetPathRef}
            d=""
            fill="none"
            stroke="#172019"
            strokeOpacity={0.72}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {streetGroups.map((group) => {
          const presentation = statusPresentation(group.status);
          return (
            <path
              key={group.key}
              ref={(node) => {
                if (node) streetPathRefs.current.set(group.key, node);
                else streetPathRefs.current.delete(group.key);
              }}
              d=""
              fill="none"
              stroke={group.color}
              strokeOpacity={presentation.opacity}
              strokeDasharray={presentation.dash}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>

      {mode !== "browse" ? (
        <svg className="application-overlay active-geometry-overlay" aria-hidden="true">
          {mode === "draw" ? (
            <>
              {draftVertices.length >= 2 ? (
                draftVertices.length >= 3 ? (
                  <polygon
                    points={projectedPoints(map, draftVertices)}
                    fill={draftColor}
                    fillOpacity={0.3}
                    stroke={draftColor}
                    strokeWidth={6}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <polyline
                    points={projectedPoints(map, draftVertices)}
                    fill="none"
                    stroke={draftColor}
                    strokeWidth={6}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )
              ) : null}
              <ProjectedMarkers map={map} coordinates={draftVertices} color={draftColor} radius={9} />
            </>
          ) : null}

          {mode === "edit" ? (
            <>
              {editingVertices.length >= 3 ? (
                <>
                  <polygon
                    points={projectedPoints(map, editingVertices)}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={13}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polygon
                    points={projectedPoints(map, editingVertices)}
                    fill={editingColor}
                    fillOpacity={0.32}
                    stroke={editingColor}
                    strokeWidth={7}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              ) : null}
              <ProjectedMarkers
                map={map}
                coordinates={editingVertices}
                color={editingColor}
                selectedIndex={selectedVertexIndex}
                radius={10}
              />
            </>
          ) : null}

          {mode === "street-draw" ? (
            <>
              {streetDraftVertices.length >= 2 ? (
                <>
                  <polyline
                    points={projectedPoints(map, streetDraftVertices)}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={11}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polyline
                    points={projectedPoints(map, streetDraftVertices)}
                    fill="none"
                    stroke={streetDraftColor}
                    strokeWidth={7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              ) : null}
              <ProjectedMarkers
                map={map}
                coordinates={streetDraftVertices}
                color={streetDraftColor}
                radius={9}
              />
            </>
          ) : null}
        </svg>
      ) : null}

      {mode === "browse" ? (
        <div className={`map-refresh-control is-${refreshState}`}>
          <button
            className="map-refresh-button"
            type="button"
            onClick={onRefresh}
            disabled={refreshState === "loading"}
            aria-label={t(language, "refreshData")}
            title={t(language, "refreshData")}
          >
            <span aria-hidden="true">↻</span>
          </button>
        </div>
      ) : null}

      {error ? <div className="map-error">{error}</div> : null}
    </section>
  );
}
