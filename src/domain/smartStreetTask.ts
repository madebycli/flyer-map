import { lineString } from "@turf/helpers";
import lineSliceAlong from "@turf/line-slice-along";
import {
  createId,
  type DistributionTask,
  type LineStringGeometry,
  type LngLat,
} from "./campaign.ts";
import type { SmartRoadCandidate } from "./smartCandidates.ts";
import type { SmartRoadPointAnchor } from "./smartRoadPointAnchor.ts";

export type SmartStreetSourceProvenance = {
  dataset: "OpenStreetMap";
  objectType: "way";
  objectIds: number[];
};

export type PersistableSmartStreetTask = DistributionTask & {
  source: SmartStreetSourceProvenance;
};

export type CreateSmartStreetTaskInput = {
  campaignId: string;
  areaId: string;
  label: string;
  roads: SmartRoadCandidate[];
  sourceIds: string[];
  startAnchor: SmartRoadPointAnchor;
  endAnchor: SmartRoadPointAnchor;
  taskId?: string;
  timestamp?: string;
};

type Endpoint = "start" | "end";

type Junction = {
  firstEndpoint: Endpoint;
  secondEndpoint: Endpoint;
};

const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const TASK_ID_PATTERN = /^task_[A-Za-z0-9._:-]+$/;
const COORDINATE_PRECISION = 7;
const ANCHOR_EPSILON = 1e-9;

function coordinateKey([lng, lat]: LngLat) {
  return `${lng.toFixed(COORDINATE_PRECISION)},${lat.toFixed(COORDINATE_PRECISION)}`;
}

function cloneCoordinate([lng, lat]: LngLat): LngLat {
  return [lng, lat];
}

function isValidCoordinate(value: LngLat) {
  return Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && value[0] >= -180
    && value[0] <= 180
    && value[1] >= -90
    && value[1] <= 90;
}

function assertSafeDomainId(value: string, field: string) {
  if (!value || value.length > 160 || !ID_PATTERN.test(value)) {
    throw new Error(`${field} is invalid`);
  }
}

function assertTaskId(value: string) {
  if (value.length > 180 || !TASK_ID_PATTERN.test(value)) {
    throw new Error("taskId must be an application-owned task id");
  }
}

function assertTimestamp(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new Error("timestamp is invalid");
  }
}

function assertRoadGeometry(road: SmartRoadCandidate) {
  if (!Number.isSafeInteger(road.osmId) || road.osmId <= 0) {
    throw new Error(`invalid OSM way id for ${road.sourceId}`);
  }
  if (road.geometry.type !== "LineString" || road.geometry.coordinates.length < 2) {
    throw new Error(`road ${road.sourceId} has no persistable LineString geometry`);
  }
  if (road.geometry.coordinates.some((coordinate) => !isValidCoordinate(coordinate))) {
    throw new Error(`road ${road.sourceId} has invalid coordinates`);
  }
}

function assertAnchor(anchor: SmartRoadPointAnchor, road: SmartRoadCandidate) {
  const coordinates = road.geometry.coordinates;
  if (anchor.sourceId !== road.sourceId) {
    throw new Error("anchor does not belong to the expected road");
  }
  if (
    !Number.isSafeInteger(anchor.segmentIndex)
    || anchor.segmentIndex < 0
    || anchor.segmentIndex >= coordinates.length - 1
    || !Number.isFinite(anchor.segmentT)
    || anchor.segmentT < 0
    || anchor.segmentT > 1
    || !isValidCoordinate(anchor.snapped)
  ) {
    throw new Error("anchor is invalid");
  }

  const start = coordinates[anchor.segmentIndex];
  const end = coordinates[anchor.segmentIndex + 1];
  const expected: LngLat = [
    start[0] + (end[0] - start[0]) * anchor.segmentT,
    start[1] + (end[1] - start[1]) * anchor.segmentT,
  ];
  if (
    Math.abs(expected[0] - anchor.snapped[0]) > ANCHOR_EPSILON
    || Math.abs(expected[1] - anchor.snapped[1]) > ANCHOR_EPSILON
  ) {
    throw new Error("anchor snap does not match its source segment");
  }
}

function pushCoordinate(target: LngLat[], coordinate: LngLat) {
  const next = cloneCoordinate(coordinate);
  const previous = target[target.length - 1];
  if (!previous || coordinateKey(previous) !== coordinateKey(next)) {
    target.push(next);
  }
}

