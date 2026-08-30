import { useEffect, useMemo, useRef, useState } from "react";
import { GeolocateControl, Map, NavigationControl } from "maplibre-gl";
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  StyleSpecification,
} from "maplibre-gl";
import {
  browserOfflineMapRepository,
  OFFLINE_MAP_CHANGED_EVENT,
} from "../data/offlineMapRepository";
import type {
  Area,
  DistributionTask,
  LineStringGeometry,
  LngLat,
  MapCameraView,
} from "../domain/campaign";
import type { CollectionArea, CollectionMainArea } from "../domain/collection";
import type { OfflineMapPackage } from "../domain/offlineMap";
import type { SmartBuildingCandidate, SmartRoadCandidate } from "../domain/smartCandidates";
import type { SmartRoadPointAnchor } from "../domain/smartRoadPointAnchor";
import type { Language } from "../i18n";
import { t } from "../i18n";
import { useSessionMapHighlight } from "../platform/sessionMapHighlight.tsx";
import { loadPersonalMapView, savePersonalMapView } from "./cameraStore";
import {
  smartHouseBuildingsToGeoJson,
} from "./smartHouseCandidateData";
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
import {
  HOUSE_FILL_LAYER_ID,
  HOUSE_LATER_LAYER_ID,
  HOUSE_MIN_ZOOM,
  HOUSE_NOT_DELIVERABLE_LAYER_ID,
  HOUSE_OUTLINE_LAYER_ID,
  HOUSE_SELECTED_LAYER_ID,
  HOUSE_SESSION_HIGHLIGHT_LAYER_ID,
  HOUSE_SOURCE_ID,
  housesToGeoJson,
  type RenderHouse,
} from "./houseRenderer";
import "maplibre-gl/dist/maplibre-gl.css";

export type MapMode = "browse" | "draw" | "edit" | "street-draw" | "smart-street" | "smart-house" | "collection-main-draw" | "collection-area-draw" | "collection-area-edit";
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

type SmartRoadFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: {
      sourceId: string;
      name: string | null;
      ref: string | null;
      highway: string;
      color: string;
      selected: boolean;
    };
    geometry: {
      type: "LineString";
      coordinates: LngLat[];
    };
  }>;
};

type SmartPreviewFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: Record<string, never>;
    geometry: {
      type: "LineString";
      coordinates: LngLat[];
    };
  }>;
};


type CollectionFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: {
      areaId?: string;
      status?: CollectionArea["status"];
      color?: string;
      selected?: boolean;
      main?: boolean;
    };
    geometry: { type: "Polygon"; coordinates: LngLat[][] };
  }>;
};

type SmartPointFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: {
      role: "start" | "end" | "waypoint";
      label: string;
    };
    geometry: {
      type: "Point";
      coordinates: LngLat;
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
  houses: RenderHouse[];
  selectedTaskId: string | null;
  selectedHouseTaskId: string | null;
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
  onHouseTaskSelect: (taskId: string | null) => void;
  onDrawPoint: (point: LngLat) => void;
  onEditVertexSelect: (index: number) => void;
  onEditVertexMove: (index: number, point: LngLat) => void;
  onStreetDrawPoint: (point: LngLat) => void;
  smartRoads: SmartRoadCandidate[];
  smartSelectedSourceIds: readonly string[];
  smartStartAnchor: SmartRoadPointAnchor | null;
  smartEndAnchor: SmartRoadPointAnchor | null;
  smartWaypointAnchors: SmartRoadPointAnchor[];
  smartPreviewGeometry: LineStringGeometry | null;
  smartStreetColor: string;
  onSmartStreetPoint: (point: LngLat, sourceIds: string[]) => void;
  smartHouseBuildings: SmartBuildingCandidate[];
  smartHouseSelectedSourceIds: readonly string[];
  onSmartHousePoint: (point: LngLat, sourceIds: string[]) => void;
  onOfflineMapPackageChange?: (pkg: OfflineMapPackage | null) => void;

  collectionVisible?: boolean;
  collectionMainArea?: CollectionMainArea | null;
  collectionAreas?: CollectionArea[];
  selectedCollectionAreaId?: string | null;
  collectionDraftVertices?: LngLat[];
  collectionEditingVertices?: LngLat[];
  collectionColor?: string;
  collectionSelectedVertexIndex?: number | null;
  onCollectionAreaSelect?: (areaId: string | null) => void;
  onCollectionDrawPoint?: (point: LngLat) => void;
  onCollectionEditVertexSelect?: (index: number) => void;
  onCollectionEditVertexMove?: (index: number, point: LngLat) => void;
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
const STREET_SESSION_HIGHLIGHT_LAYER_ID = "vf-streets-session-highlight";
const SMART_ROAD_SOURCE_ID = "vf-smart-street-candidates";
const SMART_ROAD_LAYER_ID = "vf-smart-street-candidates-line";
const SMART_ROAD_SELECTED_LAYER_ID = "vf-smart-street-candidates-selected";
const SMART_PREVIEW_SOURCE_ID = "vf-smart-street-preview";
const SMART_PREVIEW_LAYER_ID = "vf-smart-street-preview-line";
const SMART_POINT_SOURCE_ID = "vf-smart-street-points";
const SMART_POINT_LAYER_ID = "vf-smart-street-points-circle";
const SMART_POINT_LABEL_LAYER_ID = "vf-smart-street-points-label";
const SMART_HOUSE_SOURCE_ID = "vf-smart-house-candidates";
const SMART_HOUSE_FILL_LAYER_ID = "vf-smart-house-candidates-fill";
const SMART_HOUSE_OUTLINE_LAYER_ID = "vf-smart-house-candidates-outline";
const SMART_HOUSE_SELECTED_LAYER_ID = "vf-smart-house-candidates-selected";

const COLLECTION_MAIN_SOURCE_ID = "vf-collection-main-area";
const COLLECTION_AREAS_SOURCE_ID = "vf-collection-areas";
const COLLECTION_MAIN_FILL_LAYER_ID = "vf-collection-main-area-fill";
const COLLECTION_MAIN_OUTLINE_LAYER_ID = "vf-collection-main-area-outline";
const COLLECTION_AREAS_FILL_LAYER_ID = "vf-collection-areas-fill";
const COLLECTION_AREAS_OUTLINE_LAYER_ID = "vf-collection-areas-outline";
const COLLECTION_AREAS_SELECTED_LAYER_ID = "vf-collection-areas-selected";

const STREET_LAYER_IDS = [
  STREET_SELECTED_LAYER_ID,
  STREET_OPEN_LAYER_ID,
  STREET_COMPLETED_LAYER_ID,
  STREET_LATER_LAYER_ID,
  STREET_NOT_DELIVERABLE_LAYER_ID,
] as const;

const HOUSE_FILL_OPACITY_EXPRESSION: ExpressionSpecification = [
  "match",
  ["get", "status"],
  "completed",
  0.12,
  "later",
  0.1,
  "not-deliverable",
  0.08,
  0.24,
];

const HOUSE_WIDTH_EXPRESSION: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  HOUSE_MIN_ZOOM,
  0.9,
  17,
  1.3,
  20,
  2.2,
];

