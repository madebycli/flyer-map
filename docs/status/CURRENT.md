---
id: status-current
type: status
status: active
last_updated: 2026-08-30
---

# Current Project State

## Product baseline

Verteil-Flyer ist eine mobile-first normale Website.

Technischer Kern:
- React, TypeScript und Vite;
- MapLibre GL JS 5.7.1 für die Feldkarte;
- Cloudflare Workers und D1 für Shared Runtime und Persistenz;
- M4 Access/Session, M5 resiliente Mutation-Synchronisierung und M5.5 vorbereitete Offline-Kartendaten bleiben etablierte Grundlagen.

Weiterhin ausgeschlossen:
- native App Runtime;
- installierbare PWA;
- Service Worker;
- Web App Manifest;
- Background Sync;
- kontinuierliche GPS-Historie.

## Active delivery

Plan 017 bleibt die übergeordnete Feature-Complete-Delivery-Linie.

Abgeschlossen:
- Plan 018 House Polygon Renderer: `docs/plans/completed/018-house-polygon-renderer.md`;
- Plan 019 Smart Street Runtime: `docs/plans/completed/019-smart-street-runtime.md`;
- Plan 020 Smart House Runtime: `docs/plans/completed/020-smart-house-runtime.md`.

Aktueller FC4-Stand:
- Plan 020 integriert echte vorbereitete OSM-Gebäudekandidaten in den normalen Area-/Street-Produktweg;
- bekannte unapplied Schema-Stände sind als spezifische fail-closed Zustände dokumentiert und getestet.

Aktiver Entwicklungsstack:
- Branch `plan-feature-complete-platform`;
- Draft PR #72 gegen `ui-app-launcher-sheet`;
- zuletzt vor Plan 021 verifizierter Branch-Head: `7c38830cbf94129ff4cb3e1a97ab73fd9b5a605c`;
- CI #712 war auf genau diesem Head vollständig grün mit Tests, TypeScript, Dependency Audit und Production Build;
- PR #72 war offen, Draft und mergeable.

Der nachfolgende Dokumentationscommit verschiebt den Branch-Head. GitHub bleibt für den jeweils exakten Head und CI maßgeblich.

## Implementierter Plattformstand

Auf PR #72 sind die aktuellen Runtime-Slices für folgende Bereiche umgesetzt:
- FC0 PlatformShell/App Navigation und aktiver Teamkontext;
- Team Hub und Live Field Groups;
- Field Sessions und Einsatzhistorie;
- durable Comments für Campaign, Area, Street Task und persistierte House Tasks;
- bounded Activity-Projektion aus `domain_events`;
- erste feste deterministische und idempotente Automation gemäß ADR-0019;
- echte serverseitige Stats-Projektion mit getrennten Street-/House-Nennern;
- normaler Smart-Street-Flow aus vorbereitetem OSM-Paket;
- normaler Smart-House-Flow aus vorbereiteten OSM-Gebäudekandidaten;
- persistierter House-Polygon-Renderer mit House-Auswahl und House-Session-Highlight.

Der redundante Launcher-Eintrag „Karte“ ist entfernt. Das Menü bleibt über X und Tap außerhalb des Sheets schließbar.

## FC4 checkpoint

Smart Street ist im normalen Produktweg umgesetzt:
- echte Straßen-Candidates aus dem validierten `OfflineMapPackage`;
- MapLibre-Kandidaten, Snap, Start/Ende, Zwischenpunkte und explizite Ambiguitätsauflösung;
- persistente App-ID und OSM nur als Provenance;
- bestehender M5-Pfad;
- manuelles Street-Drawing als Fallback;
- keine Preview-/Mock-Straßen im Produktionsgraphen.

