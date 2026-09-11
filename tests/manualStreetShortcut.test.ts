import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../src/platform/PlatformShell.tsx", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../src/platform/platform-shell.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("bare map exposes the green manual Street shortcut only when creation is allowed", () => {
  assert.match(shell, /const canCreateManualStreet = Boolean\(appContext\?\.canCreateManualStreet\)/u);
  assert.match(shell, /launcherAvailable && !overlayOpen && canCreateManualStreet \? \([\s\S]*?className="platform-manual-street-button"/u);
  assert.match(shell, /aria-label="Straße manuell hinzufügen"/u);
  assert.match(shell, /onClick=\{\(\) => dispatchSimpleCommand\("start-manual-street"\)\}/u);
  assert.match(shellCss, /\.platform-manual-street-button\s*\{[\s\S]*?right: (?:0\.55rem|var\(--platform-field-edge-gap\));[\s\S]*?background: #16803c/u);
});

test("manual Street command keeps the existing direct-start and Area-selection behavior", () => {
  assert.match(app, /platformCommand\.type === "start-manual-street"[\s\S]*?startManualStreet/u);
  assert.match(app, /editableAreas\.length === 1[\s\S]*?openStreetDrawing\(editableAreas\[0\]\)/u);
  assert.match(app, /editableAreas\.length > 1[\s\S]*?setManualStreetAreaSelection\(true\)/u);
});
