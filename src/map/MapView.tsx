import { useEffect, useRef, useState } from "react";
import {
  GeolocateControl,
  GeoJSONSource,
  Map,
  NavigationControl,
} from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Polygon,
} from "geojson";
import type { Area, DistributionTask, LngLat } from "../domain/campaign";
import "maplibre-gl/dist/maplibre-gl.css";

const AREAS_SOURCE = "distribution-areas";
const TASKS_SOURCE = "distribution-street-tasks";
const DRAFT_SOURCE = "distribution-draft";

const AREAS_FILL_LAYER = "distribution-areas-fill";
const AREAS_LINE_LAYER = "distribution-areas-line";
const AREAS_SELECTED_HALO_LAYER = "distribution-areas-selected-halo";
const AREAS_SELECTED_LINE_LAYER = "distribution-areas-selected-line";

const TASKS_CASING_LAYER = "distribution-street-tasks-casing";
const TASKS_OPEN_LAYER = "distribution-street-tasks-open";
const TASKS_COMPLETED_LAYER = "distribution-street-tasks-completed";
const TASKS_LATER_LAYER = "distribution-street-tasks-later";
const TASKS_NOT_DELIVERABLE_LAYER = "distribution-street-tasks-not-deliverable";
const TASKS_SELECTED_HALO_LAYER = "distribution-street-tasks-selected-halo";
const TASKS_SELECTED_LINE_LAYER = "distribution-street-tasks-selected-line";
const TASK_CLICK_LAYERS = [
  TASKS_OPEN_LAYER,
  TASKS_COMPLETED_LAYER,
  TASKS_LATER_LAYER,
  TASKS_NOT_DELIVERABLE_LAYER,
];

const DRAFT_EDIT_POINTS_LAYER = "distribution-draft-edit-points";

type MapMode = "browse" | "draw" | "edit" | "street-draw";

type RenderArea = Area & { color: string };
type RenderTask = DistributionTask & { color: string };

type MapViewProps = {
  areas: RenderArea[];
  tasks: RenderTask[];
  selectedAreaId: string | null;
  selectedTaskId: string | null;
  mode: MapMode;
  draftVertices: LngLat[];
  draftColor: string;
  editingVertices: LngLat[];
  editingColor: string;
  selectedVertexIndex: number | null;
  streetDraftVertices: LngLat[];
  streetDraftColor: string;
  onAreaSelect: (areaId: string | null) => void;
  onTaskSelect: (taskId: string | null) => void;
  onDrawPoint: (point: LngLat) => void;
  onEditVertexSelect: (index: number) => void;
  onEditVertexMove: (index: number, point: LngLat) => void;
  onStreetDrawPoint: (point: LngLat) => void;
};

type RenderState = Pick<
  MapViewProps,
  | "areas"
  | "tasks"
  | "selectedAreaId"
  | "selectedTaskId"
  | "mode"
  | "draftVertices"
  | "draftColor"
  | "editingVertices"
  | "editingColor"
  | "selectedVertexIndex"
  | "streetDraftVertices"
  | "streetDraftColor"
>;

type DraftGeometry = Polygon | LineString | Point;

const emptyCollection = (): FeatureCollection => ({
  type: "FeatureCollection",
  features: [],
});

function areaFeatures(
  areas: RenderArea[],
  selectedAreaId: string | null,
): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: areas.map((area) => ({
      type: "Feature",
      properties: {
        id: area.id,
        color: area.color,
        selected: area.id === selectedAreaId,
      },
      geometry: area.geometry,
    })),
  };
}

function taskFeatures(
  tasks: RenderTask[],
  selectedTaskId: string | null,
): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: tasks.map((task) => ({
      type: "Feature",
      properties: {
        id: task.id,
        color: task.color,
        status: task.status,
        selected: task.id === selectedTaskId,
      },
      geometry: task.geometry,
    })),
  };
}

function shapeFeature(
  vertices: LngLat[],
  color: string,
  kind: "area-draft" | "area-edit",
): Feature<Polygon | LineString> | null {
  if (vertices.length < 2) return null;

  return {
    type: "Feature",
    properties: { color, kind },
    geometry:
      vertices.length === 2
        ? { type: "LineString", coordinates: vertices }
        : { type: "Polygon", coordinates: [[...vertices, vertices[0]]] },
  };
}

