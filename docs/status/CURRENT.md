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
- Plan 019 Smart Street Runtime: `docs/plans/completed/019-smart-street-runtime.md`.

Aktiver nächster FC4-Slice:
- Plan 020 Smart House Runtime: `docs/plans/active/020-smart-house-runtime.md`.

Plan 020 integriert echte vorbereitete OSM-Gebäudekandidaten in den normalen Area-/Street-Produktweg und enthält das Preview-/Schema-Gate-Hardening für bekannte unapplied Migrationen.

Aktiver Entwicklungsstack:
- Branch `plan-feature-complete-platform`;
- Draft PR #72 gegen `ui-app-launcher-sheet`;
- letzter vor Plan 020 exakt verifizierter Branch-Head: `fd333269eb40e0f32460328fa9b44e59a71afba0`;
- CI #706 war auf genau diesem Head vollständig grün mit Tests, TypeScript, Dependency Audit und Production Build;
- PR #72 war offen, Draft und mergeable.

Die Plan-020-Dokumentationscommits verschieben den Branch-Head. GitHub bleibt für den jeweils exakten Head und CI maßgeblich.

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

Persistierte Houses werden bereits über `vf-houses` mit festen MapLibre-Layern dargestellt. Der nächste fehlende normale FC4-Produktweg ist die Candidate-Auswahl und Erzeugung mehrerer echter House Tasks aus dem vorbereiteten Building-Paket.

Reale Android-/iPhone-Abnahme, Touch-Dichte und die endgültige `HOUSE_MIN_ZOOM`-Entscheidung bleiben offen. Ausgangswert bleibt 15.

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

1. Plan 020 im normalen Produkt umsetzen: Smart House Candidate Selection mit MapLibre, Einzel-/Mehrfachauswahl und bestehender House-Persistenz.
2. Bounded Mehrfachpersistenz sauber in den bestehenden M5-Pfad integrieren, ohne zweite Queue.
3. Preview-/Schema-Gates aus den Testseiten-Befunden regressionssicher machen, insbesondere den generischen Team-Hub-500.
4. Reale Android-/iPhone-Browserprüfung für House-/Street-Rendering, Touch-Hit-Test und Dense-Mobile-Verhalten offen halten, bis echte Geräte benutzt wurden.
5. PR #72 Draft und offen lassen. Keine Migration remote anwenden, nicht explizit deployen, nicht mergen und keinen neuen Branch oder PR erstellen.
