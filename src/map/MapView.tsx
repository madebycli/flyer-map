import { useEffect, useRef, useState } from "react";
import {
  GeolocateControl,
  GeoJSONSource,
  Map,
  NavigationControl,
} from "maplibre-gl";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Polygon,
} from "geojson";
import type {
  Area,
  DistributionTask,
  LngLat,
  TaskStatus,
} from "../domain/campaign";
import "maplibre-gl/dist/maplibre-gl.css";

const CARTO_VOYAGER_RETINA_STYLE = {
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
} satisfies StyleSpecification;

const AREAS_SOURCE = "distribution-areas";
const SELECTED_AREA_SOURCE = "selected-distribution-area";
const AREAS_FILL_LAYER = "distribution-areas-fill";
const AREAS_LINE_LAYER = "distribution-areas-line";
const SELECTED_AREA_HALO_LAYER = "selected-distribution-area-halo";
const SELECTED_AREA_LINE_LAYER = "selected-distribution-area-line";

const TASKS_ALL_SOURCE = "distribution-street-tasks-all";
const TASKS_OPEN_SOURCE = "distribution-street-tasks-open-source";
const TASKS_COMPLETED_SOURCE = "distribution-street-tasks-completed-source";
const TASKS_LATER_SOURCE = "distribution-street-tasks-later-source";
const TASKS_NOT_DELIVERABLE_SOURCE = "distribution-street-tasks-not-deliverable-source";
const SELECTED_TASK_SOURCE = "selected-distribution-street-task";
const TASKS_CASING_LAYER = "distribution-street-tasks-casing";
const TASKS_OPEN_LAYER = "distribution-street-tasks-open";
const TASKS_COMPLETED_LAYER = "distribution-street-tasks-completed";
const TASKS_LATER_LAYER = "distribution-street-tasks-later";
const TASKS_NOT_DELIVERABLE_LAYER = "distribution-street-tasks-not-deliverable";
const SELECTED_TASK_HALO_LAYER = "selected-distribution-street-task-halo";
const SELECTED_TASK_LINE_LAYER = "selected-distribution-street-task-line";
const TASK_CLICK_LAYERS = [
  TASKS_OPEN_LAYER,
  TASKS_COMPLETED_LAYER,
  TASKS_LATER_LAYER,
  TASKS_NOT_DELIVERABLE_LAYER,
];

const DRAFT_SHAPE_SOURCE = "draft-area-shape";
const DRAFT_POINTS_SOURCE = "draft-area-points";
const EDIT_SHAPE_SOURCE = "edit-area-shape";
const EDIT_POINTS_SOURCE = "edit-area-points";
const EDIT_POINTS_LAYER = "edit-area-points-layer";
const STREET_DRAFT_SOURCE = "draft-street-shape";
const STREET_DRAFT_POINTS_SOURCE = "draft-street-points";

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

const emptyCollection = (): FeatureCollection => ({
  type: "FeatureCollection",
  features: [],
});

function areaFeatures(areas: RenderArea[]): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: areas.map((area) => ({
      type: "Feature",
      properties: { id: area.id, color: area.color },
      geometry: area.geometry,
    })),
  };
}

function selectedAreaFeatures(
  areas: RenderArea[],
  selectedAreaId: string | null,
): FeatureCollection<Polygon> {
  const area = areas.find((candidate) => candidate.id === selectedAreaId);
  return {
    type: "FeatureCollection",
    features: area
      ? [
          {
            type: "Feature",
            properties: { id: area.id, color: area.color },
            geometry: area.geometry,
          },
        ]
      : [],
  };
}

function taskFeatures(tasks: RenderTask[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: tasks.map((task) => ({
      type: "Feature",
      properties: { id: task.id, color: task.color },
      geometry: task.geometry,
    })),
  };
}

function taskFeaturesForStatus(
  tasks: RenderTask[],
  status: TaskStatus,
): FeatureCollection<LineString> {
  return taskFeatures(tasks.filter((task) => task.status === status));
}

function selectedTaskFeatures(
  tasks: RenderTask[],
  selectedTaskId: string | null,
): FeatureCollection<LineString> {
  const task = tasks.find((candidate) => candidate.id === selectedTaskId);
  return taskFeatures(task ? [task] : []);
}

function shapeFeature(
  vertices: LngLat[],
  color: string,
): FeatureCollection<Polygon | LineString> {
  if (vertices.length < 2) return emptyCollection();

  if (vertices.length === 2) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { color },
          geometry: { type: "LineString", coordinates: vertices },
        },
      ],
    };
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { color },
        geometry: {
          type: "Polygon",
          coordinates: [[...vertices, vertices[0]]],
        },
      },
    ],
  };
}

