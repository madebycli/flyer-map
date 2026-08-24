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
type GeoBounds = { west: number; east: number; south: number; north: number };
type PreparedArea = { area: RenderArea; ring: LngLat[]; bounds: GeoBounds };
type PreparedTask = { task: RenderTask; coordinates: LngLat[]; bounds: GeoBounds };
type AreaGroup = { key: string; color: string; areas: PreparedArea[] };
type StreetGroup = {
  key: string;
  color: string;
  status: DistributionTask["status"];
  tasks: PreparedTask[];
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
const MAX_OVERLAY_DPR = 2;
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

function projectedPoints(map: Map, coordinates: LngLat[]) {
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

function geometryBounds(coordinates: LngLat[]): GeoBounds {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lng, lat] of coordinates) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, east, south, north };
}

function prepareAreas(areas: RenderArea[]) {
  return areas.map((area): PreparedArea => {
    const ring = openAreaRing(area);
    return { area, ring, bounds: geometryBounds(ring) };
  });
}

function prepareTasks(tasks: RenderTask[]) {
  return tasks.map((task): PreparedTask => {
    const coordinates = task.geometry.coordinates as LngLat[];
    return { task, coordinates, bounds: geometryBounds(coordinates) };
  });
}

function groupAreas(areas: PreparedArea[]) {
  const groups = new globalThis.Map<string, PreparedArea[]>();
  for (const area of areas) {
    const current = groups.get(area.area.color);
    if (current) current.push(area);
    else groups.set(area.area.color, [area]);
  }
  return [...groups.entries()].map(([color, groupedAreas]) => ({
    key: color,
    color,
    areas: groupedAreas,
  }));
}

function groupStreets(tasks: PreparedTask[]) {
  const groups = new globalThis.Map<string, StreetGroup>();
  for (const task of tasks) {
    const key = `${task.task.color}:${task.task.status}`;
    const current = groups.get(key);
    if (current) current.tasks.push(task);
    else {
      groups.set(key, {
        key,
        color: task.task.color,
        status: task.task.status,
        tasks: [task],
      });
    }
  }
  return [...groups.values()];
}

function currentViewportBounds(map: Map): GeoBounds {
  const bounds = map.getBounds();
  return {
    west: bounds.getWest(),
    east: bounds.getEast(),
    south: bounds.getSouth(),
    north: bounds.getNorth(),
  };
}

function boundsIntersect(a: GeoBounds, b: GeoBounds) {
  return !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north);
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
    [5, 0.3],
    [8, 0.42],
    [11, 0.68],
    [14, 1.1],
    [17, 1.8],
    [20, 2.7],
  ]);
}

function areaWidth(zoom: number) {
  return interpolateWidth(zoom, [
    [5, 0.28],
    [8, 0.4],
    [11, 0.62],
    [14, 0.9],
    [17, 1.3],
    [20, 1.8],
  ]);
}

function statusPresentation(status: DistributionTask["status"]) {
  switch (status) {
    case "completed":
      return { opacity: 0.38, dash: [] as number[], widthFactor: 0.9 };
    case "later":
      return { opacity: 0.84, dash: [7, 5], widthFactor: 1 };
    case "not-deliverable":
      return { opacity: 0.72, dash: [2, 6], widthFactor: 1 };
    default:
      return { opacity: 0.96, dash: [] as number[], widthFactor: 1 };
  }
}

function ensureCanvasSize(canvas: HTMLCanvasElement, map: Map) {
  const width = Math.max(1, map.getContainer().clientWidth);
  const height = Math.max(1, map.getContainer().clientHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_OVERLAY_DPR);
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  return { width, height, dpr };
}

function traceLine(ctx: CanvasRenderingContext2D, map: Map, coordinates: LngLat[]) {
  if (coordinates.length < 2) return false;
  const first = map.project(coordinates[0]);
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < coordinates.length; index += 1) {
    const point = map.project(coordinates[index]);
    ctx.lineTo(point.x, point.y);
  }
  return true;
}