function pointFeatures(
  vertices: LngLat[],
  color: string,
  kind: "area-point" | "edit-point" | "street-point",
  selectedIndex: number | null = null,
): Feature<Point>[] {
  return vertices.map((coordinates, index) => ({
    type: "Feature",
    properties: {
      index,
      color,
      kind,
      selected: index === selectedIndex,
    },
    geometry: { type: "Point", coordinates },
  }));
}

function draftFeatures(state: RenderState): FeatureCollection<DraftGeometry> {
  const features: Feature<DraftGeometry>[] = [];

  if (state.mode === "draw") {
    const shape = shapeFeature(state.draftVertices, state.draftColor, "area-draft");
    if (shape) features.push(shape);
    features.push(...pointFeatures(state.draftVertices, state.draftColor, "area-point"));
  }

  if (state.mode === "edit") {
    const shape = shapeFeature(state.editingVertices, state.editingColor, "area-edit");
    if (shape) features.push(shape);
    features.push(
      ...pointFeatures(
        state.editingVertices,
        state.editingColor,
        "edit-point",
        state.selectedVertexIndex,
      ),
    );
  }

  if (state.mode === "street-draw") {
    if (state.streetDraftVertices.length >= 2) {
      features.push({
        type: "Feature",
        properties: { color: state.streetDraftColor, kind: "street-draft" },
        geometry: {
          type: "LineString",
          coordinates: state.streetDraftVertices,
        },
      });
    }
    features.push(
      ...pointFeatures(state.streetDraftVertices, state.streetDraftColor, "street-point"),
    );
  }

  return { type: "FeatureCollection", features };
}