function streetDraftFeature(
  vertices: LngLat[],
  color: string,
): FeatureCollection<LineString> {
  if (vertices.length < 2) return emptyCollection();
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { color },
        geometry: { type: "LineString", coordinates: vertices },
      },
    ],
  };
}

function pointFeatures(
  vertices: LngLat[],
  color: string,
  selectedIndex: number | null = null,
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: vertices.map<Feature<Point>>((coordinates, index) => ({
      type: "Feature",
      properties: { index, color, selected: index === selectedIndex },
      geometry: { type: "Point", coordinates },
    })),
  };
}

function addGeoJsonSourceSafely(map: Map, sourceId: string) {
  if (map.getSource(sourceId)) return;
  try {
    map.addSource(sourceId, { type: "geojson", data: emptyCollection() });
  } catch (error) {
    console.error(`Map source failed: ${sourceId}`, error);
  }
}

function addLayerSafely(map: Map, layer: LayerSpecification) {
  if (map.getLayer(layer.id)) return;
  try {
    map.addLayer(layer);
  } catch (error) {
    console.error(`Map layer failed: ${layer.id}`, error);
  }
}

function setSourceData(map: Map, sourceId: string, data: FeatureCollection) {
  try {
    const source = map.getSource(sourceId) as GeoJSONSource | undefined;
    source?.setData(data);
  } catch (error) {
    console.error(`Map source update failed: ${sourceId}`, error);
  }
}