function appendCoordinates(target: LngLat[], coordinates: LngLat[]) {
  for (const coordinate of coordinates) pushCoordinate(target, coordinate);
}

function sharedEndpoint(first: SmartRoadCandidate, second: SmartRoadCandidate): Junction {
  const firstCoordinates = first.geometry.coordinates;
  const secondCoordinates = second.geometry.coordinates;
  const firstEndpoints: Array<[Endpoint, LngLat]> = [
    ["start", firstCoordinates[0]],
    ["end", firstCoordinates[firstCoordinates.length - 1]],
  ];
  const secondEndpoints: Array<[Endpoint, LngLat]> = [
    ["start", secondCoordinates[0]],
    ["end", secondCoordinates[secondCoordinates.length - 1]],
  ];

  const matches: Junction[] = [];
  for (const [firstEndpoint, firstCoordinate] of firstEndpoints) {
    for (const [secondEndpoint, secondCoordinate] of secondEndpoints) {
      if (coordinateKey(firstCoordinate) === coordinateKey(secondCoordinate)) {
        matches.push({ firstEndpoint, secondEndpoint });
      }
    }
  }

  if (matches.length !== 1) {
    throw new Error("selected road sections do not form one unambiguous continuous LineString");
  }
  return matches[0];
}

function sliceAnchorToEndpoint(
  road: SmartRoadCandidate,
  anchor: SmartRoadPointAnchor,
  endpoint: Endpoint,
) {
  const coordinates = road.geometry.coordinates;
  const result: LngLat[] = [];
  pushCoordinate(result, anchor.snapped);

  if (endpoint === "start") {
    for (let index = anchor.segmentIndex; index >= 0; index -= 1) {
      pushCoordinate(result, coordinates[index]);
    }
  } else {
    for (let index = anchor.segmentIndex + 1; index < coordinates.length; index += 1) {
      pushCoordinate(result, coordinates[index]);
    }
  }

  return result;
}

function sliceEndpointToAnchor(
  road: SmartRoadCandidate,
  anchor: SmartRoadPointAnchor,
  endpoint: Endpoint,
) {
  return sliceAnchorToEndpoint(road, anchor, endpoint).reverse();
}

function localSegmentDistanceMeters(first: LngLat, second: LngLat) {
  const latitudeRadians = ((first[1] + second[1]) * Math.PI) / 360;
  const longitudeMeters = (second[0] - first[0]) * Math.cos(latitudeRadians) * 111_320;
  const latitudeMeters = (second[1] - first[1]) * 110_540;
  return Math.hypot(longitudeMeters, latitudeMeters);
}

function distanceAlongRoadMeters(
  road: SmartRoadCandidate,
  anchor: SmartRoadPointAnchor,
) {
  if (Number.isFinite(anchor.lineDistanceMeters)) return anchor.lineDistanceMeters;
  const coordinates = road.geometry.coordinates;
  let distance = 0;
  for (let index = 0; index < anchor.segmentIndex; index += 1) {
    distance += localSegmentDistanceMeters(coordinates[index], coordinates[index + 1]);
  }
  return distance + anchor.segmentT * localSegmentDistanceMeters(
    coordinates[anchor.segmentIndex],
    coordinates[anchor.segmentIndex + 1],
  );
}

function sliceSameRoad(
  road: SmartRoadCandidate,
  startAnchor: SmartRoadPointAnchor,
  endAnchor: SmartRoadPointAnchor,
) {
  const startDistance = distanceAlongRoadMeters(road, startAnchor);
  const endDistance = distanceAlongRoadMeters(road, endAnchor);
  const lowDistance = Math.min(startDistance, endDistance);
  const highDistance = Math.max(startDistance, endDistance);
  const sliced = lineSliceAlong(
    lineString(road.geometry.coordinates),
    lowDistance,
    highDistance,
    { units: "meters" },
  );
  const slicedCoordinates = sliced.geometry.coordinates.map(([lng, lat]) => [lng, lat] as LngLat);
  if (startDistance > endDistance) slicedCoordinates.reverse();

  const result: LngLat[] = [];
  pushCoordinate(result, startAnchor.snapped);
  for (let index = 1; index < slicedCoordinates.length - 1; index += 1) {
    pushCoordinate(result, slicedCoordinates[index]);
  }
  pushCoordinate(result, endAnchor.snapped);
  return result;
}

