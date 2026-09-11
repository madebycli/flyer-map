import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("map detail and map workflow surfaces use the universal FieldHub chrome", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const collection = await readFile("src/collection/CollectionAdminPanel.tsx", "utf8");
  const network = await readFile("src/map/useNetworkWorkspace.tsx", "utf8");
  const fieldHub = await readFile("src/platform/FieldHub.tsx", "utf8");

  assert.match(app, /import \{ FieldHub \} from "\.\/platform\/FieldHub\.tsx";/u);
  assert.match(app, /sheet === "area"[\s\S]*?<FieldHub[\s\S]*?map-area-hub/u);
  assert.match(app, /sheet === "task"[\s\S]*?<FieldHub[\s\S]*?map-task-hub/u);
  assert.match(app, /sheet === "house"[\s\S]*?<FieldHub[\s\S]*?map-house-hub/u);
  assert.match(app, /mode === "street-draw"[\s\S]*?<FieldHub[\s\S]*?map-mode-hub/u);
  assert.doesNotMatch(app, /<section className=\{`bottom-sheet/u);
  assert.doesNotMatch(app, /useLegacyFieldSheetDragBridge/u);

  assert.match(collection, /import \{ FieldHub \} from "\.\.\/platform\/FieldHub\.tsx";/u);
  assert.doesNotMatch(collection, /className="bottom-sheet/u);
  assert.match(network, /import \{ FieldHub \} from "\.\.\/platform\/FieldHub\.tsx";/u);
  assert.match(network, /<FieldHub open title="Straßenabschnitt markieren"/u);
  assert.match(fieldHub, /FieldBottomSheet/u);
});

test("the shared FieldHub header exposes a reusable optional header aside", async () => {
  const fieldBottom = await readFile("src/platform/FieldBottomSheet.tsx", "utf8");
  const fieldHub = await readFile("src/platform/FieldHub.tsx", "utf8");
  const css = await readFile("src/platform/field-bottom-sheet.css", "utf8");

  assert.match(fieldBottom, /headerAside\?: ReactNode/u);
  assert.match(fieldBottom, /field-sheet-header-aside/u);
  assert.match(fieldHub, /headerAside\?: ReactNode/u);
  assert.match(fieldHub, /headerAside=\{headerAside\}/u);
  assert.match(css, /\.field-sheet-header-aside/u);
});

test("preparation progress is polled on the persisted job and rendered as a full-width progress track", async () => {
  const network = await readFile("src/map/useNetworkWorkspace.tsx", "utf8");

  assert.match(network, /AREA_PREPARATION_POLL_INTERVAL_MS/u);
  assert.match(network, /void poll\(\)/u);
  assert.match(network, /className="area-preparation-progress"/u);
  assert.match(network, /<progress max=\{100\} value=\{state\.progress\.percent\}/u);
  assert.doesNotMatch(network, /Vorbereitung läuft serverseitig\. Du kannst die Seite schließen/u);
});

test("Area and Street map context remains blur-free", async () => {
  const css = await readFile("src/map-context-ui.css", "utf8");

  assert.match(css, /\.bottom-sheet\.compact-sheet,[\s\S]*?\.bottom-sheet\.task-sheet[\s\S]*?backdrop-filter: none;/u);
  assert.match(css, /-webkit-backdrop-filter: none;/u);
});