const HOUSE_HIGHLIGHT_WIDTH_EXPRESSION: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  HOUSE_MIN_ZOOM,
  2.2,
  17,
  3.0,
  20,
  4.6,
];

const HOUSE_SELECTED_WIDTH_EXPRESSION: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  HOUSE_MIN_ZOOM,
  2.8,
  17,
  3.7,
  20,
  5.4,
];

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

const SESSION_HIGHLIGHT_WIDTH_EXPRESSION: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  2.1,
  8,
  2.5,
  11,
  3.1,
  14,
  4.2,
  17,
  5.8,
  20,
  7.6,
];

const SMART_ROAD_WIDTH_EXPRESSION: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  10,
  1.8,
  13,
  2.8,
  16,
  4.2,
  19,
  6.2,
];

const SMART_PREVIEW_WIDTH_EXPRESSION: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  10,
  3.4,
  13,
  4.8,
  16,
  6.6,
  19,
  9,
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

function smartRoadsToGeoJson(
  roads: SmartRoadCandidate[],
  selectedSourceIds: readonly string[],
  color: string,
): SmartRoadFeatureCollection {
  const selected = new Set(selectedSourceIds);
  return {
    type: "FeatureCollection",
    features: roads.map((road) => ({
      type: "Feature",
      id: road.sourceId,
      properties: {
        sourceId: road.sourceId,
        name: road.name,
        ref: road.ref,
        highway: road.highway,
        color,
        selected: selected.has(road.sourceId),
      },
      geometry: {
        type: "LineString",
        coordinates: road.geometry.coordinates,
      },
    })),
  };
}

function smartHouseSelectionFilter(selectedSourceIds: readonly string[]): FilterSpecification {
  return selectedSourceIds.length > 0
    ? ["match", ["get", "sourceId"], [...selectedSourceIds], true, false]
    : ["==", ["get", "sourceId"], "__none__"];
}

function smartPreviewToGeoJson(
  geometry: LineStringGeometry | null,
): SmartPreviewFeatureCollection {
  return {
    type: "FeatureCollection",
    features: geometry
      ? [{
          type: "Feature",
          id: "smart-street-preview",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: geometry.coordinates,
          },
        }]
      : [],
  };
}

function smartPointsToGeoJson(
  startAnchor: SmartRoadPointAnchor | null,
  endAnchor: SmartRoadPointAnchor | null,
  waypointAnchors: SmartRoadPointAnchor[],
  language: Language,
): SmartPointFeatureCollection {
  const features: SmartPointFeatureCollection["features"] = [];
  if (startAnchor) {
    features.push({
      type: "Feature",
      id: "smart-street-start",
      properties: { role: "start", label: t(language, "smartStreetStart") },
      geometry: { type: "Point", coordinates: startAnchor.snapped },
    });
  }
  waypointAnchors.forEach((anchor, index) => {
    features.push({
      type: "Feature",
      id: `smart-street-waypoint-${index}`,
      properties: { role: "waypoint", label: t(language, "smartStreetWaypoint", { index: index + 1 }) },
      geometry: { type: "Point", coordinates: anchor.snapped },
    });
  });
  if (endAnchor) {
    features.push({
      type: "Feature",
      id: "smart-street-end",
      properties: { role: "end", label: t(language, "smartStreetEnd") },
      geometry: { type: "Point", coordinates: endAnchor.snapped },
    });
  }
  return { type: "FeatureCollection", features };
}

