import { useEffect, useMemo, useRef, useState } from "react";
import { GeolocateControl, Map, NavigationControl } from "maplibre-gl";
import type { ExpressionSpecification, GeoJSONSource, StyleSpecification } from "maplibre-gl";
import {
  browserOfflineMapRepository,
  OFFLINE_MAP_CHANGED_EVENT,
} from "../data/offlineMapRepository";
import type { Area, DistributionTask, LngLat, MapCameraView } from "../domain/campaign";
import type { OfflineMapPackage } from "../domain/offlineMap";
import type { Language } from "../i18n";
import { t } from "../i18n";
import { loadPersonalMapView, savePersonalMapView } from "./cameraStore";
import {
  CARTO_BASEMAP_LAYER_ID,
  OFFLINE_BUILDING_LAYER_ID,
  OFFLINE_BUILDING_SOURCE_ID,
  OFFLINE_ROAD_LAYER_ID,
  OFFLINE_ROAD_SOURCE_ID,
  emptyOfflineBuildings,
  emptyOfflineRoads,
  offlineBuildingData,
  offlineMapRendererMode,
  offlineRoadData,
} from "./offlineMapContext";
import "maplibre-gl/dist/maplibre-gl.css";

type MapMode = "browse" | "draw" | "edit" | "street-draw";
type RenderArea = Area & { color: string };
type RenderTask = DistributionTask & { color: string };

type AreaFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: {
      areaId: string;
      teamId: string;
      name: string;
      color: string;
    };
    geometry: {
      type: "Polygon";
      coordinates: LngLat[][];
    };
  }>;
};

type StreetFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: {
      taskId: string;
      areaId: string;
      label: string;
      color: string;
      status: DistributionTask["status"];
    };
    geometry: {
      type: "LineString";
      coordinates: LngLat[];
    };
  }>;
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

const AREA_SOURCE_ID = "vf-areas";
const AREA_FILL_LAYER_ID = "vf-areas-fill";
const AREA_OUTLINE_LAYER_ID = "vf-areas-outline";
const STREET_SOURCE_ID = "vf-streets";
const STREET_SELECTED_LAYER_ID = "vf-streets-selected";
const STREET_OPEN_LAYER_ID = "vf-streets-open";
const STREET_COMPLETED_LAYER_ID = "vf-streets-completed";
const STREET_LATER_LAYER_ID = "vf-streets-later";
const STREET_NOT_DELIVERABLE_LAYER_ID = "vf-streets-not-deliverable";
const STREET_LAYER_IDS = [
  STREET_SELECTED_LAYER_ID,
  STREET_OPEN_LAYER_ID,
  STREET_COMPLETED_LAYER_ID,
  STREET_LATER_LAYER_ID,
  STREET_NOT_DELIVERABLE_LAYER_ID,
] as const;

const STREET_WIDTH_EXPRESSION: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  0.45,
  8,
  0.55,
  11,
  0.8,
  14,
  1.25,
  17,
  2.0,
  20,
  3.0,
];

const OFFLINE_ROAD_WIDTH_EXPRESSION: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  10,
  0.7,
  13,
  1.15,
  16,
  1.9,
  19,
  3.0,
];

const AREA_WIDTH_EXPRESSION: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  0.45,
  8,
  0.55,
  11,
  0.75,
  14,
  1.0,
  17,
  1.45,
  20,
  2.0,
];

const SELECTED_STREET_WIDTH_EXPRESSION: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  1.2,
  8,
  1.4,
  11,
  1.75,
  14,
  2.35,
  17,
  3.4,
  20,
  4.8,
];

function areasToGeoJson(areas: RenderArea[]): AreaFeatureCollection {
  return {
    type: "FeatureCollection",
    features: areas.map((area) => ({
      type: "Feature",
      id: area.id,
      properties: {
        areaId: area.id,
        teamId: area.teamId,
        name: area.name,
        color: area.color,
      },
      geometry: {
        type: "Polygon",
        coordinates: area.geometry.coordinates,
      },
    })),
  };
}

function streetsToGeoJson(tasks: RenderTask[]): StreetFeatureCollection {
  return {
    type: "FeatureCollection",
    features: tasks.map((task) => ({
      type: "Feature",
      id: task.id,
      properties: {
        taskId: task.id,
        areaId: task.areaId,
        label: task.label,
        color: task.color,
        status: task.status,
      },
      geometry: {
        type: "LineString",
        coordinates: task.geometry.coordinates,
      },
    })),
  };
}

