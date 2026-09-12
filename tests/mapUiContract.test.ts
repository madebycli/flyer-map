import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const fieldSheet = readFileSync(new URL("../src/platform/FieldBottomSheet.tsx", import.meta.url), "utf8");
const fieldHub = readFileSync(new URL("../src/platform/FieldHub.tsx", import.meta.url), "utf8");
const sheetCss = readFileSync(new URL("../src/platform/field-bottom-sheet.css", import.meta.url), "utf8");
const platformCss = readFileSync(new URL("../src/platform/platform-shell.css", import.meta.url), "utf8");
const mapCss = readFileSync(new URL("../src/map-context-ui.css", import.meta.url), "utf8");
const geometry = readFileSync(new URL("../src/domain/geometry.ts", import.meta.url), "utf8");
const commentsPanel = readFileSync(new URL("../src/collaboration/CommentsContextPanel.tsx", import.meta.url), "utf8");
const commentsCompactCss = readFileSync(new URL("../src/collaboration/comments-context-compact.css", import.meta.url), "utf8");
const mapView = readFileSync(new URL("../src/map/MapView.tsx", import.meta.url), "utf8");
const streetCss = readFileSync(new URL("../src/street-mode.css", import.meta.url), "utf8");
const m4Css = readFileSync(new URL("../src/m4.css", import.meta.url), "utf8");

