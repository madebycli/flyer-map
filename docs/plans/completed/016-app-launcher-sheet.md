---
id: plan-016-app-launcher-sheet
type: plan
status: completed
last_updated: 2026-08-26
related: [plan-014-unified-platform-ui, product-ux]
---

# Plan 016: compact app launcher sheet

## Ziel

Die Feldkarte erhält eine deutlich reduzierte permanente Leiste und ein mobiles App-Launcher-Menü. In der unteren Leiste bleiben nur ein 3x3-Menü-Symbol und direkt daneben der sichtbare aktuelle Teamname. Die Teamfarbe darf den Namen lediglich ergänzen. Das bisherige Team-Dropdown sowie Settings/Teams/Gebiet-Buttons verschwinden aus der permanenten Kartenleiste.

Das Plattform-Menü wird nicht mehr als Fullscreen-Dashboard dargestellt. Es erscheint als kompakte, abgerundete Sheet-Fläche über der Karte und orientiert sich visuell an den bestehenden Settings-/Teams-Sheets. Innerhalb des Sheets werden die Ziele als iOS-artiges Icon-Raster mit Icon oben und kurzem Label darunter dargestellt.

## Baseline / Source of Truth

- `AGENTS.md`
- `docs/status/CURRENT.md`
- `docs/context-map.yaml`
- `docs/product/UX.md`
- `src/platform/PlatformShell.tsx`
- `src/platform/platform-shell.css`

## Umsetzung

- `PlatformShell` rendert unten links eine kompakte weiße Feldleiste mit einem echten 3x3-App-Raster-Glyph und sichtbarem Teamnamen; der Team-Farbpunkt ist nur ein zusätzlicher Kontextmarker.
- Die Legacy-`map-toolbar` mit permanentem Team-Dropdown, Settings-, Teams- und Draw-Area-Buttons bleibt nur als Übergangscode in `App`, wird in der komponierten Plattformansicht aber nicht gerendert.
- Ehemalige Toolbar-Aktionen werden vorerst nicht in die neue permanente Leiste übernommen. Sie können später permission-aware in den Launcher verschoben werden.
- Die neue Feldleiste liegt unter kontextuellen Area-/Street-/Mode-Sheets, damit diese bei aktiver Bearbeitung nicht überlagert werden.
- Das Plattform-Menü ist kein Fullscreen-Dashboard mehr, sondern ein abgerundetes modales Sheet mit Handle, Backdrop und Safe-Area-Abstand.
- Das Sheet zeigt große phone-style Icon-Flächen mit kurzem Label darunter.
- Launcher-Ziele: Karte, Stats, Team, Feedback, Smart, Einsätze sowie Admin-Aktionen für autorisierte Admins.
- Bestehende Plattformmodule und ihre Security-/Persistenzgrenzen bleiben unverändert.
- Auf sehr schmalen Geräten reduziert sich das Raster von vier auf drei Spalten; auf größeren Screens wird das Sheet zentriert.
- Reduced-Motion- und Touch-Ziel-Regeln bleiben erhalten.

## Akzeptanz

- Das alte Team-Dropdown ist in der komponierten Browse-Oberfläche nicht mehr permanent sichtbar.
- Die alte permanente untere Map-Toolbar ist aus der komponierten Browse-Oberfläche entfernt.
- Unten links bleiben nur Menü-Launcher und sichtbarer Teamname; Farbe allein reicht nicht als Teamkennzeichnung.
- Das Launcher-Symbol besteht sichtbar aus neun Punkten/Quadraten in einem 3x3-Raster.
- Das Menü wirkt wie ein Settings/Teams-Sheet und nicht wie ein Fullscreen-Dashboard.
- Icons stehen visuell über ihren kurzen Labels.
- Bestehende Plattformmodule bleiben erreichbar.
- Keine neue Dependency und keine Änderung an Worker/D1/MapLibre/PWA-Grenzen.

## Testabdeckung

`tests/platformLauncher.test.ts` schützt statisch:
- neun Elemente im 3x3-Launcher-Glyph;
- sichtbaren Teamnamen im Feld-Chrome;
- Positionierung der kompakten Feldleiste an der unteren Safe Area;
- ausgeblendete Legacy-Map-Toolbar im PlatformShell;
- Sheet-Struktur;
- Home-Screen-Labels Stats, Team und Feedback;
- vier Spalten im normalen mobilen Raster;
- Entfernung des alten Fullscreen-Menü-Fragetexts.

## Verifikation

Der ursprüngliche Plan-Head wurde erfolgreich über Tests, TypeScript, High-Severity Dependency Audit, Production Build und Cloudflare Workers Build verifiziert.

Die nachträgliche Platzierungskorrektur auf die untere Leiste wird erneut auf dem exakten finalen Branch-Head über dieselben Gates geprüft.

Preview Alias:
`https://ui-app-launcher-sheet-flyer-map.cloudflare-eleven035.workers.dev`

## Entscheidungen

- `PlatformShell` besitzt Menü-Trigger, Team-Kontext-Chrome und Launcher-Sheet. `App` bleibt für Karteninteraktion und bestehende Domain-Sheets zuständig.
- Der angezeigte Team-Kontext wird in diesem Slice aus dem autorisierten Team-Scope beziehungsweise dem ersten Campaign-Team abgeleitet. Eine spätere explizite Team-Wechseloberfläche muss diesen Kontext bewusst mit dem Karten-Arbeitskontext vereinheitlichen.
- Der Launcher ist ein Sheet, die geöffneten Fachmodule dürfen weiterhin eigene Fullscreen-Oberflächen sein.
- Permanentes Field-Chrome bleibt bewusst minimal. Zusätzliche Aktionen werden später permission-aware in den Launcher eingeordnet statt dauerhaft in die untere Leiste zurückzukehren.

## Nicht-Ziele

- neue Backend-Persistenz;
- Live-Group-Credentials;
- Accounts/TOTP/Capability-Runtime;
- neue persistierte Team-Auswahl;
- House-Map-Rendering.
