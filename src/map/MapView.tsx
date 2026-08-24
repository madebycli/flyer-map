import { useEffect, useRef, useState } from "react";
import {
  GeolocateControl,
  Map,
  NavigationControl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import type { Area, DistributionTask, LngLat, MapCameraView } from "../domain/campaign";
import type { Language } from "../i18n";
import { t } from "../i18n";
import { loadPersonalMapView, savePersonalMapView } from "./cameraStore";
import "maplibre-gl/dist/maplibre-gl.css";

type MapMode = "browse" | "draw" | "edit" | "street-draw";
type RenderArea = Area & { color: string };
type RenderTask = DistributionTask & { color: string };
type GeoJSONData = Parameters<GeoJSONSource["setData"]>[0];

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
const AREA_SOURCE_ID = "vf-saved-areas";
const AREA_FILL_LAYER_ID = "vf-saved-areas-fill";
const AREA_OUTLINE_LAYER_ID = "vf-saved-areas-outline";
const STREET_SOURCE_ID = "vf-saved-streets";
const STREET_SELECTED_LAYER_ID = "vf-saved-streets-selected";
const STREET_OPEN_LAYER_ID = "vf-saved-streets-open";
const STREET_COMPLETED_LAYER_ID = "vf-saved-streets-completed";
const STREET_LATER_LAYER_ID = "vf-saved-streets-later";
const STREET_BLOCKED_LAYER_ID = "vf-saved-streets-not-deliverable";
const STREET_RENDER_LAYER_IDS = [
  STREET_OPEN_LAYER_ID,
  STREET_COMPLETED_LAYER_ID,
  STREET_LATER_LAYER_ID,
  STREET_BLOCKED_LAYER_ID,
] as const;

const TEAM_COLOR: ExpressionSpecification = ["get", "color"];
const STREET_WIDTH: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  0.18,
  8,
  0.32,
  11,
  0.65,
  14,
  1.25,
  17,
  2.35,
  20,
  3.7,
];
const STREET_SELECTED_WIDTH: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  0.65,
  8,
  0.95,
  11,
  1.45,
  14,
  2.35,
  17,
  4.1,
  20,
  6.1,
];
const AREA_OUTLINE_WIDTH: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  0.22,
  8,
  0.38,
  11,
  0.65,
  14,
  1.05,
  17,
  1.55,
  20,
  2.15,
];

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
    { id: "map-background", type: "background", paint: { "background-color": "#fbf8f3" } },
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

function areaFeatureCollection(areas: RenderArea[]): GeoJSONData {
  return {
    type: "FeatureCollection",
    features: areas.map((area) => ({
      type: "Feature",
      id: area.id,
      properties: { id: area.id, teamId: area.teamId, color: area.color },
      geometry: area.geometry,
    })),
  } as GeoJSONData;
}

function streetFeatureCollection(tasks: RenderTask[]): GeoJSONData {
  return {
    type: "FeatureCollection",
    features: tasks.map((task) => ({
      type: "Feature",
      id: task.id,
      properties: {
        id: task.id,
        areaId: task.areaId,
        color: task.color,
        status: task.status,
      },
      geometry: task.geometry,
    })),
  } as GeoJSONData;
}

function setSourceData(map: Map, sourceId: string, data: GeoJSONData) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  source?.setData(data);
}

