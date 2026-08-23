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
      paint: {
        "background-color": "#fbf8f3",
      },
    },
    {
      id: "carto-basemap",
      type: "raster",
      source: "carto",
      minzoom: 0,
      maxzoom: 20,
      paint: {
        "raster-fade-duration": 0,
      },
    },
  ],
} satisfies StyleSpecification;

const AREAS_SOURCE = "distribution-areas";
const AREAS_FILL_LAYER = "distribution-areas-fill";
const AREAS_LINE_LAYER = "distribution-areas-line";
const AREAS_SELECTED_HALO_LAYER = "distribution-areas-selected-halo";
const AREAS_SELECTED_LINE_LAYER = "distribution-areas-selected-line";
const TASKS_SOURCE = "distribution-street-tasks";
const TASKS_SELECTED_HALO_LAYER = "distribution-street-tasks-selected-halo";
const TASKS_CASING_LAYER = "distribution-street-tasks-casing";
const TASKS_OPEN_LAYER = "distribution-street-tasks-open";
const TASKS_COMPLETED_LAYER = "distribution-street-tasks-completed";
const TASKS_LATER_LAYER = "distribution-street-tasks-later";
const TASKS_NOT_DELIVERABLE_LAYER = "distribution-street-tasks-not-deliverable";
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

type RenderArea = Area & {
  color: string;
};

type RenderTask = DistributionTask & {
  color: string;
};

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

function areaFeatures(areas: RenderArea[], selectedAreaId: string | null): FeatureCollection<Polygon> {
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

function taskFeatures(tasks: RenderTask[], selectedTaskId: string | null): FeatureCollection<LineString> {
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

function shapeFeature(vertices: LngLat[], color: string): FeatureCollection<Polygon | LineString> {
  if (vertices.length < 2) return { type: "FeatureCollection", features: [] };

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

function streetDraftFeature(vertices: LngLat[], color: string): FeatureCollection<LineString> {
  if (vertices.length < 2) return { type: "FeatureCollection", features: [] };

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
      properties: {
        index,
        color,
        selected: index === selectedIndex,
      },
      geometry: { type: "Point", coordinates },
    })),
  };
}

function setSourceData(map: Map, sourceId: string, data: FeatureCollection) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  source?.setData(data);
}

function addTaskStatusLayer(
  map: Map,
  id: string,
  status: DistributionTask["status"],
  options: { width: number; opacity: number; dash?: number[] },
) {
  map.addLayer({
    id,
    type: "line",
    source: TASKS_SOURCE,
    filter: ["==", ["get", "status"], status],
    paint: {
      "line-color": ["get", "color"],
      "line-width": options.width,
      "line-opacity": options.opacity,
      ...(options.dash ? { "line-dasharray": options.dash } : {}),
    },
  });
}