function addApplicationLayers(map: Map) {
  [
    AREAS_SOURCE,
    SELECTED_AREA_SOURCE,
    TASKS_ALL_SOURCE,
    TASKS_OPEN_SOURCE,
    TASKS_COMPLETED_SOURCE,
    TASKS_LATER_SOURCE,
    TASKS_NOT_DELIVERABLE_SOURCE,
    SELECTED_TASK_SOURCE,
    DRAFT_SHAPE_SOURCE,
    DRAFT_POINTS_SOURCE,
    EDIT_SHAPE_SOURCE,
    EDIT_POINTS_SOURCE,
    STREET_DRAFT_SOURCE,
    STREET_DRAFT_POINTS_SOURCE,
  ].forEach((sourceId) => addGeoJsonSourceSafely(map, sourceId));

  addLayerSafely(map, {
    id: AREAS_FILL_LAYER,
    type: "fill",
    source: AREAS_SOURCE,
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.24 },
  });
  addLayerSafely(map, {
    id: AREAS_LINE_LAYER,
    type: "line",
    source: AREAS_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 3.5,
      "line-opacity": 1,
    },
  });
  addLayerSafely(map, {
    id: SELECTED_AREA_HALO_LAYER,
    type: "line",
    source: SELECTED_AREA_SOURCE,
    paint: { "line-color": "#ffffff", "line-width": 11, "line-opacity": 1 },
  });
  addLayerSafely(map, {
    id: SELECTED_AREA_LINE_LAYER,
    type: "line",
    source: SELECTED_AREA_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 6,
      "line-opacity": 1,
    },
  });

  addLayerSafely(map, {
    id: TASKS_CASING_LAYER,
    type: "line",
    source: TASKS_ALL_SOURCE,
    paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.96 },
  });
  addLayerSafely(map, {
    id: TASKS_OPEN_LAYER,
    type: "line",
    source: TASKS_OPEN_SOURCE,
    paint: { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 1 },
  });
  addLayerSafely(map, {
    id: TASKS_COMPLETED_LAYER,
    type: "line",
    source: TASKS_COMPLETED_SOURCE,
    paint: { "line-color": ["get", "color"], "line-width": 3.5, "line-opacity": 0.45 },
  });
  addLayerSafely(map, {
    id: TASKS_LATER_LAYER,
    type: "line",
    source: TASKS_LATER_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 5.5,
      "line-opacity": 0.85,
      "line-dasharray": [2, 1.4],
    },
  });
  addLayerSafely(map, {
    id: TASKS_NOT_DELIVERABLE_LAYER,
    type: "line",
    source: TASKS_NOT_DELIVERABLE_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 5,
      "line-opacity": 0.76,
      "line-dasharray": [0.5, 1.2],
    },
  });
  addLayerSafely(map, {
    id: SELECTED_TASK_HALO_LAYER,
    type: "line",
    source: SELECTED_TASK_SOURCE,
    paint: { "line-color": "#172019", "line-width": 13, "line-opacity": 0.9 },
  });
  addLayerSafely(map, {
    id: SELECTED_TASK_LINE_LAYER,
    type: "line",
    source: SELECTED_TASK_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 7,
      "line-opacity": 1,
    },
  });

  addLayerSafely(map, {
    id: "draft-area-fill",
    type: "fill",
    source: DRAFT_SHAPE_SOURCE,
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.3 },
  });
  addLayerSafely(map, {
    id: "draft-area-line",
    type: "line",
    source: DRAFT_SHAPE_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 5,
      "line-opacity": 1,
    },
  });
  addLayerSafely(map, {
    id: "draft-area-points-layer",
    type: "circle",
    source: DRAFT_POINTS_SOURCE,
    paint: {
      "circle-radius": 8,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
    },
  });

  addLayerSafely(map, {
    id: "edit-area-fill",
    type: "fill",
    source: EDIT_SHAPE_SOURCE,
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.34 },
  });
  addLayerSafely(map, {
    id: "edit-area-line",
    type: "line",
    source: EDIT_SHAPE_SOURCE,
    paint: { "line-color": ["get", "color"], "line-width": 5 },
  });
  addLayerSafely(map, {
    id: EDIT_POINTS_LAYER,
    type: "circle",
    source: EDIT_POINTS_SOURCE,
    paint: {
      "circle-radius": ["case", ["boolean", ["get", "selected"], false], 15, 12],
      "circle-color": [
        "case",
        ["boolean", ["get", "selected"], false],
        "#ffffff",
        ["get", "color"],
      ],
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": 4,
    },
  });

  addLayerSafely(map, {
    id: "draft-street-casing",
    type: "line",
    source: STREET_DRAFT_SOURCE,
    paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 1 },
  });
  addLayerSafely(map, {
    id: "draft-street-line",
    type: "line",
    source: STREET_DRAFT_SOURCE,
    paint: { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 1 },
  });
  addLayerSafely(map, {
    id: "draft-street-points-layer",
    type: "circle",
    source: STREET_DRAFT_POINTS_SOURCE,
    paint: {
      "circle-radius": 8,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
    },
  });
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
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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
        style: CARTO_VOYAGER_RETINA_STYLE,
        center: [10.45, 51.16],
        zoom: 5.3,
        maxZoom: 20,
        renderWorldCopies: false,
        cancelPendingTileRequestsWhileZooming: false,
        validateStyle: import.meta.env.DEV,
      });

      map.once("load", () => {
        if (!active) return;
        addApplicationLayers(map);
        setReady(true);
      });

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
          const editLayerExists = Boolean(map.getLayer(EDIT_POINTS_LAYER));
          const vertex = editLayerExists
            ? map.queryRenderedFeatures(event.point, { layers: [EDIT_POINTS_LAYER] })[0]
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
            [event.point.x - 10, event.point.y - 10],
            [event.point.x + 10, event.point.y + 10],
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

      mapRef.current = map;
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
    if (!map || !ready) return;
    setSourceData(map, AREAS_SOURCE, areaFeatures(areas));
    setSourceData(map, SELECTED_AREA_SOURCE, selectedAreaFeatures(areas, selectedAreaId));
  }, [areas, selectedAreaId, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSourceData(map, TASKS_ALL_SOURCE, taskFeatures(tasks));
    setSourceData(map, TASKS_OPEN_SOURCE, taskFeaturesForStatus(tasks, "open"));
    setSourceData(map, TASKS_COMPLETED_SOURCE, taskFeaturesForStatus(tasks, "completed"));
    setSourceData(map, TASKS_LATER_SOURCE, taskFeaturesForStatus(tasks, "later"));
    setSourceData(
      map,
      TASKS_NOT_DELIVERABLE_SOURCE,
      taskFeaturesForStatus(tasks, "not-deliverable"),
    );
    setSourceData(map, SELECTED_TASK_SOURCE, selectedTaskFeatures(tasks, selectedTaskId));
  }, [tasks, selectedTaskId, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSourceData(map, DRAFT_SHAPE_SOURCE, shapeFeature(draftVertices, draftColor));
    setSourceData(map, DRAFT_POINTS_SOURCE, pointFeatures(draftVertices, draftColor));
  }, [draftVertices, draftColor, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSourceData(map, EDIT_SHAPE_SOURCE, shapeFeature(editingVertices, editingColor));
    setSourceData(
      map,
      EDIT_POINTS_SOURCE,
      pointFeatures(editingVertices, editingColor, selectedVertexIndex),
    );
  }, [editingVertices, editingColor, selectedVertexIndex, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSourceData(
      map,
      STREET_DRAFT_SOURCE,
      streetDraftFeature(streetDraftVertices, streetDraftColor),
    );
    setSourceData(
      map,
      STREET_DRAFT_POINTS_SOURCE,
      pointFeatures(streetDraftVertices, streetDraftColor),
    );
  }, [streetDraftVertices, streetDraftColor, ready]);

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