function drawSavedCanvas(
  canvas: HTMLCanvasElement,
  map: Map,
  areaGroups: AreaGroup[],
  streetGroups: StreetGroup[],
  selectedTask: PreparedTask | null,
) {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  const { width, height, dpr } = ensureCanvasSize(canvas, map);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const viewport = currentViewportBounds(map);
  const zoom = map.getZoom();
  const currentAreaWidth = areaWidth(zoom);
  const currentStreetWidth = streetWidth(zoom);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const group of areaGroups) {
    let hasVisibleArea = false;
    ctx.beginPath();
    for (const prepared of group.areas) {
      if (prepared.ring.length < 3 || !boundsIntersect(prepared.bounds, viewport)) continue;
      const first = map.project(prepared.ring[0]);
      ctx.moveTo(first.x, first.y);
      for (let index = 1; index < prepared.ring.length; index += 1) {
        const point = map.project(prepared.ring[index]);
        ctx.lineTo(point.x, point.y);
      }
      ctx.closePath();
      hasVisibleArea = true;
    }
    if (!hasVisibleArea) continue;
    ctx.fillStyle = group.color;
    ctx.globalAlpha = 0.09;
    ctx.fill();
    ctx.strokeStyle = group.color;
    ctx.globalAlpha = 0.92;
    ctx.lineWidth = currentAreaWidth;
    ctx.setLineDash([]);
    ctx.stroke();
  }

  if (selectedTask && boundsIntersect(selectedTask.bounds, viewport)) {
    ctx.beginPath();
    if (traceLine(ctx, map, selectedTask.coordinates)) {
      ctx.strokeStyle = "#172019";
      ctx.globalAlpha = 0.68;
      ctx.lineWidth = currentStreetWidth * 2.05 + 1.2;
      ctx.setLineDash([]);
      ctx.stroke();
    }
  }

  for (const group of streetGroups) {
    const presentation = statusPresentation(group.status);
    let hasVisibleTask = false;
    ctx.beginPath();
    for (const prepared of group.tasks) {
      if (!boundsIntersect(prepared.bounds, viewport)) continue;
      hasVisibleTask = traceLine(ctx, map, prepared.coordinates) || hasVisibleTask;
    }
    if (!hasVisibleTask) continue;
    ctx.strokeStyle = group.color;
    ctx.globalAlpha = presentation.opacity;
    ctx.lineWidth = currentStreetWidth * presentation.widthFactor;
    ctx.setLineDash(presentation.dash);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

function updateActiveMarkers(
  map: Map,
  markerRefs: Array<SVGCircleElement | null>,
  coordinates: LngLat[],
) {
  for (let index = 0; index < coordinates.length; index += 1) {
    const marker = markerRefs[index];
    if (!marker) continue;
    const point = map.project(coordinates[index]);
    marker.setAttribute("cx", String(point.x));
    marker.setAttribute("cy", String(point.y));
  }
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
  const savedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activePrimaryRef = useRef<SVGElement | null>(null);
  const activeSecondaryRef = useRef<SVGElement | null>(null);
  const activeMarkerRefs = useRef<Array<SVGCircleElement | null>>([]);
  const cameraSaveTimerRef = useRef<number | null>(null);
  const suppressNextCameraSaveRef = useRef(false);
  const redrawFrameRef = useRef<number | null>(null);
  const requestRedrawRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preparedAreas = useMemo(() => prepareAreas(areas), [areas]);
  const preparedTasks = useMemo(() => prepareTasks(tasks), [tasks]);
  const areaGroups = useMemo(() => groupAreas(preparedAreas), [preparedAreas]);
  const streetGroups = useMemo(() => groupStreets(preparedTasks), [preparedTasks]);
  const selectedTask = useMemo(
    () => preparedTasks.find((prepared) => prepared.task.id === selectedTaskId) ?? null,
    [preparedTasks, selectedTaskId],
  );
  const savedRenderRef = useRef({ areaGroups, streetGroups, selectedTask });
  savedRenderRef.current = { areaGroups, streetGroups, selectedTask };

  const interactionRef = useRef({
    areas,
    tasks,
    mode,
    draftVertices,
    editingVertices,
    selectedVertexIndex,
    streetDraftVertices,
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
      draftVertices,
      editingVertices,
      selectedVertexIndex,
      streetDraftVertices,
      onAreaSelect,
      onTaskSelect,
      onDrawPoint,
      onEditVertexSelect,
      onEditVertexMove,
      onStreetDrawPoint,
    };
    requestRedrawRef.current?.();
  }, [
    areas,
    tasks,
    mode,
    draftVertices,
    editingVertices,
    selectedVertexIndex,
    streetDraftVertices,
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

      const drawActiveGeometry = () => {
        const interaction = interactionRef.current;
        if (interaction.mode === "browse") return;

        let coordinates: LngLat[] = [];
        if (interaction.mode === "draw") coordinates = interaction.draftVertices;
        else if (interaction.mode === "edit") coordinates = interaction.editingVertices;
        else coordinates = interaction.streetDraftVertices;

        const points = projectedPoints(map, coordinates);
        activePrimaryRef.current?.setAttribute("points", points);
        activeSecondaryRef.current?.setAttribute("points", points);
        updateActiveMarkers(map, activeMarkerRefs.current, coordinates);
      };

      const redraw = () => {
        if (!active || redrawFrameRef.current !== null) return;
        redrawFrameRef.current = window.requestAnimationFrame(() => {
          redrawFrameRef.current = null;
          if (!active) return;
          const canvas = savedCanvasRef.current;
          if (canvas) {
            const render = savedRenderRef.current;
            drawSavedCanvas(canvas, map, render.areaGroups, render.streetGroups, render.selectedTask);
          }
          drawActiveGeometry();
        });
      };
      requestRedrawRef.current = redraw;

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
      requestRedrawRef.current = null;
      if (cameraSaveTimerRef.current !== null) window.clearTimeout(cameraSaveTimerRef.current);
      if (redrawFrameRef.current !== null) window.cancelAnimationFrame(redrawFrameRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [campaignId]);

  useEffect(() => {
    requestRedrawRef.current?.();
  }, [areaGroups, streetGroups, selectedTask]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mode === "browse") map.doubleClickZoom.enable();
    else map.doubleClickZoom.disable();
    requestRedrawRef.current?.();
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

  const renderMarker = (coordinate: LngLat, index: number, color: string, radius: number) => {
    const selected = mode === "edit" && selectedVertexIndex === index;
    return (
      <circle
        key={`${coordinate[0]}:${coordinate[1]}:${index}`}
        ref={(node) => {
          activeMarkerRefs.current[index] = node;
        }}
        cx={0}
        cy={0}
        r={selected ? radius + 3 : radius}
        fill={selected ? "#ffffff" : color}
        stroke={selected ? color : "#ffffff"}
        strokeWidth={selected ? 4.5 : 3.5}
        vectorEffect="non-scaling-stroke"
      />
    );
  };

  return (
    <section className={`map-region map-mode-${mode}`} aria-label={t(language, "map")}>
      <div ref={containerRef} className="map" />
      <canvas ref={savedCanvasRef} className="saved-geometry-canvas" aria-hidden="true" />

      {mode !== "browse" ? (
        <svg className="application-overlay active-geometry-overlay" aria-hidden="true">
          {mode === "draw" ? (
            <>
              {draftVertices.length >= 2 ? (
                draftVertices.length >= 3 ? (
                  <polygon
                    ref={(node) => {
                      activePrimaryRef.current = node;
                      activeSecondaryRef.current = null;
                    }}
                    points=""
                    fill={draftColor}
                    fillOpacity={0.3}
                    stroke={draftColor}
                    strokeWidth={6}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <polyline
                    ref={(node) => {
                      activePrimaryRef.current = node;
                      activeSecondaryRef.current = null;
                    }}
                    points=""
                    fill="none"
                    stroke={draftColor}
                    strokeWidth={6}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )
              ) : null}
              {draftVertices.map((coordinate, index) => renderMarker(coordinate, index, draftColor, 9))}
            </>
          ) : null}

          {mode === "edit" ? (
            <>
              {editingVertices.length >= 3 ? (
                <>
                  <polygon
                    ref={(node) => {
                      activePrimaryRef.current = node;
                    }}
                    points=""
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={13}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polygon
                    ref={(node) => {
                      activeSecondaryRef.current = node;
                    }}
                    points=""
                    fill={editingColor}
                    fillOpacity={0.32}
                    stroke={editingColor}
                    strokeWidth={7}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              ) : null}
              {editingVertices.map((coordinate, index) => renderMarker(coordinate, index, editingColor, 10))}
            </>
          ) : null}

          {mode === "street-draw" ? (
            <>
              {streetDraftVertices.length >= 2 ? (
                <>
                  <polyline
                    ref={(node) => {
                      activePrimaryRef.current = node;
                    }}
                    points=""
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={11}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polyline
                    ref={(node) => {
                      activeSecondaryRef.current = node;
                    }}
                    points=""
                    fill="none"
                    stroke={streetDraftColor}
                    strokeWidth={7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              ) : null}
              {streetDraftVertices.map((coordinate, index) =>
                renderMarker(coordinate, index, streetDraftColor, 9),
              )}
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