function addApplicationLayers(map: Map) {
  map.addSource(AREAS_SOURCE, { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: AREAS_FILL_LAYER,
    type: "fill",
    source: AREAS_SOURCE,
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": ["case", ["boolean", ["get", "selected"], false], 0.34, 0.2],
    },
  });
  map.addLayer({
    id: AREAS_LINE_LAYER,
    type: "line",
    source: AREAS_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 2.5,
      "line-opacity": 0.95,
    },
  });
  map.addLayer({
    id: AREAS_SELECTED_HALO_LAYER,
    type: "line",
    source: AREAS_SOURCE,
    filter: ["==", ["get", "selected"], true],
    paint: {
      "line-color": "#ffffff",
      "line-width": 9,
      "line-opacity": 0.96,
    },
  });
  map.addLayer({
    id: AREAS_SELECTED_LINE_LAYER,
    type: "line",
    source: AREAS_SOURCE,
    filter: ["==", ["get", "selected"], true],
    paint: {
      "line-color": ["get", "color"],
      "line-width": 5,
      "line-opacity": 1,
    },
  });

  map.addSource(TASKS_SOURCE, { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: TASKS_SELECTED_HALO_LAYER,
    type: "line",
    source: TASKS_SOURCE,
    filter: ["==", ["get", "selected"], true],
    paint: {
      "line-color": "#172019",
      "line-width": 12,
      "line-opacity": 0.9,
    },
  });
  map.addLayer({
    id: TASKS_CASING_LAYER,
    type: "line",
    source: TASKS_SOURCE,
    paint: {
      "line-color": "#ffffff",
      "line-width": 8,
      "line-opacity": [
        "match",
        ["get", "status"],
        "completed",
        0.58,
        "not-deliverable",
        0.75,
        0.94,
      ],
    },
  });
  addTaskStatusLayer(map, TASKS_OPEN_LAYER, "open", { width: 5.5, opacity: 1 });
  addTaskStatusLayer(map, TASKS_COMPLETED_LAYER, "completed", { width: 3.5, opacity: 0.48 });
  addTaskStatusLayer(map, TASKS_LATER_LAYER, "later", {
    width: 5,
    opacity: 0.82,
    dash: [2, 1.4],
  });
  addTaskStatusLayer(map, TASKS_NOT_DELIVERABLE_LAYER, "not-deliverable", {
    width: 4.5,
    opacity: 0.7,
    dash: [0.45, 1.25],
  });

  map.addSource(DRAFT_SHAPE_SOURCE, { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: "draft-area-fill",
    type: "fill",
    source: DRAFT_SHAPE_SOURCE,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.3,
    },
  });
  map.addLayer({
    id: "draft-area-line",
    type: "line",
    source: DRAFT_SHAPE_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 4,
      "line-dasharray": [1.5, 1.2],
    },
  });
  map.addSource(DRAFT_POINTS_SOURCE, { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: "draft-area-points-layer",
    type: "circle",
    source: DRAFT_POINTS_SOURCE,
    paint: {
      "circle-radius": 7,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
    },
  });

  map.addSource(EDIT_SHAPE_SOURCE, { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: "edit-area-fill",
    type: "fill",
    source: EDIT_SHAPE_SOURCE,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.36,
    },
  });
  map.addLayer({
    id: "edit-area-line",
    type: "line",
    source: EDIT_SHAPE_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 4.5,
    },
  });
  map.addSource(EDIT_POINTS_SOURCE, { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: EDIT_POINTS_LAYER,
    type: "circle",
    source: EDIT_POINTS_SOURCE,
    paint: {
      "circle-radius": ["case", ["boolean", ["get", "selected"], false], 15, 12],
      "circle-color": ["case", ["boolean", ["get", "selected"], false], "#ffffff", ["get", "color"]],
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": ["case", ["boolean", ["get", "selected"], false], 5, 4],
    },
  });

  map.addSource(STREET_DRAFT_SOURCE, { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: "draft-street-casing",
    type: "line",
    source: STREET_DRAFT_SOURCE,
    paint: {
      "line-color": "#ffffff",
      "line-width": 9,
      "line-opacity": 0.96,
    },
  });
  map.addLayer({
    id: "draft-street-line",
    type: "line",
    source: STREET_DRAFT_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 5.5,
      "line-dasharray": [1.4, 1],
    },
  });
  map.addSource(STREET_DRAFT_POINTS_SOURCE, { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: "draft-street-points-layer",
    type: "circle",
    source: STREET_DRAFT_POINTS_SOURCE,
    paint: {
      "circle-radius": 7,
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
  const [loading, setLoading] = useState(true);
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

      map.on("load", () => {
        if (!active) return;
        addApplicationLayers(map);
        setReady(true);
      });

      map.once("idle", () => {
        if (active) setLoading(false);
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
          const vertex = map.queryRenderedFeatures(event.point, {
            layers: [EDIT_POINTS_LAYER],
          })[0];
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

        const task = map.queryRenderedFeatures(event.point, {
          layers: TASK_CLICK_LAYERS,
        })[0];
        const taskId = task?.properties?.id;
        if (typeof taskId === "string") {
          interaction.onTaskSelect(taskId);
          return;
        }

        interaction.onTaskSelect(null);
        const area = map.queryRenderedFeatures(event.point, {
          layers: [AREAS_FILL_LAYER],
        })[0];
        const areaId = area?.properties?.id;
        interaction.onAreaSelect(typeof areaId === "string" ? areaId : null);
      });

      map.addControl(new NavigationControl({ showCompass: false }), "top-right");
      map.addControl(
        new GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
          showUserLocation: true,
          showAccuracyCircle: true,
        }),
        "top-right",
      );

      mapRef.current = map;
    } catch {
      if (active) {
        setLoading(false);
        setError("Die Karte konnte nicht geladen werden.");
      }
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

    setSourceData(map, AREAS_SOURCE, areaFeatures(areas, selectedAreaId));
  }, [areas, selectedAreaId, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    setSourceData(map, TASKS_SOURCE, taskFeatures(tasks, selectedTaskId));
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

    setSourceData(map, STREET_DRAFT_SOURCE, streetDraftFeature(streetDraftVertices, streetDraftColor));
    setSourceData(map, STREET_DRAFT_POINTS_SOURCE, pointFeatures(streetDraftVertices, streetDraftColor));
  }, [streetDraftVertices, streetDraftColor, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (mode === "browse") {
      map.doubleClickZoom.enable();
    } else {
      map.doubleClickZoom.disable();
    }
  }, [mode]);

  return (
    <section className={`map-region map-mode-${mode}`} aria-label="Verteilkarte">
      <div ref={containerRef} className="map" />
      {loading ? <div className="map-loading">Karte lädt…</div> : null}
      {error ? <div className="map-error">{error}</div> : null}
    </section>
  );
}