function buildMapStyle(areas: RenderArea[], tasks: RenderTask[], online: boolean): StyleSpecification {
  return {
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
      [OFFLINE_BUILDING_SOURCE_ID]: {
        type: "geojson",
        data: emptyOfflineBuildings(),
      },
      [OFFLINE_ROAD_SOURCE_ID]: {
        type: "geojson",
        data: emptyOfflineRoads(),
      },
      [AREA_SOURCE_ID]: {
        type: "geojson",
        data: areasToGeoJson(areas),
      },
      [STREET_SOURCE_ID]: {
        type: "geojson",
        data: streetsToGeoJson(tasks),
      },
    },
    layers: [
      {
        id: "map-background",
        type: "background",
        paint: { "background-color": "#fbf8f3" },
      },
      {
        id: CARTO_BASEMAP_LAYER_ID,
        type: "raster",
        source: "carto",
        minzoom: 0,
        maxzoom: 21,
        layout: { visibility: online ? "visible" : "none" },
        paint: { "raster-fade-duration": 0 },
      },
      {
        id: OFFLINE_BUILDING_LAYER_ID,
        type: "fill",
        source: OFFLINE_BUILDING_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "fill-color": "#ddd8cf",
          "fill-opacity": 0.7,
          "fill-outline-color": "#b9b3a9",
        },
      },
      {
        id: OFFLINE_ROAD_LAYER_ID,
        type: "line",
        source: OFFLINE_ROAD_SOURCE_ID,
        layout: {
          visibility: "none",
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#777b77",
          "line-opacity": 0.9,
          "line-width": OFFLINE_ROAD_WIDTH_EXPRESSION,
        },
      },
      {
        id: AREA_FILL_LAYER_ID,
        type: "fill",
        source: AREA_SOURCE_ID,
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.13,
        },
      },
      {
        id: AREA_OUTLINE_LAYER_ID,
        type: "line",
        source: AREA_SOURCE_ID,
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.94,
          "line-width": AREA_WIDTH_EXPRESSION,
        },
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
      },
      {
        id: STREET_SELECTED_LAYER_ID,
        type: "line",
        source: STREET_SOURCE_ID,
        filter: ["==", ["get", "taskId"], "__none__"],
        paint: {
          "line-color": "#172019",
          "line-opacity": 0.7,
          "line-width": SELECTED_STREET_WIDTH_EXPRESSION,
        },
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
      },
      {
        id: STREET_OPEN_LAYER_ID,
        type: "line",
        source: STREET_SOURCE_ID,
        filter: ["==", ["get", "status"], "open"],
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.98,
          "line-width": STREET_WIDTH_EXPRESSION,
        },
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
      },
      {
        id: STREET_COMPLETED_LAYER_ID,
        type: "line",
        source: STREET_SOURCE_ID,
        filter: ["==", ["get", "status"], "completed"],
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.42,
          "line-width": STREET_WIDTH_EXPRESSION,
        },
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
      },
      {
        id: STREET_LATER_LAYER_ID,
        type: "line",
        source: STREET_SOURCE_ID,
        filter: ["==", ["get", "status"], "later"],
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.86,
          "line-width": STREET_WIDTH_EXPRESSION,
          "line-dasharray": [5, 4],
        },
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
      },
      {
        id: STREET_NOT_DELIVERABLE_LAYER_ID,
        type: "line",
        source: STREET_SOURCE_ID,
        filter: ["==", ["get", "status"], "not-deliverable"],
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.74,
          "line-width": STREET_WIDTH_EXPRESSION,
          "line-dasharray": [1.5, 4.5],
        },
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
      },
    ],
  };
}

function cameraFromMap(map: Map): MapCameraView {
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
  };
}

