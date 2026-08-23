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
import type { Area, LngLat } from "../domain/campaign";
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
const DRAFT_SHAPE_SOURCE = "draft-area-shape";
const DRAFT_POINTS_SOURCE = "draft-area-points";
const EDIT_SHAPE_SOURCE = "edit-area-shape";
const EDIT_POINTS_SOURCE = "edit-area-points";
const EDIT_POINTS_LAYER = "edit-area-points-layer";

type MapMode = "browse" | "draw" | "edit";

type RenderArea = Area & {
  color: string;
};

type MapViewProps = {
  areas: RenderArea[];
  selectedAreaId: string | null;
  mode: MapMode;
  draftVertices: LngLat[];
  draftColor: string;
  editingVertices: LngLat[];
  editingColor: string;
  selectedVertexIndex: number | null;
  onAreaSelect: (areaId: string | null) => void;
  onDrawPoint: (point: LngLat) => void;
  onEditVertexSelect: (index: number) => void;
  onEditVertexMove: (index: number, point: LngLat) => void;
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

function addApplicationLayers(map: Map) {
  map.addSource(AREAS_SOURCE, { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: AREAS_FILL_LAYER,
    type: "fill",
    source: AREAS_SOURCE,
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": ["case", ["boolean", ["get", "selected"], false], 0.32, 0.2],
    },
  });
  map.addLayer({
    id: AREAS_LINE_LAYER,
    type: "line",
    source: AREAS_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["case", ["boolean", ["get", "selected"], false], 4, 2.5],
      "line-opacity": 0.95,
    },
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
}

export function MapView({
  areas,
  selectedAreaId,
  mode,
  draftVertices,
  draftColor,
  editingVertices,
  editingColor,
  selectedVertexIndex,
  onAreaSelect,
  onDrawPoint,
  onEditVertexSelect,
  onEditVertexMove,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const interactionRef = useRef({
    mode,
    selectedVertexIndex,
    onAreaSelect,
    onDrawPoint,
    onEditVertexSelect,
    onEditVertexMove,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    interactionRef.current = {
      mode,
      selectedVertexIndex,
      onAreaSelect,
      onDrawPoint,
      onEditVertexSelect,
      onEditVertexMove,
    };
  }, [
    mode,
    selectedVertexIndex,
    onAreaSelect,
    onDrawPoint,
    onEditVertexSelect,
    onEditVertexMove,
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