Persistierte Houses werden über `vf-houses` mit festen MapLibre-Layern dargestellt. Smart House ist im normalen Produktweg umgesetzt:
- echte Building-Candidates kommen aus dem vorbereiteten und validierten `OfflineMapPackage`;
- MapLibre verwendet eine gebatchte Candidate-Source mit festen Fill-/Outline-/Selected-Layern;
- Einzel-, Mehrfach- und gebundene Straßen-Auswahl werden vor der Bestätigung reviewt;
- bestätigte Houses erhalten App-eigene IDs und laufen über die bestehende M5-Queue;
- ein Street-Parent wird nur aus einem expliziten Street-Kontext gesetzt.

Reale Android-/iPhone-Abnahme, Touch-Dichte und die endgültige `HOUSE_MIN_ZOOM`-Entscheidung bleiben offen. Ausgangswert bleibt 15.

## FC5 planning checkpoint

Plan 021 `docs/plans/active/021-collection-pickup-persistence.md` ist als reiner Architektur- und Dokumentationsplan aktiv. Pickup bleibt im normalen Produktweg noch nicht implementiert. `src/domain/pickup.ts` und `src/collection/PickupPanel.tsx` bleiben eine Foundation ohne Snapshot-, M5-, Worker- oder D1-Anbindung. Die Architekturentscheidung A oder B sowie die markierten UNKLAR-Fragen stehen vor jedem Pickup-Runtime-Commit noch aus.

## Preview / D1 schema state

Dokumentierter Remote-D1-Stand bleibt nur Migration 0001 bis 0003.

Vorbereitet, aber nicht remote angewendet:
- 0004: Smart Street provenance;
- 0005: House Tasks;
- 0006: Field Groups, Credentials, Memberships und FC1 Idempotency;
- 0007: Field Sessions und minimierte Domain Events;
- 0008: durable Comments und Comment-Tombstones;
- 0009: deterministische Automation-Konfiguration.

Daraus sind auf der Cloudflare-Testseite vor dem Rollout bestimmte fail-closed Meldungen erwartbar:
- Smart-Street-Source-Writes benötigen 0004;
- House-Writes benötigen 0005;
- Team Hub / Live Field Groups benötigen 0006;
- Einsätze und Aktivität benötigen 0007;
- Kommentare benötigen 0008;
- Automationen benötigen 0009.

Die beobachteten expliziten 0007-/Kommentar-Schemahinweise sind daher erwartete Rollout-Gates und kein Nachweis eines fehlenden Runtime-Features. Ein beobachteter generischer `Serveranfrage fehlgeschlagen (500)` im Team Hub ist dagegen für einen bekannten fehlenden 0006-Schema-Stand nicht ausreichend und wird in Plan 020 reproduziert und gehärtet. Keine Migration wird dafür als Diagnosewerkzeug remote angewendet.

## Security and performance boundaries

Weiterhin verbindlich:
- Worker bleibt authoritative Authorization Boundary;
- IDs sind Selektoren, keine Credentials;
- keine neue Permission- oder Identity-Runtime;
- keine Secrets, Tokens oder unnötigen Domain-Daten in Renderer-Properties;
- persistierte House-Geometrie wird von MapLibre gerendert, nicht pro House durch React, SVG oder Canvas;
- Smart-House-Candidates verwenden ebenfalls feste Sources/Layer statt Layer oder DOM-Nodes pro Gebäude;
- keine `setData()`-Arbeit auf Pan/Zoom/Rotate;
- Dense-House-Daten und echte Mobile-Geräte bleiben Quality-Gates.

## Immediate next

1. Plan 021 als Architekturgrundlage für FC5 prüfen und die offene Entscheidung A oder B durch Master festlegen, bevor Pickup-Runtime entsteht.
2. Reale Android-/iPhone-Browserprüfung für House-/Street-Rendering, Touch-Hit-Test und Dense-Mobile-Verhalten durchführen, sobald echte Geräte verfügbar sind.
3. Remote-D1-Stand und vorbereitete Migrationen unverändert dokumentieren, bis eine ausdrücklich freigegebene Rollout-Entscheidung vorliegt.
4. PR #72 offen und Draft lassen. Keine Migration remote anwenden, nicht explizit deployen, nicht mergen und keinen neuen Branch oder PR erstellen.