function buildMapStyle(state: RenderState): StyleSpecification {
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
      [AREAS_SOURCE]: {
        type: "geojson",
        data: areaFeatures(state.areas, state.selectedAreaId),
      },
      [TASKS_SOURCE]: {
        type: "geojson",
        data: taskFeatures(state.tasks, state.selectedTaskId),
      },
      [DRAFT_SOURCE]: {
        type: "geojson",
        data: draftFeatures(state),
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
      {
        id: AREAS_FILL_LAYER,
        type: "fill",
        source: AREAS_SOURCE,
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.28,
        },
      },
      {
        id: AREAS_LINE_LAYER,
        type: "line",
        source: AREAS_SOURCE,
        paint: {
          "line-color": ["get", "color"],
          "line-width": 4,
          "line-opacity": 1,
        },
      },
      {
        id: AREAS_SELECTED_HALO_LAYER,
        type: "line",
        source: AREAS_SOURCE,
        filter: ["==", ["get", "selected"], true],
        paint: {
          "line-color": "#ffffff",
          "line-width": 12,
          "line-opacity": 1,
        },
      },
      {
        id: AREAS_SELECTED_LINE_LAYER,
        type: "line",
        source: AREAS_SOURCE,
        filter: ["==", ["get", "selected"], true],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 7,
          "line-opacity": 1,
        },
      },
      {
        id: TASKS_CASING_LAYER,
        type: "line",
        source: TASKS_SOURCE,
        paint: {
          "line-color": "#ffffff",
          "line-width": 10,
          "line-opacity": 0.98,
        },
      },
      {
        id: TASKS_OPEN_LAYER,
        type: "line",
        source: TASKS_SOURCE,
        filter: ["==", ["get", "status"], "open"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 6,
          "line-opacity": 1,
        },
      },
      {
        id: TASKS_COMPLETED_LAYER,
        type: "line",
        source: TASKS_SOURCE,
        filter: ["==", ["get", "status"], "completed"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 4,
          "line-opacity": 0.48,
        },
      },
      {
        id: TASKS_LATER_LAYER,
        type: "line",
        source: TASKS_SOURCE,
        filter: ["==", ["get", "status"], "later"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 6,
          "line-opacity": 0.88,
          "line-dasharray": [2, 1.4],
        },
      },
      {
        id: TASKS_NOT_DELIVERABLE_LAYER,
        type: "line",
        source: TASKS_SOURCE,
        filter: ["==", ["get", "status"], "not-deliverable"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 5.5,
          "line-opacity": 0.8,
          "line-dasharray": [0.5, 1.2],
        },
      },
      {
        id: TASKS_SELECTED_HALO_LAYER,
        type: "line",
        source: TASKS_SOURCE,
        filter: ["==", ["get", "selected"], true],
        paint: {
          "line-color": "#172019",
          "line-width": 14,
          "line-opacity": 0.92,
        },
      },
      {
        id: TASKS_SELECTED_LINE_LAYER,
        type: "line",
        source: TASKS_SOURCE,
        filter: ["==", ["get", "selected"], true],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 7,
          "line-opacity": 1,
        },
      },
      {
        id: "distribution-draft-area-fill",
        type: "fill",
        source: DRAFT_SOURCE,
        filter: ["==", ["get", "kind"], "area-draft"],
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.34,
        },
      },
      {
        id: "distribution-draft-area-line",
        type: "line",
        source: DRAFT_SOURCE,
        filter: ["==", ["get", "kind"], "area-draft"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 6,
          "line-opacity": 1,
        },
      },
      {
        id: "distribution-draft-area-points",
        type: "circle",
        source: DRAFT_SOURCE,
        filter: ["==", ["get", "kind"], "area-point"],
        paint: {
          "circle-radius": 9,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 4,
        },
      },
      {
        id: "distribution-draft-edit-fill",
        type: "fill",
        source: DRAFT_SOURCE,
        filter: ["==", ["get", "kind"], "area-edit"],
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.36,
        },
      },
      {
        id: "distribution-draft-edit-line",
        type: "line",
        source: DRAFT_SOURCE,
        filter: ["==", ["get", "kind"], "area-edit"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 6,
          "line-opacity": 1,
        },
      },
      {
        id: DRAFT_EDIT_POINTS_LAYER,
        type: "circle",
        source: DRAFT_SOURCE,
        filter: ["==", ["get", "kind"], "edit-point"],
        paint: {
          "circle-radius": ["case", ["boolean", ["get", "selected"], false], 16, 13],
          "circle-color": [
            "case",
            ["boolean", ["get", "selected"], false],
            "#ffffff",
            ["get", "color"],
          ],
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": 4,
        },
      },
      {
        id: "distribution-draft-street-casing",
        type: "line",
        source: DRAFT_SOURCE,
        filter: ["==", ["get", "kind"], "street-draft"],
        paint: {
          "line-color": "#ffffff",
          "line-width": 11,
          "line-opacity": 1,
        },
      },
      {
        id: "distribution-draft-street-line",
        type: "line",
        source: DRAFT_SOURCE,
        filter: ["==", ["get", "kind"], "street-draft"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 7,
          "line-opacity": 1,
        },
      },
      {
        id: "distribution-draft-street-points",
        type: "circle",
        source: DRAFT_SOURCE,
        filter: ["==", ["get", "kind"], "street-point"],
        paint: {
          "circle-radius": 9,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 4,
        },
      },
    ],
  };
}

function setSourceData(map: Map, sourceId: string, data: FeatureCollection) {
  try {
    const source = map.getSource(sourceId) as GeoJSONSource | undefined;
    source?.setData(data);
  } catch (cause) {
    console.error(`Map source update failed: ${sourceId}`, cause);
  }
}

function syncOverlaySources(map: Map, state: RenderState) {
  setSourceData(map, AREAS_SOURCE, areaFeatures(state.areas, state.selectedAreaId));
  setSourceData(map, TASKS_SOURCE, taskFeatures(state.tasks, state.selectedTaskId));
  setSourceData(map, DRAFT_SOURCE, draftFeatures(state));
}

