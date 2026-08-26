---
id: plan-014-unified-platform-ui
type: plan
status: completed
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

## Architekturentscheidung

Gewählt wurde eine dünne Plattform-Hülle über den vorhandenen Modulen.

Datenfluss:

`PlatformShell -> Map Runtime oder Plattform-Modul -> vorhandene React-Komponenten/Domain-Modelle`

Die Plattform-Hülle führt keine neue Persistenz ein und umgeht keine Worker-Autorisierung.

Ein vollständiger Rewrite von `App.tsx` wurde verworfen, weil er Map-, M4- und M5-Runtime unnötig destabilisiert hätte.

## Umgesetzt

1. `PlatformShell` als normaler Website-Einstieg ergänzt.
2. Arbeitskarte bleibt dauerhaft gemountete primäre Feldoberfläche.
3. Gemeinsames Vollbild-Menü für Fortschritt, Aktivität/Einsätze, Smart Streets/Houses, Live Groups, Aktionen/Analyse, Support und Admin ergänzt.
4. Fortschritt verwendet den aktuellen Campaign-Snapshot statt Workbench-Fake-Daten.
5. Kommentare, Pickup und Field-Session-Komponenten zu einer integrierten Operations-Oberfläche verbunden.
6. Smart-Street-, Live-Group-, Action- und Admin-Workbench-Flächen in die normale Website-Navigation eingebettet.
7. Admin- und Actions-Einstieg nur bei aktuellem Campaign-Admin-Zugriff angezeigt.
8. Workbench-spezifische Header werden im integrierten Modus durch den gemeinsamen Plattform-Header ersetzt.
9. Direkte `?workbench=`-Routen bleiben für Entwicklung und Review erhalten.
10. Responsive, Safe-Area-fähige CSS-Hülle ohne neue Dependency ergänzt.
11. `docs/status/CURRENT.md` auf den neuen Runtime-Stand aktualisiert.

## Akzeptanz

Erfüllt:
- normale URL startet in der zusammenhängenden Plattform-UI;
- Karte bleibt Standardarbeitsbereich;
- vorhandene Plattform-Oberflächen sind ohne manuelles Query-Parameter-Wechseln erreichbar;
- laufender Map-Zustand bleibt beim Öffnen eines Moduls erhalten, weil die Map nicht unmountet wird;
- Admin-only Navigation wird aus dem aktuellen Access-State abgeleitet;
- keine neue Dependency;
- keine Service-Worker-, Manifest- oder PWA-Änderung;
- keine D1-Migration;
- keine Aktivierung von ADR-0014/0015/0016-Runtime.

## Verifikation

Exakter geprüfter Head vor Plan-Abschluss: `f9c0a5f947c61948c15cbd16df621bb6d468ca05`.

- GitHub CI: success
- zweiter Release/PR-CI-Lauf: success
- Cloudflare Workers Build: success
- Preview Alias: `https://release-platform-integration-2026-08-26-flyer-map.cloudflare-eleven035.workers.dev`
- immutable Preview: `https://d6022842-flyer-map.cloudflare-eleven035.workers.dev`

## Bewusste Grenzen

- Kommentare/Pickup/Field Sessions in der neu zusammengesetzten Operations-Oberfläche sind weiterhin lokale Foundation-Zustände, bis die dafür freigegebene Persistenz implementiert ist.
- Live-Group-Code/QR/Passwort bleibt durch ADR-0014 gegatet.
- Organization-Account/Passwort/TOTP bleibt durch ADR-0015 gegatet.
- Capability-Persistence bleibt durch ADR-0016 gegatet.
- House-Persistenz und Migration 0004 werden durch diesen UI-Slice nicht ausgerollt.