function installSavedGeometryLayers(map: Map, areas: RenderArea[], tasks: RenderTask[]) {
  if (!map.getSource(AREA_SOURCE_ID)) {
    map.addSource(AREA_SOURCE_ID, { type: "geojson", data: areaFeatureCollection(areas) });
  }
  if (!map.getLayer(AREA_FILL_LAYER_ID)) {
    map.addLayer({
      id: AREA_FILL_LAYER_ID,
      type: "fill",
      source: AREA_SOURCE_ID,
      paint: { "fill-color": TEAM_COLOR, "fill-opacity": 0.1 },
    });
  }
  if (!map.getLayer(AREA_OUTLINE_LAYER_ID)) {
    map.addLayer({
      id: AREA_OUTLINE_LAYER_ID,
      type: "line",
      source: AREA_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": TEAM_COLOR,
        "line-width": AREA_OUTLINE_WIDTH,
        "line-opacity": 0.95,
      },
    });
  }

  if (!map.getSource(STREET_SOURCE_ID)) {
    map.addSource(STREET_SOURCE_ID, { type: "geojson", data: streetFeatureCollection(tasks) });
  }
  if (!map.getLayer(STREET_SELECTED_LAYER_ID)) {
    map.addLayer({
      id: STREET_SELECTED_LAYER_ID,
      type: "line",
      source: STREET_SOURCE_ID,
      filter: ["==", ["get", "id"], "__none__"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": STREET_SELECTED_WIDTH,
        "line-opacity": 0.92,
      },
    });
  }

  const addStreetLayer = (
    id: string,
    status: DistributionTask["status"],
    opacity: number,
    dasharray?: number[],
  ) => {
    if (map.getLayer(id)) return;
    map.addLayer({
      id,
      type: "line",
      source: STREET_SOURCE_ID,
      filter: ["==", ["get", "status"], status],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": TEAM_COLOR,
        "line-width": STREET_WIDTH,
        "line-opacity": opacity,
        ...(dasharray ? { "line-dasharray": dasharray } : {}),
      },
    });
  };

  addStreetLayer(STREET_OPEN_LAYER_ID, "open", 0.96);
  addStreetLayer(STREET_COMPLETED_LAYER_ID, "completed", 0.38);
  addStreetLayer(STREET_LATER_LAYER_ID, "later", 0.84, [2.5, 2.2]);
  addStreetLayer(STREET_BLOCKED_LAYER_ID, "not-deliverable", 0.74, [0.35, 2.2]);
}

/**
 * Keep saved geometry durable in the MapLibre style. Once the sources exist we
 * always push new data, even while raster tiles are still loading. The old
 * implementation returned early whenever isStyleLoaded() was temporarily
 * false, which could silently drop the one update produced by Save.
 */
function syncSavedGeometry(map: Map, areas: RenderArea[], tasks: RenderTask[]) {
  const hasSources = Boolean(map.getSource(AREA_SOURCE_ID) && map.getSource(STREET_SOURCE_ID));
  if (!hasSources) {
    if (!map.isStyleLoaded()) return false;
    installSavedGeometryLayers(map, areas, tasks);
  }

  setSourceData(map, AREA_SOURCE_ID, areaFeatureCollection(areas));
  setSourceData(map, STREET_SOURCE_ID, streetFeatureCollection(tasks));
  return true;
}

function syncSelectedStreet(map: Map, selectedTaskId: string | null) {
  if (!map.getLayer(STREET_SELECTED_LAYER_ID)) return;
  map.setFilter(STREET_SELECTED_LAYER_ID, ["==", ["get", "id"], selectedTaskId ?? "__none__"]);
}

function findRenderedTask(map: Map, point: { x: number; y: number }) {
  const layers = STREET_RENDER_LAYER_IDS.filter((id) => Boolean(map.getLayer(id)));
  if (!layers.length) return null;
  const padding = 12;
  const features = map.queryRenderedFeatures(
    [
      [point.x - padding, point.y - padding],
      [point.x + padding, point.y + padding],
    ],
    { layers: [...layers] },
  );
  const id = features.find((feature) => typeof feature.properties?.id === "string")?.properties?.id;
  return typeof id === "string" ? id : null;
}

