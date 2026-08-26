---
id: plan-014-unified-platform-ui
type: plan
status: active
last_updated: 2026-08-26
---

# Plan 014: Unified Platform UI

## Ziel

Die bisher getrennten Runtime- und Workbench-Oberflächen werden zu einer zusammenhängenden Website-UI verbunden. Die Karte bleibt die primäre Feldarbeitsfläche. Alle bereits vorhandenen Plattform-Module werden über eine gemeinsame Navigation erreichbar, ohne vorgeschlagene Security- oder Persistence-Runtimes vor ihren ADR-Gates zu aktivieren.

## Baseline / Source of Truth

- `AGENTS.md`
- `docs/status/CURRENT.md`
- `docs/context-map.yaml`
- `docs/product/UX.md`
- `docs/plans/active/012-platform-app-expansion.md`
- `src/App.tsx`
- `src/navigation/*`
- `src/workbench/*`

## Relevante Context-Graph-Nodes

- `ux`
- `roadmap`
- `map`
- `security`
- `collaboration`
- `live-teams`
- `identity-permissions`

## Architekturentscheidung

### Gewählt: eine dünne Plattform-Hülle über den vorhandenen Modulen

Die normale Website erhält eine globale Modulnavigation. Die bestehende Karten-Runtime bleibt für echte Campaign-Daten, Zugriff, Sync und Map-Interaktion zuständig. Vorhandene Workbench-Module werden als integrierte Oberflächen wiederverwendet und in der Plattform-Hülle ohne separate Query-Parameter erreichbar gemacht.

Datenfluss:

`PlatformShell -> Map Runtime oder Plattform-Modul -> vorhandene React-Komponenten/Domain-Modelle`

Die Plattform-Hülle führt keine neue Persistenz ein und umgeht keine Worker-Autorisierung.

### Verworfen: vollständiger Rewrite von `App.tsx`

Ein Komplettumbau würde Map-, M4- und M5-Runtime unnötig destabilisieren und mehrere bereits getestete Grenzen duplizieren.

## Aufgaben

1. Gemeinsame Plattform-Hülle und responsive Navigation ergänzen.
2. Arbeitskarte als Standardmodul integrieren.
3. UI/Progress/Support, Smart Streets, Live Groups, Actions/Analytics und Admin als Module in derselben Website erreichbar machen.
4. Workbench-spezifische Navigationshinweise im integrierten Modus visuell entfernen, Sicherheits-/Persistence-Hinweise aber erhalten.
5. Direkte `?workbench=`-Routen für Entwicklung und Review kompatibel lassen.
6. Navigation mobil als Bottom-Bar und Desktop als kompakte Seitenleiste ausführen.
7. Statusdokumentation und Context-Graph aktualisieren.
8. Tests, TypeScript, Build und Preview-CI auf dem exakten Branch-Head prüfen.

## Akzeptanzkriterien

- Die normale URL startet direkt in der zusammenhängenden Plattform-UI.
- Die Karte bleibt der erste und wichtigste Arbeitsbereich.
- Alle vorhandenen Plattform-Oberflächen sind ohne manuelles Ändern von Query-Parametern erreichbar.
- Auf kleinen Displays bleibt die Navigation touch-tauglich und verdeckt die Karte nicht dauerhaft.
- Auf Desktop steht eine kompakte, dauerhafte Modulnavigation zur Verfügung.
- Gegatete Features werden nicht als echte serverseitige Credentials, Accounts oder Permissions ausgegeben.
- Bestehende `?workbench=`-URLs funktionieren weiterhin.
- Keine neue Dependency.
- Keine Service Worker-, Manifest- oder PWA-Änderung.

## Risiken

- Zusätzliche UI-Hülle darf die Map-Höhe und Safe-Area nicht brechen.
- Workbench-Komponenten enthalten lokale Beispielzustände. Diese müssen als Foundation/Entwurf erkennbar bleiben.
- Admin-/Live-Group-Credentials dürfen durch die neue Navigation nicht versehentlich als produktive Runtime erscheinen.

## Entscheidungen

- Einfachste Integration statt Rewrite.
- Keine Änderung an D1-Schema oder Migrationsstatus.
- Keine Änderung an M4/M5-Autorisierungs- und Sync-Grenzen.
- Keine Aktivierung von ADR-0014/0015/0016-Runtime.

## Nicht-Ziele

- Organization-Account-Login implementieren.
- TOTP implementieren.
- Live-Group-QR/Room-Code implementieren.
- Capability-Persistence implementieren.
- House-Persistenz oder Migration 0004 remote ausrollen.
