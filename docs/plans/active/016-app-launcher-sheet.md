---
id: plan-016-app-launcher-sheet
type: plan
status: active
last_updated: 2026-08-26
related: [plan-014-unified-platform-ui, product-ux]
---

# Plan 016: compact app launcher sheet

## Ziel

Die Feldkarte erhält eine deutlich reduzierte obere Leiste und ein mobiles App-Launcher-Menü. In der Leiste bleiben nur ein 3x3-Menü-Symbol und direkt daneben der aktuelle Team-Kontext. Das bisherige Team-Dropdown sowie Settings/Teams/Gebiet-Buttons verschwinden aus der permanenten Kartenleiste.

Das Plattform-Menü wird nicht mehr als Fullscreen-Dashboard dargestellt. Es erscheint als kompakte, abgerundete Sheet-Fläche über der Karte und orientiert sich visuell an den bestehenden Settings-/Teams-Sheets. Innerhalb des Sheets werden die Ziele als iOS-artiges Icon-Raster mit Icon oben und kurzem Label darunter dargestellt.

## Baseline / Source of Truth

- `AGENTS.md`
- `docs/status/CURRENT.md`
- `docs/context-map.yaml`
- `docs/product/UX.md`
- `src/App.tsx`
- `src/styles.css`
- `src/platform/PlatformShell.tsx`
- `src/platform/platform-shell.css`

## Relevante Context-Graph-Nodes

- `ux`
- `plan-unified-platform-ui`
- `plan-platform-expansion`

## Aufgaben

1. Feld-Chrome auf Menü-Icon + Team-Kontext reduzieren.
2. Altes Team-Dropdown und permanente Toolbar-Aktionen aus der komponierten Browse-Ansicht entfernen.
3. App-Menü als Sheet statt Fullscreen-Overlay darstellen.
4. Icon-Raster im Stil eines mobilen Home-Screens umsetzen.
5. Stats, Team, Feedback, Smart, Einsätze und weitere vorhandene Module in dieses Raster einordnen.
6. Bestehende Module und Security-Gates unverändert weiterverwenden.
7. Mobile Touch-Ziele, Safe Areas, Fokuszustände und Reduced Motion erhalten.
8. UX/CURRENT/Context-Graph aktualisieren.
9. Tests, TypeScript, Audit, Production Build und Cloudflare Preview auf dem finalen Head prüfen.

## Akzeptanzkriterien

- Im Browse-Modus zeigt die komponierte Feldoberfläche oben links nur das 3x3-Menü-Icon und den Team-Kontext.
- Das Team-Dropdown ist nicht mehr permanent sichtbar.
- Settings, Teams und Gebiet zeichnen sind nicht mehr permanent in einer unteren Toolbar sichtbar.
- Das Menü öffnet als abgerundetes Sheet über der Karte, nicht als Fullscreen-Menü.
- Menüziele erscheinen als große touch-freundliche Icons mit Label darunter.
- Bestehende Plattformmodule bleiben erreichbar.
- Keine neue Dependency.
- Keine Änderung an Worker-Authorization, D1, PWA/Service-Worker-Grenzen oder MapLibre-Version.

## Risiken

- Entfernte permanente Aktionen dürfen nicht mit einer falschen impliziten Berechtigung ersetzt werden.
- Der aktuell angezeigte Team-Kontext wird im Shell-Slice aus dem autorisierten Team-Scope beziehungsweise dem ersten Campaign-Team abgeleitet. Eine spätere explizite Team-Wechseloberfläche muss diesen Kontext bewusst mit dem Karten-Arbeitskontext vereinheitlichen.
- Das Sheet darf auf kleinen iPhones/Android-Geräten keine Karteninteraktion außerhalb des Menüs blockieren, sobald es geschlossen ist.

## Entscheidungen

- `PlatformShell` besitzt Menü-Trigger, Team-Kontext-Chrome und Launcher-Sheet. `App` bleibt für Karteninteraktion und bestehende Domain-Sheets zuständig.
- Das Legacy-`map-toolbar` bleibt im App-Code für Übergangskompatibilität bestehen, wird aber innerhalb der komponierten Plattformansicht per Shell-CSS nicht als permanente Browse-Leiste gerendert.
- Das Menü ist ein kompaktes Bottom-Sheet-artiges Panel mit Icon-Grid statt eines Fullscreen-Dashboards.
- Vorhandene Module bleiben funktional getrennt; dieser Slice ändert Navigation und Chrome, nicht deren Persistenzmodell.

## Nicht-Ziele

- Neue Backend-Persistenz implementieren.
- Live-Group-Credentials, Accounts/TOTP oder Capability-Runtime freischalten.
- Team-/Settings-Formulare komplett neu bauen.
- Eine neue persistierte Team-Auswahl einführen.
- House-Map-Rendering implementieren.