test("all FieldHubs use the shared PC bottom-left edge gap and stay sharp over the map", () => {
  assert.match(sheetCss, /justify-content:\s*flex-start;/u);
  assert.doesNotMatch(sheetCss, /field-sheet-overlay\s*\{\s*align-items:\s*center/u);
  assert.match(sheetCss, /backdrop-filter:\s*none;/u);
  assert.match(sheetCss, /-webkit-backdrop-filter:\s*none;/u);
  assert.match(platformCss, /--platform-field-edge-gap:\s*0\.55rem;/u);
  assert.match(platformCss, /--platform-field-edge-gap:\s*0\.75rem;/u);
  assert.doesNotMatch(platformCss, /backdrop-filter:\s*blur/u);
  for (const path of ["src/m4.css", "src/m5.css", "src/styles.css", "src/platform/session-map-highlight.css"]) {
    const css = readFileSync(new URL("../" + path, import.meta.url), "utf8");
    assert.doesNotMatch(css, /backdrop-filter:\s*blur/u, path);
  }
});

test("interactive map modes pass pointer input through the narrow HUD", () => {
  assert.match(
    app,
    /title="Gebiet auswählen"[\s\S]*?overlayClassName="map-context-overlay map-interaction-overlay map-area-selection-overlay"[\s\S]*?map-area-selection-hub/u,
  );
  assert.match(
    app,
    /mode === "edit"[\s\S]*?overlayClassName="map-context-overlay map-interaction-overlay"/u,
  );
  assert.match(mapCss, /\.field-sheet-overlay\.map-interaction-overlay\s*\{\s*pointer-events:\s*none;/u);
  assert.match(mapCss, /\.field-sheet-overlay\.map-interaction-overlay\s*>\s*\.field-bottom-sheet\s*\{\s*pointer-events:\s*auto;/u);
  assert.match(mapCss, /\.map-area-selection-hub\s*\{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*0;/u);
});

test("area renaming is local until one explicit save", () => {
  assert.match(app, /\| "area-name"/u);
  assert.ok(app.includes('const [areaNameDraft, setAreaNameDraft] = useState("");'));
  assert.match(app, /onTitleClick=\{canEditSelectedArea \? openAreaNameEditor : undefined\}/u);
  assert.match(app, /const saveAreaName = \(\) => \{[\s\S]*?commitSnapshot/u);
  assert.match(app, /sheet === "area-name"[\s\S]*?setAreaNameDraft\(event\.target\.value\)/u);
  assert.doesNotMatch(app, /updateSelectedArea\(\{ name: event\.target\.value \}\)/u);
  assert.doesNotMatch(app, /<input value=\{selectedArea\.name\}[\s\S]*?onChange/u);
  assert.match(fieldHub, /overlayClassName\?: string;/u);
  assert.match(fieldSheet, /onTitleClick\?: \(\) => void;/u);
});

test("FieldHub opens at natural content height and snaps only after user sizing", () => {
  assert.match(fieldSheet, /field-sheet-auto/u);
  assert.match(fieldSheet, /getBoundingClientRect\(\)\.height/u);
  assert.match(fieldSheet, /setUserSized\(true\)/u);
  assert.match(sheetCss, /\.field-bottom-sheet\.field-sheet-auto\s*\{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*0;/u);
  assert.match(sheetCss, /\.field-bottom-sheet\.field-sheet-auto \.field-sheet-body[\s\S]*?flex:\s*0 1 auto/u);
  assert.match(sheetCss, /\.field-bottom-sheet\.field-sheet-dragging\s*\{/u);
});

test("map context sheets can retract without blocking the map", () => {
  assert.match(fieldSheet, /retractable\?: boolean/u);
  assert.match(fieldSheet, /initialRetracted\?: boolean/u);
  assert.match(fieldSheet, /field-sheet-retracted/u);
  assert.match(sheetCss, /\.field-bottom-sheet\.field-sheet-retracted \.field-sheet-body[\s\S]*?max-height:\s*0/u);
  assert.match(mapCss, /\.field-sheet-overlay\.map-context-overlay\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?pointer-events:\s*none;/u);
  assert.match(app, /areaTasksExpanded/u);
  assert.match(app, /context-task-list-header/u);
  assert.match(app, /<CommentsContextPanel\s+compact/u);
  assert.doesNotMatch(app, /Tippe auf den Startpunkt A\./u);
});

test("street headers expose compact undo/cancel/confirm controls and task status has no filler row", () => {
  const network = readFileSync(new URL("../src/map/NetworkWorkspacePanel.tsx", import.meta.url), "utf8");
  const commentsCss = readFileSync(new URL("../src/collaboration/comments-context-compact.css", import.meta.url), "utf8");
  assert.match(app, /mode === "street-draw"[\s\S]*?headerActions=\{\(\) =>[\s\S]*?field-sheet-header-action-confirm[\s\S]*?onClick=\{saveStreetTask\}/u);
  assert.match(network, /headerActions=\{\(\{ reveal \}\) =>[\s\S]*?field-sheet-header-action-confirm[\s\S]*?onClick=\{reveal\}/u);
  assert.match(app, /title=\{selectedArea \? nextStreetName\(snapshot\.tasks, selectedArea\.id, language\)/u);
  assert.doesNotMatch(app, /className="task-current-status"/u);
  assert.match(app, /className="task-auxiliary-actions"[\s\S]*?<CommentsContextPanel\s+compact[\s\S]*?task-delete/u);
  assert.match(app, /className="button danger task-delete task-delete-icon-button"[\s\S]*?aria-label=\{t\(language, "deleteStreet"\)\}[\s\S]*?<svg className="task-delete-icon"/u);
  assert.match(commentsCss, /\.comments-context-panel\.is-icon\s*\{[\s\S]*?justify-self:\s*start;[\s\S]*?width:\s*max-content;/u);
  assert.match(commentsCss, /\.comments-context-panel\.is-icon \.comments-context-toggle\s*\{[\s\S]*?width:\s*2\.7rem;[\s\S]*?min-height:\s*2\.7rem;/u);
  assert.match(streetCss, /\.task-delete-icon-button\s*\{[\s\S]*?width:\s*2\.7rem;[\s\S]*?height:\s*2\.7rem;[\s\S]*?padding:\s*0\.4rem;/u);
  assert.match(streetCss, /\.task-auxiliary-actions\s*\{[\s\S]*?flex-direction:\s*column;[\s\S]*?align-items:\s*stretch;/u);
  assert.doesNotMatch(streetCss, /\.map-task-hub \.status-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u);
  assert.match(mapCss, /\.map-context-hub \.mode-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/u);
});

test("map action controls share the overlay hide contract and compact task rows", () => {
  assert.match(app, /hideRefreshControl=\{mode !== "browse" \|\| sheet !== null \|\| manualStreetAreaSelection \|\| networkWorkspace\.active\}/u);
  assert.match(mapView, /hideRefreshControl\?: boolean/u);
  assert.match(mapView, /mode === "browse" && !hideRefreshControl/u);
  assert.match(platformCss, /\.platform-map-layer\[aria-hidden="true"\] \.map-refresh-control\s*\{\s*display:\s*none;/u);
  assert.match(m4Css, /right:\s*calc\(var\(--platform-field-edge-gap[\s\S]*?1\.65rem\)/u);
  assert.match(m4Css, /width:\s*var\(--platform-field-control-size/u);
  assert.match(platformCss, /--platform-field-control-gap:\s*0\.55rem;/u);
  assert.match(platformCss, /\.platform-smart-mark-button\s*\{[\s\S]*?var\(--platform-field-control-gap\)/u);
  assert.match(mapCss, /\.area-tools-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto/u);
  assert.match(mapCss, /\.area-tools-row:has\(> \.comments-context-panel\.is-expanded\)/u);
  assert.match(streetCss, /\.task-status-tools\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto/u);
  assert.match(streetCss, /\.task-status-tools:has\(\.comments-context-panel\.is-expanded\)/u);
});

test("Area draw and edit share the Street HUD contract with approval and undo", () => {
  assert.match(geometry, /export const AREA_MAX_VERTICES = 50;/u);
  assert.match(geometry, /export function validateAreaPolygonVertices/u);
  assert.match(app, /validateAreaPolygonVertices\(draftVertices\)/u);
  assert.match(app, /validateAreaPolygonVertices\(editingVertices\)/u);
  assert.match(app, /mode === "draw"[\s\S]*?field-sheet-header-action-confirm[\s\S]*?onClick=\{saveDraftArea\}/u);
  assert.match(app, /mode === "edit"[\s\S]*?undoEditVertex[\s\S]*?field-sheet-header-action-confirm[\s\S]*?onClick=\{saveEditedArea\}/u);
  assert.match(app, /Approved.*AREA_MAX_VERTICES/u);
  assert.match(app, /editingUndoStack\.length === 0/u);
  assert.match(app, /initialSnap="expanded"[\s\S]*?retractable[\s\S]*?initialRetracted/u);
  assert.match(app, /showClose=\{false\}/u);
});

test("compact comments stay an icon toggle while their submenu is open", () => {
  assert.match(commentsPanel, /aria-expanded=\{expanded\}/u);
  assert.match(commentsPanel, /aria-pressed=\{expanded\}/u);
  assert.match(commentsPanel, /Kommentare ein- oder ausblenden/u);
  assert.match(commentsPanel, /aria-controls=\{submenuId\}/u);
  assert.match(commentsPanel, /hasFetched/u);
  assert.doesNotMatch(commentsPanel, /expanded\s*\?\s*\(language === "de" \? "Kommentare schließen"/u);
  assert.match(commentsCompactCss, /\.comments-context-panel\.is-icon\.is-expanded \.comments-context-toggle\s*\{[\s\S]*?width:\s*2\.7rem;/u);
  assert.match(commentsCompactCss, /\.comments-context-panel\.is-icon\.is-expanded \.comments-context-submenu\s*\{[\s\S]*?width:\s*100%;/u);
});