function projectedPoints(map: Map, coordinates: LngLat[]) {
  return coordinates
    .map((coordinate) => {
      const point = map.project(coordinate);
      return `${point.x},${point.y}`;
    })
    .join(" ");
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

function syncApplicationData(
  map: Map,
  areas: RenderArea[],
  tasks: RenderTask[],
  selectedTaskId: string | null,
) {
  const areaSource = map.getSource(AREA_SOURCE_ID) as GeoJSONSource | undefined;
  if (areaSource) areaSource.setData(areasToGeoJson(areas));

  const streetSource = map.getSource(STREET_SOURCE_ID) as GeoJSONSource | undefined;
  if (streetSource) streetSource.setData(streetsToGeoJson(tasks));

  if (map.getLayer(STREET_SELECTED_LAYER_ID)) {
    map.setFilter(
      STREET_SELECTED_LAYER_ID,
      ["==", ["get", "taskId"], selectedTaskId ?? "__none__"],
    );
  }
}

function syncOfflineMapData(map: Map, pkg: OfflineMapPackage | null, online: boolean) {
  const buildingSource = map.getSource(OFFLINE_BUILDING_SOURCE_ID) as GeoJSONSource | undefined;
  if (buildingSource) buildingSource.setData(offlineBuildingData(pkg));

  const roadSource = map.getSource(OFFLINE_ROAD_SOURCE_ID) as GeoJSONSource | undefined;
  if (roadSource) roadSource.setData(offlineRoadData(pkg));

  const mode = offlineMapRendererMode(online, pkg);
  if (map.getLayer(CARTO_BASEMAP_LAYER_ID)) {
    map.setLayoutProperty(CARTO_BASEMAP_LAYER_ID, "visibility", mode.cartoVisibility);
  }
  if (map.getLayer(OFFLINE_BUILDING_LAYER_ID)) {
    map.setLayoutProperty(OFFLINE_BUILDING_LAYER_ID, "visibility", mode.offlineVisibility);
  }
  if (map.getLayer(OFFLINE_ROAD_LAYER_ID)) {
    map.setLayoutProperty(OFFLINE_ROAD_LAYER_ID, "visibility", mode.offlineVisibility);
  }

  const region = map.getContainer().closest<HTMLElement>(".map-region");
  if (region) {
    region.dataset.offlineContext = mode.offlineVisibility === "visible" ? "active" : "inactive";
    region.dataset.offlineRoads = String(pkg?.roads.features.length ?? 0);
    region.dataset.offlineBuildings = String(pkg?.buildings.features.length ?? 0);
  }
}

function updateRendererDiagnostics(map: Map) {
  const region = map.getContainer().closest<HTMLElement>(".map-region");
  if (!region) return;
  try {
    const sourceAreas = map.querySourceFeatures(AREA_SOURCE_ID).filter(
      (feature) => typeof feature.properties?.areaId === "string",
    );
    const sourceStreets = map.querySourceFeatures(STREET_SOURCE_ID).filter(
      (feature) => typeof feature.properties?.taskId === "string",
    );
    const renderedAreas = map.queryRenderedFeatures(undefined, { layers: [AREA_FILL_LAYER_ID] });
    const streetLayers = STREET_LAYER_IDS.filter((layerId) => map.getLayer(layerId));
    const renderedStreets =
      streetLayers.length > 0
        ? map.queryRenderedFeatures(undefined, { layers: [...streetLayers] })
        : [];
    region.dataset.sourceAreas = String(new Set(sourceAreas.map((feature) => feature.properties?.areaId)).size);
    region.dataset.sourceStreets = String(
      new Set(sourceStreets.map((feature) => feature.properties?.taskId)).size,
    );
    region.dataset.renderedAreas = String(
      new Set(renderedAreas.map((feature) => feature.properties?.areaId)).size,
    );
    region.dataset.renderedStreets = String(
      new Set(renderedStreets.map((feature) => feature.properties?.taskId)).size,
    );
  } catch (cause) {
    console.warn("Map renderer diagnostics failed", cause);
  }
}

function ProjectedMarkers({
  map,
  coordinates,
  color,
  selectedIndex = null,
  radius = 8,
  markerRefs,
}: {
  map: Map | null;
  coordinates: LngLat[];
  color: string;
  selectedIndex?: number | null;
  radius?: number;
  markerRefs: React.MutableRefObject<globalThis.Map<number, SVGCircleElement>>;
}) {
  if (!map) return null;
  return coordinates.map((coordinate, index) => {
    const point = map.project(coordinate);
    const selected = selectedIndex === index;
    return (
      <circle
        key={`${coordinate[0]}:${coordinate[1]}:${index}`}
        ref={(node) => {
          if (node) markerRefs.current.set(index, node);
          else markerRefs.current.delete(index);
        }}
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
  const [error, setError] = useState<string | null>(null);
  const [offlineContextActive, setOfflineContextActive] = useState(false);

  const activePrimaryRef = useRef<SVGPolygonElement | SVGPolylineElement | null>(null);
  const activeHaloRef = useRef<SVGPolygonElement | SVGPolylineElement | null>(null);
  const activeMarkerRefs = useRef(new globalThis.Map<number, SVGCircleElement>());

  const dataRef = useRef({ areas, tasks, selectedTaskId });
  dataRef.current = { areas, tasks, selectedTaskId };

  const interactionRef = useRef({
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
  interactionRef.current = {
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

  const activeCoordinates = useMemo(() => {
    if (mode === "draw") return draftVertices;
    if (mode === "edit") return editingVertices;
    if (mode === "street-draw") return streetDraftVertices;
    return [];
  }, [mode, draftVertices, editingVertices, streetDraftVertices]);

  const updateActiveOverlay = (map: Map) => {
    const interaction = interactionRef.current;
    let coordinates: LngLat[] = [];
    if (interaction.mode === "draw") coordinates = interaction.draftVertices;
    else if (interaction.mode === "edit") coordinates = interaction.editingVertices;
    else if (interaction.mode === "street-draw") coordinates = interaction.streetDraftVertices;

    if (activePrimaryRef.current) {
      activePrimaryRef.current.setAttribute("points", projectedPoints(map, coordinates));
    }
    if (activeHaloRef.current) {
      activeHaloRef.current.setAttribute("points", projectedPoints(map, coordinates));
    }
    coordinates.forEach((coordinate, index) => {
      const marker = activeMarkerRefs.current.get(index);
      if (!marker) return;
      const point = map.project(coordinate);
      marker.setAttribute("cx", String(point.x));
      marker.setAttribute("cy", String(point.y));
    });
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let active = true;
    const initialCamera = loadPersonalMapView(campaignId) ?? campaignDefaultView ?? GERMANY_VIEW;
    const initialData = dataRef.current;

    try {
      const map = new Map({
        container: containerRef.current,
        style: buildMapStyle(initialData.areas, initialData.tasks, navigator.onLine),
        center: initialCamera.center,
        zoom: initialCamera.zoom,
        bearing: initialCamera.bearing,
        maxZoom: 20,
        renderWorldCopies: false,
        cancelPendingTileRequestsWhileZooming: false,
        validateStyle: import.meta.env.DEV,
      });
      mapRef.current = map;

      const refreshOfflineContext = async () => {
        try {
          const stored = await browserOfflineMapRepository.load(campaignId);
          if (!active) return;
          const pkg = stored?.package ?? null;
          const online = navigator.onLine;
          setOfflineContextActive(!online && Boolean(pkg));
          if (map.isStyleLoaded()) syncOfflineMapData(map, pkg, online);
        } catch (cause) {
          console.warn("Prepared offline map could not be loaded", cause);
          if (!active) return;
          setOfflineContextActive(false);
          if (map.isStyleLoaded()) syncOfflineMapData(map, null, navigator.onLine);
        }
      };

      const handleConnectivityChange = () => {
        void refreshOfflineContext();
      };
      const handleOfflineMapChanged = (event: Event) => {
        const detail = (event as CustomEvent<{ campaignId?: string }>).detail;
        if (detail?.campaignId && detail.campaignId !== campaignId) return;
        void refreshOfflineContext();
      };
      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") void refreshOfflineContext();
      };

      window.addEventListener("online", handleConnectivityChange);
      window.addEventListener("offline", handleConnectivityChange);
      window.addEventListener(OFFLINE_MAP_CHANGED_EVENT, handleOfflineMapChanged);
      document.addEventListener("visibilitychange", handleVisibilityChange);

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

      map.on("error", (event) => {
        console.error("MapLibre runtime error", event.error ?? event);
      });

      map.once("load", () => {
        if (!active) return;
        const current = dataRef.current;
        syncApplicationData(map, current.areas, current.tasks, current.selectedTaskId);
        void refreshOfflineContext();
        updateActiveOverlay(map);
        updateRendererDiagnostics(map);
      });

      map.on("idle", () => {
        if (active) updateRendererDiagnostics(map);
      });

      map.on("move", () => {
        if (interactionRef.current.mode !== "browse") updateActiveOverlay(map);
      });
      map.on("resize", () => {
        if (interactionRef.current.mode !== "browse") updateActiveOverlay(map);
      });
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

        const streetLayers = STREET_LAYER_IDS.filter((layerId) => map.getLayer(layerId));
        if (streetLayers.length > 0) {
          const bbox: [[number, number], [number, number]] = [
            [event.point.x - 9, event.point.y - 9],
            [event.point.x + 9, event.point.y + 9],
          ];
          const streetFeatures = map.queryRenderedFeatures(bbox, { layers: [...streetLayers] });
          const streetFeature = streetFeatures.find(
            (feature) => typeof feature.properties?.taskId === "string",
          );
          if (streetFeature && typeof streetFeature.properties?.taskId === "string") {
            interaction.onTaskSelect(streetFeature.properties.taskId);
            return;
          }
        }

        interaction.onTaskSelect(null);
        if (map.getLayer(AREA_FILL_LAYER_ID)) {
          const areaFeatures = map.queryRenderedFeatures(event.point, { layers: [AREA_FILL_LAYER_ID] });
          const areaFeature = areaFeatures.find(
            (feature) => typeof feature.properties?.areaId === "string",
          );
          interaction.onAreaSelect(
            areaFeature && typeof areaFeature.properties?.areaId === "string"
              ? areaFeature.properties.areaId
              : null,
          );
          return;
        }
        interaction.onAreaSelect(null);
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

      return () => {
        window.removeEventListener("online", handleConnectivityChange);
        window.removeEventListener("offline", handleConnectivityChange);
        window.removeEventListener(OFFLINE_MAP_CHANGED_EVENT, handleOfflineMapChanged);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
    } catch (cause) {
      console.error("Map initialization failed", cause);
      if (active) setError(t(language, "mapInitError"));
    }

    return () => {
      active = false;
      if (cameraSaveTimerRef.current !== null) window.clearTimeout(cameraSaveTimerRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [campaignId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncApplicationData(map, areas, tasks, selectedTaskId);
  }, [areas, tasks, selectedTaskId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mode === "browse") map.doubleClickZoom.enable();
    else map.doubleClickZoom.disable();
    updateActiveOverlay(map);
  }, [mode, activeCoordinates]);

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
    <section
      className={`map-region map-mode-${mode}`}
      aria-label={t(language, "map")}
      data-renderer="maplibre-geojson"
    >
      <div ref={containerRef} className="map" />

      {mode !== "browse" ? (
        <svg className="application-overlay active-geometry-overlay" aria-hidden="true">
          {mode === "draw" ? (
            <>
              {draftVertices.length >= 2 ? (
                draftVertices.length >= 3 ? (
                  <polygon
                    ref={activePrimaryRef as React.RefObject<SVGPolygonElement>}
                    points={map ? projectedPoints(map, draftVertices) : ""}
                    fill={draftColor}
                    fillOpacity={0.3}
                    stroke={draftColor}
                    strokeWidth={6}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <polyline
                    ref={activePrimaryRef as React.RefObject<SVGPolylineElement>}
                    points={map ? projectedPoints(map, draftVertices) : ""}
                    fill="none"
                    stroke={draftColor}
                    strokeWidth={6}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )
              ) : null}
              <ProjectedMarkers
                map={map}
                coordinates={draftVertices}
                color={draftColor}
                radius={9}
                markerRefs={activeMarkerRefs}
              />
            </>
          ) : null}

          {mode === "edit" ? (
            <>
              {editingVertices.length >= 3 ? (
                <>
                  <polygon
                    ref={activeHaloRef as React.RefObject<SVGPolygonElement>}
                    points={map ? projectedPoints(map, editingVertices) : ""}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={13}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polygon
                    ref={activePrimaryRef as React.RefObject<SVGPolygonElement>}
                    points={map ? projectedPoints(map, editingVertices) : ""}
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
                markerRefs={activeMarkerRefs}
              />
            </>
          ) : null}

          {mode === "street-draw" ? (
            <>
              {streetDraftVertices.length >= 2 ? (
                <>
                  <polyline
                    ref={activeHaloRef as React.RefObject<SVGPolylineElement>}
                    points={map ? projectedPoints(map, streetDraftVertices) : ""}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={11}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polyline
                    ref={activePrimaryRef as React.RefObject<SVGPolylineElement>}
                    points={map ? projectedPoints(map, streetDraftVertices) : ""}
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
                markerRefs={activeMarkerRefs}
              />
            </>
          ) : null}
        </svg>
      ) : null}

      {offlineContextActive ? (
        <div className="offline-map-context-badge" role="status">
          {t(language, "offlineMapArea")} · © OpenStreetMap contributors
        </div>
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
