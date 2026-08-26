---
id: plan-016-app-launcher-sheet
type: plan
status: completed
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
- `src/platform/PlatformShell.tsx`
- `src/platform/platform-shell.css`

## Umsetzung

- `PlatformShell` rendert oben links eine kompakte weiße Feldleiste mit einem echten 3x3-App-Raster-Glyph und Team-Farbpunkt/Teamname.
- Die Legacy-`map-toolbar` mit permanentem Team-Dropdown, Settings-, Teams- und Draw-Area-Buttons bleibt nur als Übergangscode in `App`, wird in der komponierten Plattformansicht aber nicht gerendert.
- Das Plattform-Menü ist kein Fullscreen-Dashboard mehr, sondern ein abgerundetes modales Sheet mit Handle, Backdrop und Safe-Area-Abstand.
- Das Sheet zeigt große phone-style Icon-Flächen mit kurzem Label darunter.
- Launcher-Ziele: Karte, Stats, Team, Feedback, Smart, Einsätze sowie Admin-Aktionen für autorisierte Admins.
- Bestehende Plattformmodule und ihre Security-/Persistenzgrenzen bleiben unverändert.
- Auf sehr schmalen Geräten reduziert sich das Raster von vier auf drei Spalten; auf größeren Screens wird das Sheet zentriert.
- Reduced-Motion- und Touch-Ziel-Regeln bleiben erhalten.

## Akzeptanz

- Das alte Team-Dropdown ist in der komponierten Browse-Oberfläche nicht mehr permanent sichtbar.
- Die alte permanente untere Map-Toolbar ist aus der komponierten Browse-Oberfläche entfernt.
- Oben links bleiben nur Menü-Launcher und Team-Kontext.
- Das Launcher-Symbol besteht sichtbar aus neun Punkten/Quadraten in einem 3x3-Raster.
- Das Menü wirkt wie ein Settings/Teams-Sheet und nicht wie ein Fullscreen-Dashboard.
- Icons stehen visuell über ihren kurzen Labels.
- Bestehende Plattformmodule bleiben erreichbar.
- Keine neue Dependency und keine Änderung an Worker/D1/MapLibre/PWA-Grenzen.

## Testabdeckung

`tests/platformLauncher.test.ts` schützt statisch:
- neun Elemente im 3x3-Launcher-Glyph;
- vorhandenen Team-Kontext;
- ausgeblendete Legacy-Map-Toolbar im PlatformShell;
- Sheet-Struktur;
- Home-Screen-Labels Stats, Team und Feedback;
- vier Spalten im normalen mobilen Raster;
- Entfernung des alten Fullscreen-Menü-Fragetexts.

## Verifikation

Implementierungs-/Dokumentations-Head vor Archivierung: `30a7358e34ec02b01d60b2d7ce9260da6863823f`.

Auf diesem Head erfolgreich:
- Tests;
- TypeScript;
- High-Severity Dependency Audit;
- Production Build;
- Cloudflare Workers Build.

Cloudflare Version ID: `124a97be-c13a-4929-9c68-234110be6d6a`.

Preview Alias:
`https://ui-app-launcher-sheet-flyer-map.cloudflare-eleven035.workers.dev`

Die nachfolgende Plan-Archivierung ist dokumentarisch und wird auf dem finalen Branch-Head erneut durch CI/Cloudflare verifiziert.

## Entscheidungen

- `PlatformShell` besitzt Menü-Trigger, Team-Kontext-Chrome und Launcher-Sheet. `App` bleibt für Karteninteraktion und bestehende Domain-Sheets zuständig.
- Der angezeigte Team-Kontext wird in diesem Slice aus dem autorisierten Team-Scope beziehungsweise dem ersten Campaign-Team abgeleitet. Eine spätere explizite Team-Wechseloberfläche muss diesen Kontext bewusst mit dem Karten-Arbeitskontext vereinheitlichen.
- Der Launcher ist ein Sheet, die geöffneten Fachmodule dürfen weiterhin eigene Fullscreen-Oberflächen sein.

## Nicht-Ziele

- neue Backend-Persistenz;
- Live-Group-Credentials;
- Accounts/TOTP/Capability-Runtime;
- neue persistierte Team-Auswahl;
- House-Map-Rendering.