function findRenderedArea(map: Map, point: { x: number; y: number }) {
  if (!map.getLayer(AREA_FILL_LAYER_ID)) return null;
  const features = map.queryRenderedFeatures([point.x, point.y], { layers: [AREA_FILL_LAYER_ID] });
  const id = features.find((feature) => typeof feature.properties?.id === "string")?.properties?.id;
  return typeof id === "string" ? id : null;
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
  return { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing() };
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
  const overlayFrameRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, forceOverlayRender] = useState(0);

  const interactionRef = useRef({
    areas,
    tasks,
    selectedTaskId,
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
      selectedTaskId,
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
    selectedTaskId,
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

      const redrawActiveOverlay = () => {
        if (!active || interactionRef.current.mode === "browse" || overlayFrameRef.current !== null) return;
        overlayFrameRef.current = window.requestAnimationFrame(() => {
          overlayFrameRef.current = null;
          if (active) forceOverlayRender((value) => value + 1);
        });
      };

      const syncLatestSavedGeometry = () => {
        const interaction = interactionRef.current;
        if (!syncSavedGeometry(map, interaction.areas, interaction.tasks)) return;
        syncSelectedStreet(map, interaction.selectedTaskId);
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

      map.on("load", syncLatestSavedGeometry);
      map.on("styledata", syncLatestSavedGeometry);
      map.on("move", redrawActiveOverlay);
      map.on("rotate", redrawActiveOverlay);
      map.on("zoom", redrawActiveOverlay);
      map.on("resize", redrawActiveOverlay);
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

        const taskId = findRenderedTask(map, event.point);
        if (taskId) {
          interaction.onTaskSelect(taskId);
          return;
        }
        interaction.onTaskSelect(null);
        interaction.onAreaSelect(findRenderedArea(map, event.point));
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
    } catch (cause) {
      console.error("Map initialization failed", cause);
      if (active) setError(t(language, "mapInitError"));
    }

    return () => {
      active = false;
      if (cameraSaveTimerRef.current !== null) window.clearTimeout(cameraSaveTimerRef.current);
      if (overlayFrameRef.current !== null) window.cancelAnimationFrame(overlayFrameRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [campaignId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (syncSavedGeometry(map, areas, tasks)) syncSelectedStreet(map, selectedTaskId);
  }, [areas, tasks, selectedTaskId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mode === "browse") map.doubleClickZoom.enable();
    else map.doubleClickZoom.disable();
    if (mode !== "browse") forceOverlayRender((value) => value + 1);
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
  const width = containerRef.current?.clientWidth ?? 1;
  const height = containerRef.current?.clientHeight ?? 1;
  const hasActiveOverlay = mode === "draw" || mode === "edit" || mode === "street-draw";
  const refreshGlyph =
    refreshState === "loading" ? "↻" : refreshState === "error" ? "!" : refreshState === "current" ? "✓" : "↻";

  return (
    <section className={`map-region map-mode-${mode}`} aria-label={t(language, "map")}>
      <div ref={containerRef} className="map" />

      {hasActiveOverlay ? (
        <svg
          className="application-overlay"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {mode === "draw" ? (
            <>
              {draftVertices.length >= 2 ? (
                draftVertices.length >= 3 ? (
                  <polygon
                    points={projectedPoints(map, draftVertices)}
                    fill={draftColor}
                    fillOpacity={0.2}
                    stroke={draftColor}
                    strokeWidth={5}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <polyline
                    points={projectedPoints(map, draftVertices)}
                    fill="none"
                    stroke={draftColor}
                    strokeWidth={5}
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
                    strokeWidth={10}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polygon
                    points={projectedPoints(map, editingVertices)}
                    fill={editingColor}
                    fillOpacity={0.2}
                    stroke={editingColor}
                    strokeWidth={5}
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
                <polyline
                  points={projectedPoints(map, streetDraftVertices)}
                  fill="none"
                  stroke={streetDraftColor}
                  strokeWidth={5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              <ProjectedMarkers map={map} coordinates={streetDraftVertices} color={streetDraftColor} radius={9} />
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
            <span aria-hidden="true">{refreshGlyph}</span>
          </button>
        </div>
      ) : null}

      {error ? <div className="map-error">{error}</div> : null}
    </section>
  );
}