export function MapView({
  areas,
  tasks,
  selectedAreaId,
  selectedTaskId,
  mode,
  draftVertices,
  draftColor,
  editingVertices,
  editingColor,
  selectedVertexIndex,
  streetDraftVertices,
  streetDraftColor,
  onAreaSelect,
  onTaskSelect,
  onDrawPoint,
  onEditVertexSelect,
  onEditVertexMove,
  onStreetDrawPoint,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [error, setError] = useState<string | null>(null);

  const renderRef = useRef<RenderState>({
    areas,
    tasks,
    selectedAreaId,
    selectedTaskId,
    mode,
    draftVertices,
    draftColor,
    editingVertices,
    editingColor,
    selectedVertexIndex,
    streetDraftVertices,
    streetDraftColor,
  });

  const interactionRef = useRef({
    mode,
    selectedVertexIndex,
    onAreaSelect,
    onTaskSelect,
    onDrawPoint,
    onEditVertexSelect,
    onEditVertexMove,
    onStreetDrawPoint,
  });

  useEffect(() => {
    renderRef.current = {
      areas,
      tasks,
      selectedAreaId,
      selectedTaskId,
      mode,
      draftVertices,
      draftColor,
      editingVertices,
      editingColor,
      selectedVertexIndex,
      streetDraftVertices,
      streetDraftColor,
    };

    const map = mapRef.current;
    if (map) syncOverlaySources(map, renderRef.current);
  }, [
    areas,
    tasks,
    selectedAreaId,
    selectedTaskId,
    mode,
    draftVertices,
    draftColor,
    editingVertices,
    editingColor,
    selectedVertexIndex,
    streetDraftVertices,
    streetDraftColor,
  ]);

  useEffect(() => {
    interactionRef.current = {
      mode,
      selectedVertexIndex,
      onAreaSelect,
      onTaskSelect,
      onDrawPoint,
      onEditVertexSelect,
      onEditVertexMove,
      onStreetDrawPoint,
    };
  }, [
    mode,
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

    try {
      const map = new Map({
        container: containerRef.current,
        style: buildMapStyle(renderRef.current),
        center: [10.45, 51.16],
        zoom: 5.3,
        maxZoom: 20,
        renderWorldCopies: false,
        cancelPendingTileRequestsWhileZooming: false,
        validateStyle: import.meta.env.DEV,
      });

      mapRef.current = map;

      const syncLatest = () => {
        if (active) syncOverlaySources(map, renderRef.current);
      };

      map.on("styledata", syncLatest);
      map.on("load", syncLatest);

      map.on("click", (event) => {
        const interaction = interactionRef.current;
        const point: LngLat = [event.lngLat.lng, event.lngLat.lat];

        if (interaction.mode === "draw") {
          interaction.onDrawPoint(point);
          return;
        }

        if (interaction.mode === "street-draw") {
          interaction.onStreetDrawPoint(point);
          return;
        }

        if (interaction.mode === "edit") {
          const vertex = map.getLayer(DRAFT_EDIT_POINTS_LAYER)
            ? map.queryRenderedFeatures(event.point, { layers: [DRAFT_EDIT_POINTS_LAYER] })[0]
            : undefined;
          const vertexIndex = Number(vertex?.properties?.index);

          if (Number.isInteger(vertexIndex) && vertexIndex >= 0) {
            interaction.onEditVertexSelect(vertexIndex);
            return;
          }

          if (interaction.selectedVertexIndex !== null) {
            interaction.onEditVertexMove(interaction.selectedVertexIndex, point);
          }
          return;
        }

        const taskLayers = TASK_CLICK_LAYERS.filter((layerId) => map.getLayer(layerId));
        if (taskLayers.length > 0) {
          const hitBox: [[number, number], [number, number]] = [
            [event.point.x - 12, event.point.y - 12],
            [event.point.x + 12, event.point.y + 12],
          ];
          const task = map.queryRenderedFeatures(hitBox, { layers: taskLayers })[0];
          const taskId = task?.properties?.id;
          if (typeof taskId === "string") {
            interaction.onTaskSelect(taskId);
            return;
          }
        }

        interaction.onTaskSelect(null);

        if (!map.getLayer(AREAS_FILL_LAYER)) {
          interaction.onAreaSelect(null);
          return;
        }

        const area = map.queryRenderedFeatures(event.point, { layers: [AREAS_FILL_LAYER] })[0];
        const areaId = area?.properties?.id;
        interaction.onAreaSelect(typeof areaId === "string" ? areaId : null);
      });

      map.addControl(new NavigationControl({ showCompass: false }), "top-right");
      map.addControl(
        new GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: false,
          showUserLocation: true,
          showAccuracyCircle: true,
        }),
        "top-right",
      );
    } catch (cause) {
      console.error("Map initialization failed", cause);
      if (active) setError("Karte konnte nicht initialisiert werden.");
    }

    return () => {
      active = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mode === "browse") map.doubleClickZoom.enable();
    else map.doubleClickZoom.disable();
  }, [mode]);

  return (
    <section className={`map-region map-mode-${mode}`} aria-label="Verteilkarte">
      <div ref={containerRef} className="map" />
      {error ? <div className="map-error">{error}</div> : null}
    </section>
  );
}