function orientedWholeRoad(
  road: SmartRoadCandidate,
  incoming: Endpoint,
  outgoing: Endpoint,
) {
  if (incoming === outgoing) {
    throw new Error("selected route enters and leaves a road at the same endpoint");
  }
  const coordinates = road.geometry.coordinates;
  return (incoming === "start" ? coordinates : [...coordinates].reverse()).map(cloneCoordinate);
}

function reviewedLineString(
  orderedRoads: SmartRoadCandidate[],
  startAnchor: SmartRoadPointAnchor,
  endAnchor: SmartRoadPointAnchor,
): LineStringGeometry {
  if (orderedRoads.length === 1) {
    const coordinates = sliceSameRoad(orderedRoads[0], startAnchor, endAnchor);
    if (coordinates.length < 2) throw new Error("selected Street geometry has zero length");
    return { type: "LineString", coordinates };
  }

  const junctions: Junction[] = [];
  for (let index = 0; index < orderedRoads.length - 1; index += 1) {
    junctions.push(sharedEndpoint(orderedRoads[index], orderedRoads[index + 1]));
  }

  const coordinates: LngLat[] = [];
  appendCoordinates(
    coordinates,
    sliceAnchorToEndpoint(orderedRoads[0], startAnchor, junctions[0].firstEndpoint),
  );

  for (let index = 1; index < orderedRoads.length - 1; index += 1) {
    appendCoordinates(
      coordinates,
      orientedWholeRoad(
        orderedRoads[index],
        junctions[index - 1].secondEndpoint,
        junctions[index].firstEndpoint,
      ),
    );
  }

  const lastIndex = orderedRoads.length - 1;
  appendCoordinates(
    coordinates,
    sliceEndpointToAnchor(
      orderedRoads[lastIndex],
      endAnchor,
      junctions[junctions.length - 1].secondEndpoint,
    ),
  );

  if (coordinates.length < 2 || coordinateKey(coordinates[0]) === coordinateKey(coordinates[coordinates.length - 1])) {
    throw new Error("selected Street geometry has zero length or is not a simple open LineString");
  }

  return { type: "LineString", coordinates };
}

function orderedSelectedRoads(roads: SmartRoadCandidate[], sourceIds: string[]) {
  if (sourceIds.length === 0) throw new Error("a Street Task requires at least one source road");
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error("the initial Street snapshot format does not persist routes that revisit a source road");
  }

  const bySourceId = new Map(roads.map((road) => [road.sourceId, road]));
  return sourceIds.map((sourceId) => {
    const road = bySourceId.get(sourceId);
    if (!road) throw new Error(`unknown selected road source: ${sourceId}`);
    assertRoadGeometry(road);
    return road;
  });
}

export function createSmartStreetTaskSnapshot(
  input: CreateSmartStreetTaskInput,
): PersistableSmartStreetTask {
  assertSafeDomainId(input.campaignId, "campaignId");
  assertSafeDomainId(input.areaId, "areaId");

  const label = input.label.trim();
  if (!label || label.length > 160) throw new Error("label is invalid");

  const taskId = input.taskId ?? createId("task");
  assertTaskId(taskId);
  const timestamp = input.timestamp ?? new Date().toISOString();
  assertTimestamp(timestamp);

  const selectedRoads = orderedSelectedRoads(input.roads, input.sourceIds);
  if (input.startAnchor.sourceId !== selectedRoads[0].sourceId) {
    throw new Error("start anchor must belong to the first selected source road");
  }
  if (input.endAnchor.sourceId !== selectedRoads[selectedRoads.length - 1].sourceId) {
    throw new Error("end anchor must belong to the last selected source road");
  }
  assertAnchor(input.startAnchor, selectedRoads[0]);
  assertAnchor(input.endAnchor, selectedRoads[selectedRoads.length - 1]);

  const geometry = reviewedLineString(selectedRoads, input.startAnchor, input.endAnchor);

  return {
    id: taskId,
    campaignId: input.campaignId,
    areaId: input.areaId,
    taskType: "street",
    label,
    geometry: {
      type: "LineString",
      coordinates: geometry.coordinates.map(cloneCoordinate),
    },
    source: {
      dataset: "OpenStreetMap",
      objectType: "way",
      objectIds: selectedRoads.map((road) => road.osmId),
    },
    areaPreparationGeneration: null,
    status: "open",
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