function buildMapStyle(
  areas: RenderArea[],
  tasks: RenderTask[],
  houses: RenderHouse[],
  smartRoads: SmartRoadCandidate[],
  smartSelectedSourceIds: readonly string[],
  smartPreviewGeometry: LineStringGeometry | null,
  smartStartAnchor: SmartRoadPointAnchor | null,
  smartEndAnchor: SmartRoadPointAnchor | null,
  smartWaypointAnchors: SmartRoadPointAnchor[],
  smartStreetColor: string,
  smartHouseBuildings: SmartBuildingCandidate[],
  smartHouseSelectedSourceIds: readonly string[],
  language: Language,
  online: boolean,
): StyleSpecification {
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
      [HOUSE_SOURCE_ID]: {
        type: "geojson",
        data: housesToGeoJson(houses),
      },
      [COLLECTION_MAIN_SOURCE_ID]: {
        type: "geojson",
        data: collectionMainToGeoJson(null),
      },
      [COLLECTION_AREAS_SOURCE_ID]: {
        type: "geojson",
        data: collectionAreasToGeoJson([], null),
      },
      [SMART_ROAD_SOURCE_ID]: {
        type: "geojson",
        data: smartRoadsToGeoJson(smartRoads, smartSelectedSourceIds, smartStreetColor),
      },
      [SMART_PREVIEW_SOURCE_ID]: {
        type: "geojson",
        data: smartPreviewToGeoJson(smartPreviewGeometry),
      },
      [SMART_POINT_SOURCE_ID]: {
        type: "geojson",
        data: smartPointsToGeoJson(smartStartAnchor, smartEndAnchor, smartWaypointAnchors, language),
      },
      [SMART_HOUSE_SOURCE_ID]: {
        type: "geojson",
        data: smartHouseBuildingsToGeoJson(smartHouseBuildings),
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
        id: HOUSE_FILL_LAYER_ID,
        type: "fill",
        source: HOUSE_SOURCE_ID,
        minzoom: HOUSE_MIN_ZOOM,
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": HOUSE_FILL_OPACITY_EXPRESSION,
        },
      },
      {
        id: HOUSE_OUTLINE_LAYER_ID,
        type: "line",
        source: HOUSE_SOURCE_ID,
        minzoom: HOUSE_MIN_ZOOM,
        filter: [
          "any",
          ["==", ["get", "status"], "open"],
          ["==", ["get", "status"], "completed"],
        ],
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.9,
          "line-width": HOUSE_WIDTH_EXPRESSION,
        },
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
      },
      {
        id: HOUSE_LATER_LAYER_ID,
        type: "line",
        source: HOUSE_SOURCE_ID,
        minzoom: HOUSE_MIN_ZOOM,
        filter: ["==", ["get", "status"], "later"],
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.88,
          "line-width": HOUSE_WIDTH_EXPRESSION,
          "line-dasharray": [2, 2],
        },
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
      },
      {
        id: HOUSE_NOT_DELIVERABLE_LAYER_ID,
        type: "line",
        source: HOUSE_SOURCE_ID,
        minzoom: HOUSE_MIN_ZOOM,
        filter: ["==", ["get", "status"], "not-deliverable"],
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.86,
          "line-width": HOUSE_WIDTH_EXPRESSION,
          "line-dasharray": [0.7, 2.8],
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
      {
        id: STREET_SESSION_HIGHLIGHT_LAYER_ID,
        type: "line",
        source: STREET_SOURCE_ID,
        filter: ["==", ["get", "taskId"], "__none__"],
        paint: {
          "line-color": "#f59e0b",
          "line-opacity": 0.92,
          "line-width": SESSION_HIGHLIGHT_WIDTH_EXPRESSION,
        },
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
      },
      {
        id: HOUSE_SESSION_HIGHLIGHT_LAYER_ID,
        type: "line",
        source: HOUSE_SOURCE_ID,
        minzoom: HOUSE_MIN_ZOOM,
        filter: ["==", ["get", "houseTaskId"], "__none__"],
        paint: {
          "line-color": "#f59e0b",
          "line-opacity": 0.96,
          "line-width": HOUSE_HIGHLIGHT_WIDTH_EXPRESSION,
          "line-dasharray": [1, 1],
        },
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
      },
      {
        id: HOUSE_SELECTED_LAYER_ID,
        type: "line",
        source: HOUSE_SOURCE_ID,
        minzoom: HOUSE_MIN_ZOOM,
        filter: ["==", ["get", "houseTaskId"], "__none__"],
        paint: {
          "line-color": "#172019",
          "line-opacity": 0.98,
          "line-width": HOUSE_SELECTED_WIDTH_EXPRESSION,
        },
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
      },
      {
        id: COLLECTION_MAIN_FILL_LAYER_ID,
        type: "fill",
        source: COLLECTION_MAIN_SOURCE_ID,
        layout: { visibility: "none" },
        paint: { "fill-color": "#9aa1a6", "fill-opacity": 0.18 },
      },
      {
        id: COLLECTION_MAIN_OUTLINE_LAYER_ID,
        type: "line",
        source: COLLECTION_MAIN_SOURCE_ID,
        layout: { visibility: "none", "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#70777d", "line-opacity": 0.9, "line-width": 2 },
      },
      {
        id: COLLECTION_AREAS_FILL_LAYER_ID,
        type: "fill",
        source: COLLECTION_AREAS_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": [
            "match", ["get", "status"],
            "completed", 0.34,
            "in-progress", 0.3,
            "claimed", 0.25,
            0.2,
          ],
        },
      },
      {
        id: COLLECTION_AREAS_OUTLINE_LAYER_ID,
        type: "line",
        source: COLLECTION_AREAS_SOURCE_ID,
        layout: { visibility: "none", "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.95,
          "line-width": 2,
        },
      },
      {
        id: COLLECTION_AREAS_SELECTED_LAYER_ID,
        type: "line",
        source: COLLECTION_AREAS_SOURCE_ID,
        filter: ["==", ["get", "selected"], true],
        layout: { visibility: "none", "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#111827", "line-opacity": 1, "line-width": 4 },
      },
      {
        id: SMART_HOUSE_FILL_LAYER_ID,
        type: "fill",
        source: SMART_HOUSE_SOURCE_ID,
        minzoom: HOUSE_MIN_ZOOM,
        layout: { visibility: "none" },
        paint: {
          "fill-color": "#9bc8a7",
          "fill-opacity": 0.32,
        },
      },
      {
        id: SMART_HOUSE_OUTLINE_LAYER_ID,
        type: "line",
        source: SMART_HOUSE_SOURCE_ID,
        minzoom: HOUSE_MIN_ZOOM,
        layout: {
          visibility: "none",
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#2d6a3f",
          "line-opacity": 0.9,
          "line-width": HOUSE_WIDTH_EXPRESSION,
        },
      },
      {
        id: SMART_HOUSE_SELECTED_LAYER_ID,
        type: "line",
        source: SMART_HOUSE_SOURCE_ID,
        minzoom: HOUSE_MIN_ZOOM,
        filter: smartHouseSelectionFilter(smartHouseSelectedSourceIds),
        layout: {
          visibility: "none",
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#172019",
          "line-opacity": 0.98,
          "line-width": HOUSE_SELECTED_WIDTH_EXPRESSION,
        },
      },
      {
        id: SMART_ROAD_LAYER_ID,
        type: "line",
        source: SMART_ROAD_SOURCE_ID,
        filter: ["==", ["get", "selected"], false],
        layout: {
          visibility: "none",
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#53635a",
          "line-opacity": 0.88,
          "line-width": SMART_ROAD_WIDTH_EXPRESSION,
          "line-dasharray": [2, 1.5],
        },
      },
      {
        id: SMART_ROAD_SELECTED_LAYER_ID,
        type: "line",
        source: SMART_ROAD_SOURCE_ID,
        filter: ["==", ["get", "selected"], true],
        layout: {
          visibility: "none",
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.98,
          "line-width": SMART_ROAD_WIDTH_EXPRESSION,
        },
      },
      {
        id: SMART_PREVIEW_LAYER_ID,
        type: "line",
        source: SMART_PREVIEW_SOURCE_ID,
        layout: {
          visibility: "none",
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#f59e0b",
          "line-opacity": 0.98,
          "line-width": SMART_PREVIEW_WIDTH_EXPRESSION,
        },
      },
      {
        id: SMART_POINT_LAYER_ID,
        type: "circle",
        source: SMART_POINT_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "circle-color": [
            "match",
            ["get", "role"],
            "start",
            "#1f6b3a",
            "end",
            "#b42318",
            "#2563eb",
          ],
          "circle-radius": 8,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      },
      {
        id: SMART_POINT_LABEL_LAYER_ID,
        type: "symbol",
        source: SMART_POINT_SOURCE_ID,
        layout: {
          visibility: "none",
          "text-field": ["get", "label"],
          "text-size": 12,
          "text-offset": [0, 1.35],
          "text-anchor": "top",
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#172019",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      },
    ],
  };
}


