import assert from "node:assert/strict";
import test from "node:test";
import type { HouseTask } from "../src/domain/campaign.ts";
import type { SmartBuildingCandidate } from "../src/domain/smartCandidates.ts";
import {
  availableSmartBuildingsForCreation,
  selectSmartBuildingsForStreet,
  selectedSmartBuildingLabels,
  smartBuildingLabel,
  smartBuildingStreetOptions,
  toggleSmartBuildingSourceId,
} from "../src/domain/smartBuildingSelection.ts";

function building(
  sourceId: string,
  street: string | null,
  houseNumber: string | null,
): SmartBuildingCandidate {
  return {
    sourceId,
    osmId: Number(sourceId.replace(/\D+/gu, "")) || 1,
    buildingType: "yes",
    houseNumber,
    street,
    postcode: "12345",
    city: "Musterstadt",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [13.4, 52.5],
        [13.401, 52.5],
        [13.401, 52.501],
        [13.4, 52.5],
      ]],
    },
  };
}

const buildings = [
  building("way/201", "Hauptstraße", "1"),
  building("way/202", "Hauptstraße", "3"),
  building("way/203", "Nebenstraße", "2"),
  building("way/204", null, null),
];

test("individual buildings can be toggled into and out of a stable source-id selection", () => {
  const first = toggleSmartBuildingSourceId([], "way/202", buildings);
  assert.deepEqual(first, ["way/202"]);
  const second = toggleSmartBuildingSourceId(first, "way/201", buildings);
  assert.deepEqual(second, ["way/201", "way/202"]);
  assert.deepEqual(toggleSmartBuildingSourceId(second, "way/202", buildings), ["way/201"]);
});

test("unknown building source ids do not corrupt the selection", () => {
  assert.deepEqual(toggleSmartBuildingSourceId(["way/201"], "way/missing", buildings), ["way/201"]);
});

test("all addressed buildings for one street can be selected without including another street", () => {
  assert.deepEqual(selectSmartBuildingsForStreet(buildings, " Hauptstraße "), [
    "way/201",
    "way/202",
  ]);
});

test("empty street bulk selection selects nothing", () => {
  assert.deepEqual(selectSmartBuildingsForStreet(buildings, "   "), []);
});

test("building labels prefer explicit address and fall back to inert source identity", () => {
  assert.equal(smartBuildingLabel(buildings[0]), "Hauptstraße 1");
  assert.equal(smartBuildingLabel(buildings[3]), "Gebäude way/204");
  assert.deepEqual(selectedSmartBuildingLabels(buildings, ["way/202", "way/203"]), [
    "Hauptstraße 3",
    "Nebenstraße 2",
  ]);
});

test("available candidates deduplicate source ids and only exclude exact persisted OSM way provenance", () => {
  const persisted = {
    id: "task_house-201",
    source: { dataset: "OpenStreetMap", objectType: "way", objectIds: [201] },
  } as HouseTask;
  const multiWay = {
    id: "task_house-202",
    source: { dataset: "OpenStreetMap", objectType: "way", objectIds: [202, 999] },
  } as HouseTask;

  const available = availableSmartBuildingsForCreation(
    [...buildings, buildings[0]],
    [persisted, multiWay],
  );
  assert.deepEqual(available.map((building) => building.sourceId), ["way/202", "way/203", "way/204"]);
});

test("street bulk options stay bounded while selection remains map-primary", () => {
  const manyBuildings = Array.from({ length: 40 }, (_, index) =>
    building(`way/${500 + index}`, `Straße ${index}`, String(index + 1)),
  );
  assert.equal(smartBuildingStreetOptions(manyBuildings).length, 24);
  assert.equal(smartBuildingStreetOptions(manyBuildings, Number.MAX_SAFE_INTEGER).length, 40);
});

test("building selection stops at the atomic batch limit", () => {
  const manyBuildings = Array.from({ length: 51 }, (_, index) =>
    building(`way/${700 + index}`, "Hauptstraße", String(index + 1)),
  );
  let selected: string[] = [];
  for (const candidate of manyBuildings) {
    selected = toggleSmartBuildingSourceId(selected, candidate.sourceId, manyBuildings);
  }
  assert.equal(selected.length, 50);
  assert.equal(selected.includes("way/750"), false);
});