function collectionMainToGeoJson(mainArea: CollectionMainArea | null): CollectionFeatureCollection {
  return {
    type: "FeatureCollection",
    features: mainArea ? [{
      type: "Feature",
      id: mainArea.id,
      properties: { main: true, color: "#9aa1a6" },
      geometry: { type: "Polygon", coordinates: mainArea.geometry.coordinates },
    }] : [],
  };
}

function collectionAreasToGeoJson(
  areas: CollectionArea[],
  selectedAreaId: string | null,
): CollectionFeatureCollection {
  return {
    type: "FeatureCollection",
    features: areas.filter((area) => area.status !== "archived").map((area) => ({
      type: "Feature",
      id: area.id,
      properties: {
        areaId: area.id,
        status: area.status,
        color: area.color,
        selected: area.id === selectedAreaId,
      },
      geometry: { type: "Polygon", coordinates: area.geometry.coordinates },
    })),
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


function syncCollectionData(
  map: Map,
  mainArea: CollectionMainArea | null,
  areas: CollectionArea[],
  selectedAreaId: string | null,
  visible: boolean,
) {
  const mainSource = map.getSource(COLLECTION_MAIN_SOURCE_ID) as GeoJSONSource | undefined;
  if (mainSource) mainSource.setData(collectionMainToGeoJson(mainArea));
  const areaSource = map.getSource(COLLECTION_AREAS_SOURCE_ID) as GeoJSONSource | undefined;
  if (areaSource) areaSource.setData(collectionAreasToGeoJson(areas, selectedAreaId));
  const visibility = visible ? "visible" : "none";
  for (const layerId of [
    COLLECTION_MAIN_FILL_LAYER_ID,
    COLLECTION_MAIN_OUTLINE_LAYER_ID,
    COLLECTION_AREAS_FILL_LAYER_ID,
    COLLECTION_AREAS_OUTLINE_LAYER_ID,
    COLLECTION_AREAS_SELECTED_LAYER_ID,
  ]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
  }
  const region = map.getContainer().closest<HTMLElement>(".map-region");
  if (region) {
    region.dataset.collectionMain = mainArea ? "1" : "0";
    region.dataset.collectionAreas = String(areas.filter((area) => area.status !== "archived").length);
    region.dataset.collectionSelectedArea = selectedAreaId ?? "";
  }
}

function syncAreaData(map: Map, areas: RenderArea[]) {
  const areaSource = map.getSource(AREA_SOURCE_ID) as GeoJSONSource | undefined;
  if (areaSource) areaSource.setData(areasToGeoJson(areas));
}

function syncStreetData(map: Map, tasks: RenderTask[]) {
  const streetSource = map.getSource(STREET_SOURCE_ID) as GeoJSONSource | undefined;
  if (streetSource) streetSource.setData(streetsToGeoJson(tasks));
}

function syncHouseData(map: Map, houses: RenderHouse[]) {
  const houseSource = map.getSource(HOUSE_SOURCE_ID) as GeoJSONSource | undefined;
  if (houseSource) houseSource.setData(housesToGeoJson(houses));
}

function syncSmartStreetData(
  map: Map,
  roads: SmartRoadCandidate[],
  selectedSourceIds: readonly string[],
  previewGeometry: LineStringGeometry | null,
  startAnchor: SmartRoadPointAnchor | null,
  endAnchor: SmartRoadPointAnchor | null,
  waypointAnchors: SmartRoadPointAnchor[],
  color: string,
  language: Language,
  mode: MapMode,
) {
  const roadSource = map.getSource(SMART_ROAD_SOURCE_ID) as GeoJSONSource | undefined;
  if (roadSource) roadSource.setData(smartRoadsToGeoJson(roads, selectedSourceIds, color));

  const previewSource = map.getSource(SMART_PREVIEW_SOURCE_ID) as GeoJSONSource | undefined;
  if (previewSource) previewSource.setData(smartPreviewToGeoJson(previewGeometry));

  const pointSource = map.getSource(SMART_POINT_SOURCE_ID) as GeoJSONSource | undefined;
  if (pointSource) pointSource.setData(smartPointsToGeoJson(startAnchor, endAnchor, waypointAnchors, language));

  const visibility = mode === "smart-street" ? "visible" : "none";
  for (const layerId of [
    SMART_ROAD_LAYER_ID,
    SMART_ROAD_SELECTED_LAYER_ID,
    SMART_PREVIEW_LAYER_ID,
    SMART_POINT_LAYER_ID,
    SMART_POINT_LABEL_LAYER_ID,
  ]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
  }

  const region = map.getContainer().closest<HTMLElement>(".map-region");
  if (region) {
    region.dataset.smartCandidateRoads = String(roads.length);
    region.dataset.smartSelectedRoads = String(selectedSourceIds.length);
  }
}

function syncSmartHouseData(map: Map, buildings: SmartBuildingCandidate[]) {
  const source = map.getSource(SMART_HOUSE_SOURCE_ID) as GeoJSONSource | undefined;
  if (source) source.setData(smartHouseBuildingsToGeoJson(buildings));

  const region = map.getContainer().closest<HTMLElement>(".map-region");
  if (region) region.dataset.smartCandidateHouses = String(buildings.length);
}

function syncSmartHouseSelection(
  map: Map,
  selectedSourceIds: readonly string[],
  mode: MapMode,
) {
  if (map.getLayer(SMART_HOUSE_SELECTED_LAYER_ID)) {
    map.setFilter(
      SMART_HOUSE_SELECTED_LAYER_ID,
      smartHouseSelectionFilter(selectedSourceIds),
    );
  }

  const visibility = mode === "smart-house" ? "visible" : "none";
  for (const layerId of [
    SMART_HOUSE_FILL_LAYER_ID,
    SMART_HOUSE_OUTLINE_LAYER_ID,
    SMART_HOUSE_SELECTED_LAYER_ID,
  ]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
  }

  const region = map.getContainer().closest<HTMLElement>(".map-region");
  if (region) region.dataset.smartSelectedHouses = String(selectedSourceIds.length);
}

function syncApplicationFilters(
  map: Map,
  selectedTaskId: string | null,
  selectedHouseTaskId: string | null,
  highlightedStreetTaskIds: readonly string[],
  highlightedHouseTaskIds: readonly string[],
) {

  if (map.getLayer(STREET_SELECTED_LAYER_ID)) {
    map.setFilter(
      STREET_SELECTED_LAYER_ID,
      ["==", ["get", "taskId"], selectedTaskId ?? "__none__"],
    );
  }
  if (map.getLayer(STREET_SESSION_HIGHLIGHT_LAYER_ID)) {
    map.setFilter(
      STREET_SESSION_HIGHLIGHT_LAYER_ID,
      highlightedStreetTaskIds.length > 0
        ? ["match", ["get", "taskId"], [...highlightedStreetTaskIds], true, false]
        : ["==", ["get", "taskId"], "__none__"],
    );
  }

  if (map.getLayer(HOUSE_SELECTED_LAYER_ID)) {
    map.setFilter(
      HOUSE_SELECTED_LAYER_ID,
      ["==", ["get", "houseTaskId"], selectedHouseTaskId ?? "__none__"],
    );
  }
  if (map.getLayer(HOUSE_SESSION_HIGHLIGHT_LAYER_ID)) {
    map.setFilter(
      HOUSE_SESSION_HIGHLIGHT_LAYER_ID,
      highlightedHouseTaskIds.length > 0
        ? ["match", ["get", "houseTaskId"], [...highlightedHouseTaskIds], true, false]
        : ["==", ["get", "houseTaskId"], "__none__"],
    );
  }

  const region = map.getContainer().closest<HTMLElement>(".map-region");
  if (region) {
    region.dataset.sessionHighlightStreets = String(highlightedStreetTaskIds.length);
    region.dataset.sessionHighlightHouses = String(highlightedHouseTaskIds.length);
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
    const sourceHouses = map.querySourceFeatures(HOUSE_SOURCE_ID).filter(
      (feature) => typeof feature.properties?.houseTaskId === "string",
    );
    const renderedHouses = map.getLayer(HOUSE_FILL_LAYER_ID)
      ? map.queryRenderedFeatures(undefined, { layers: [HOUSE_FILL_LAYER_ID] })
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
    region.dataset.sourceHouses = String(
      new Set(sourceHouses.map((feature) => feature.properties?.houseTaskId)).size,
    );
    region.dataset.renderedHouses = String(
      new Set(renderedHouses.map((feature) => feature.properties?.houseTaskId)).size,
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
  houses,
  selectedTaskId,
  selectedHouseTaskId,
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
  onHouseTaskSelect,
  onDrawPoint,
  onEditVertexSelect,
  onEditVertexMove,
  onStreetDrawPoint,
  smartRoads,
  smartSelectedSourceIds,
  smartStartAnchor,
  smartEndAnchor,
  smartWaypointAnchors,
  smartPreviewGeometry,
  smartStreetColor,
  onSmartStreetPoint,
  smartHouseBuildings,
  smartHouseSelectedSourceIds,
  onSmartHousePoint,
  onOfflineMapPackageChange,
  collectionVisible = false,
  collectionMainArea = null,
  collectionAreas = [],
  selectedCollectionAreaId = null,
  collectionDraftVertices = [],
  collectionEditingVertices = [],
  collectionColor = "#2563eb",
  collectionSelectedVertexIndex = null,
  onCollectionAreaSelect = () => {},
  onCollectionDrawPoint = () => {},
  onCollectionEditVertexSelect = () => {},
  onCollectionEditVertexMove = () => {},
}: MapViewProps) {
  const sessionMapHighlight = useSessionMapHighlight();
  const highlightedStreetTaskIds = useMemo(
    () =>
      sessionMapHighlight?.campaignId === campaignId
        ? [...sessionMapHighlight.streetTaskIds]
        : [],
    [campaignId, sessionMapHighlight],
  );
  const highlightedHouseTaskIds = useMemo(
    () =>
      sessionMapHighlight?.campaignId === campaignId
        ? [...sessionMapHighlight.houseTaskIds]
        : [],
    [campaignId, sessionMapHighlight],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const cameraSaveTimerRef = useRef<number | null>(null);
  const suppressNextCameraSaveRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [offlineContextActive, setOfflineContextActive] = useState(false);
  const offlineMapPackageChangeRef = useRef(onOfflineMapPackageChange);
  offlineMapPackageChangeRef.current = onOfflineMapPackageChange;

  const activePrimaryRef = useRef<SVGPolygonElement | SVGPolylineElement | null>(null);
  const activeHaloRef = useRef<SVGPolygonElement | SVGPolylineElement | null>(null);
  const activeMarkerRefs = useRef(new globalThis.Map<number, SVGCircleElement>());

  const dataRef = useRef({
    areas,
    tasks,
    houses,
    selectedTaskId,
    selectedHouseTaskId,
    highlightedStreetTaskIds,
    highlightedHouseTaskIds,
    mode,
    smartRoads,
    smartSelectedSourceIds,
    smartStartAnchor,
    smartEndAnchor,
    smartWaypointAnchors,
    smartPreviewGeometry,
    smartStreetColor,
    smartHouseBuildings,
    smartHouseSelectedSourceIds,
    language,
    collectionVisible,
    collectionMainArea,
    collectionAreas,
    selectedCollectionAreaId,
  });
  dataRef.current = {
    areas,
    tasks,
    houses,
    selectedTaskId,
    selectedHouseTaskId,
    highlightedStreetTaskIds,
    highlightedHouseTaskIds,
    mode,
    smartRoads,
    smartSelectedSourceIds,
    smartStartAnchor,
    smartEndAnchor,
    smartWaypointAnchors,
    smartPreviewGeometry,
    smartStreetColor,
    smartHouseBuildings,
    smartHouseSelectedSourceIds,
    language,
    collectionVisible,
    collectionMainArea,
    collectionAreas,
    selectedCollectionAreaId,
  };

  const interactionRef = useRef({
    mode,
    draftVertices,
    editingVertices,
    selectedVertexIndex,
    streetDraftVertices,
    onAreaSelect,
    onTaskSelect,
    onHouseTaskSelect,
    onDrawPoint,
    onEditVertexSelect,
    onEditVertexMove,
    onStreetDrawPoint,
    onSmartStreetPoint,
    onSmartHousePoint,
    collectionVisible,
    collectionDraftVertices,
    collectionEditingVertices,
    collectionSelectedVertexIndex,
    onCollectionAreaSelect,
    onCollectionDrawPoint,
    onCollectionEditVertexSelect,
    onCollectionEditVertexMove,
  });
  interactionRef.current = {
    mode,
    draftVertices,
    editingVertices,
    selectedVertexIndex,
    streetDraftVertices,
    onAreaSelect,
    onTaskSelect,
    onHouseTaskSelect,
    onDrawPoint,
    onEditVertexSelect,
    onEditVertexMove,
    onStreetDrawPoint,
    onSmartStreetPoint,
    onSmartHousePoint,
    collectionVisible,
    collectionDraftVertices,
    collectionEditingVertices,
    collectionSelectedVertexIndex,
    onCollectionAreaSelect,
    onCollectionDrawPoint,
    onCollectionEditVertexSelect,
    onCollectionEditVertexMove,
  };

  const activeCoordinates = useMemo(() => {
    if (mode === "draw") return draftVertices;
    if (mode === "edit") return editingVertices;
    if (mode === "street-draw") return streetDraftVertices;
    if (mode === "collection-main-draw" || mode === "collection-area-draw") return collectionDraftVertices;
    if (mode === "collection-area-edit") return collectionEditingVertices;
    return [];
  }, [
    mode,
    draftVertices,
    editingVertices,
    streetDraftVertices,
    collectionDraftVertices,
    collectionEditingVertices,
  ]);

  const updateActiveOverlay = (map: Map) => {
    const interaction = interactionRef.current;
    let coordinates: LngLat[] = [];
    if (interaction.mode === "draw") coordinates = interaction.draftVertices;
    else if (interaction.mode === "edit") coordinates = interaction.editingVertices;
    else if (interaction.mode === "street-draw") coordinates = interaction.streetDraftVertices;
    else if (
      interaction.mode === "collection-main-draw" ||
      interaction.mode === "collection-area-draw"
    ) coordinates = interaction.collectionDraftVertices;
    else if (interaction.mode === "collection-area-edit") coordinates = interaction.collectionEditingVertices;

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
    let cleanupListeners = () => {};
    const initialCamera = loadPersonalMapView(campaignId) ?? campaignDefaultView ?? GERMANY_VIEW;
    const initialData = dataRef.current;

    try {
      const map = new Map({
        container: containerRef.current,
        style: buildMapStyle(
          initialData.areas,
          initialData.tasks,
          initialData.houses,
          initialData.smartRoads,
          initialData.smartSelectedSourceIds,
          initialData.smartPreviewGeometry,
          initialData.smartStartAnchor,
          initialData.smartEndAnchor,
          initialData.smartWaypointAnchors,
          initialData.smartStreetColor,
          initialData.smartHouseBuildings,
          initialData.smartHouseSelectedSourceIds,
          initialData.language,
          navigator.onLine,
        ),
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
          offlineMapPackageChangeRef.current?.(pkg);
          setOfflineContextActive(!online && Boolean(pkg));
          if (map.isStyleLoaded()) syncOfflineMapData(map, pkg, online);
        } catch (cause) {
          console.warn("Prepared offline map could not be loaded", cause);
          if (!active) return;
          offlineMapPackageChangeRef.current?.(null);
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
      cleanupListeners = () => {
        window.removeEventListener("online", handleConnectivityChange);
        window.removeEventListener("offline", handleConnectivityChange);
        window.removeEventListener(OFFLINE_MAP_CHANGED_EVENT, handleOfflineMapChanged);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
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

      map.on("error", (event) => {
        console.error("MapLibre runtime error", event.error ?? event);
      });

      map.once("load", () => {
        if (!active) return;
        const current = dataRef.current;
        syncAreaData(map, current.areas);
        syncStreetData(map, current.tasks);
        syncHouseData(map, current.houses);
        syncCollectionData(
          map,
          current.collectionMainArea,
          current.collectionAreas,
          current.selectedCollectionAreaId,
          current.collectionVisible,
        );
        syncSmartStreetData(
          map,
          current.smartRoads,
          current.smartSelectedSourceIds,
          current.smartPreviewGeometry,
          current.smartStartAnchor,
          current.smartEndAnchor,
          current.smartWaypointAnchors,
          current.smartStreetColor,
          current.language,
          current.mode,
        );
        syncSmartHouseData(map, current.smartHouseBuildings);
        syncSmartHouseSelection(map, current.smartHouseSelectedSourceIds, current.mode);
        syncApplicationFilters(
          map,
          current.selectedTaskId,
          current.selectedHouseTaskId,
          current.highlightedStreetTaskIds,
          current.highlightedHouseTaskIds,
        );
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

        if (interaction.collectionVisible) {
          if (
            interaction.mode === "collection-main-draw" ||
            interaction.mode === "collection-area-draw"
          ) {
            interaction.onCollectionDrawPoint(lngLat);
            return;
          }
          if (interaction.mode === "collection-area-edit") {
            const vertexIndex = findEditVertex(
              map,
              interaction.collectionEditingVertices,
              event.point,
            );
            if (vertexIndex !== null) {
              interaction.onCollectionEditVertexSelect(vertexIndex);
              return;
            }
            if (interaction.collectionSelectedVertexIndex !== null) {
              interaction.onCollectionEditVertexMove(
                interaction.collectionSelectedVertexIndex,
                lngLat,
              );
            }
            return;
          }
          const collectionLayers = [COLLECTION_AREAS_SELECTED_LAYER_ID, COLLECTION_AREAS_FILL_LAYER_ID]
            .filter((layerId) => map.getLayer(layerId));
          const collectionFeatures = collectionLayers.length > 0
            ? map.queryRenderedFeatures(event.point, { layers: collectionLayers })
            : [];
          const collectionFeature = collectionFeatures.find(
            (feature) => typeof feature.properties?.areaId === "string",
          );
          interaction.onCollectionAreaSelect(
            collectionFeature && typeof collectionFeature.properties?.areaId === "string"
              ? collectionFeature.properties.areaId
              : null,
          );
          return;
        }

        if (interaction.mode === "draw") {
          interaction.onDrawPoint(lngLat);
          return;
        }
        if (interaction.mode === "street-draw") {
          interaction.onStreetDrawPoint(lngLat);
          return;
        }
        if (interaction.mode === "smart-street") {
          const smartLayers = [SMART_ROAD_LAYER_ID, SMART_ROAD_SELECTED_LAYER_ID].filter(
            (layerId) => map.getLayer(layerId),
          );
          const bbox: [[number, number], [number, number]] = [
            [event.point.x - 10, event.point.y - 10],
            [event.point.x + 10, event.point.y + 10],
          ];
          const smartFeatures = smartLayers.length > 0
            ? map.queryRenderedFeatures(bbox, { layers: smartLayers })
            : [];
          const sourceIds = [...new Set(
            smartFeatures
              .map((feature) => feature.properties?.sourceId)
              .filter((sourceId): sourceId is string => typeof sourceId === "string"),
          )];
          interaction.onSmartStreetPoint(lngLat, sourceIds);
          return;
        }
        if (interaction.mode === "smart-house") {
          const bbox: [[number, number], [number, number]] = [
            [event.point.x - 10, event.point.y - 10],
            [event.point.x + 10, event.point.y + 10],
          ];
          const smartFeatures = map.getLayer(SMART_HOUSE_FILL_LAYER_ID)
            ? map.queryRenderedFeatures(bbox, { layers: [SMART_HOUSE_FILL_LAYER_ID] })
            : [];
          const sourceIds = [...new Set(
            smartFeatures
              .map((feature) => feature.properties?.sourceId)
              .filter((sourceId): sourceId is string => typeof sourceId === "string"),
          )];
          interaction.onSmartHousePoint(lngLat, sourceIds);
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

        if (map.getLayer(HOUSE_FILL_LAYER_ID)) {
          const bbox: [[number, number], [number, number]] = [
            [event.point.x - 10, event.point.y - 10],
            [event.point.x + 10, event.point.y + 10],
          ];
          const houseFeatures = map.queryRenderedFeatures(bbox, {
            layers: [HOUSE_FILL_LAYER_ID],
          });
          const houseFeature = houseFeatures.find(
            (feature) => typeof feature.properties?.houseTaskId === "string",
          );
          if (houseFeature && typeof houseFeature.properties?.houseTaskId === "string") {
            interaction.onHouseTaskSelect(houseFeature.properties.houseTaskId);
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
    } catch (cause) {
      console.error("Map initialization failed", cause);
      if (active) setError(t(language, "mapInitError"));
    }

    return () => {
      active = false;
      cleanupListeners();
      if (cameraSaveTimerRef.current !== null) window.clearTimeout(cameraSaveTimerRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [campaignId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    syncAreaData(map, areas);
  }, [areas]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    syncStreetData(map, tasks);
  }, [tasks]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    syncHouseData(map, houses);
  }, [houses]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    syncSmartHouseData(map, smartHouseBuildings);
  }, [smartHouseBuildings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    syncSmartHouseSelection(map, smartHouseSelectedSourceIds, mode);
  }, [mode, smartHouseSelectedSourceIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    syncCollectionData(
      map,
      collectionMainArea,
      collectionAreas,
      selectedCollectionAreaId,
      collectionVisible,
    );
  }, [
    collectionAreas,
    collectionMainArea,
    collectionVisible,
    selectedCollectionAreaId,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    syncSmartStreetData(
      map,
      smartRoads,
      smartSelectedSourceIds,
      smartPreviewGeometry,
      smartStartAnchor,
      smartEndAnchor,
      smartWaypointAnchors,
      smartStreetColor,
      language,
      mode,
    );
  }, [
    mode,
    smartEndAnchor,
    smartPreviewGeometry,
    smartRoads,
    smartSelectedSourceIds,
    smartStartAnchor,
    smartStreetColor,
    smartWaypointAnchors,
    language,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    syncApplicationFilters(
      map,
      selectedTaskId,
      selectedHouseTaskId,
      highlightedStreetTaskIds,
      highlightedHouseTaskIds,
    );
  }, [
    highlightedHouseTaskIds,
    highlightedStreetTaskIds,
    selectedHouseTaskId,
    selectedTaskId,
  ]);

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
      data-collection-visible={collectionVisible ? "1" : "0"}
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

          {mode === "collection-main-draw" || mode === "collection-area-draw" ? (
            <>
              {collectionDraftVertices.length >= 2 ? (
                <>
                  <polyline
                    ref={activeHaloRef as React.RefObject<SVGPolylineElement>}
                    points={map ? projectedPoints(map, collectionDraftVertices) : ""}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={12}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polyline
                    ref={activePrimaryRef as React.RefObject<SVGPolylineElement>}
                    points={map ? projectedPoints(map, collectionDraftVertices) : ""}
                    fill="none"
                    stroke={collectionColor}
                    strokeWidth={8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              ) : null}
              <ProjectedMarkers
                map={map}
                coordinates={collectionDraftVertices}
                color={collectionColor}
                radius={10}
                markerRefs={activeMarkerRefs}
              />
            </>
          ) : null}

          {mode === "collection-area-edit" ? (
            <>
              {collectionEditingVertices.length >= 3 ? (
                <>
                  <polygon
                    ref={activeHaloRef as React.RefObject<SVGPolygonElement>}
                    points={map ? projectedPoints(map, collectionEditingVertices) : ""}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={14}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polygon
                    ref={activePrimaryRef as React.RefObject<SVGPolygonElement>}
                    points={map ? projectedPoints(map, collectionEditingVertices) : ""}
                    fill={collectionColor}
                    fillOpacity={0.24}
                    stroke={collectionColor}
                    strokeWidth={8}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              ) : null}
              <ProjectedMarkers
                map={map}
                coordinates={collectionEditingVertices}
                color={collectionColor}
                selectedIndex={collectionSelectedVertexIndex}
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
