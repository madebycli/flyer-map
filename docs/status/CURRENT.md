---
id: status-current
type: status
status: active
last_updated: 2026-08-29
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

Plan 018 ist als implementierter House-Renderer-Checkpoint abgeschlossen:
`docs/plans/completed/018-house-polygon-renderer.md`.

Plan 019 ist der nächste implementierte normale FC4-Vertical-Slice:
`docs/plans/completed/019-smart-street-runtime.md`.

Aktiver Entwicklungsstack:
- Branch `plan-feature-complete-platform`;
- Draft PR #72 gegen `ui-app-launcher-sheet`;
- letzter vor Plan 019 verifizierter Runtime-Head: `9477e1d15aada83db145cd9dd27b10a152cd13f7`;
- CI #704 war auf genau diesem Head vollständig grün mit Tests, TypeScript, Dependency Audit und Production Build;
- PR #72 war offen, Draft und mergeable.

Der Plan-019-Commit verschiebt den Branch-Head. GitHub bleibt für den exakten finalen Head und CI maßgeblich; die aktualisierten Werte werden nach diesem Commit erneut eingetragen.

GitHub und der aktuelle Branch-Head bleiben Source of Truth. Nach jedem neuen Commit muss CI erneut auf genau diesem neuen Head geprüft werden.

## Implementierter Plattformstand

Auf PR #72 sind die aktuellen Runtime-Slices für folgende Bereiche umgesetzt:
- FC0 PlatformShell/App Navigation und aktiver Teamkontext;
- Team Hub und Live Field Groups;
- Field Sessions und Einsatzhistorie;
- durable Comments für Campaign, Area, Street Task und persistierte House Tasks;
- bounded Activity-Projektion aus `domain_events`;
- erste feste deterministische und idempotente Automation gemäß ADR-0019;
- echte serverseitige Stats-Projektion mit getrennten Street-/House-Nennern.

Der redundante Launcher-Eintrag „Karte“ ist entfernt. Das Menü bleibt über X und Tap
außerhalb des Sheets schließbar.

## Smart Street runtime checkpoint

Der normale Area-Flow unterstützt für berechtigte Nutzer die Auswahl realer Straßen aus
dem bereits vorbereiteten Offline-OSM-Paket:
- `smartCandidatesForArea()` liefert nur Kandidaten aus dem geladenen, validierten
  `OfflineMapPackage` für das aktive Gebiet;
- MapLibre rendert Kandidaten, Auswahl, Vorschau sowie Start-, Ende- und Zwischenpunkte
  über feste gebatchte Sources/Layer;
- reale Kartenklicks werden mit `queryRenderedFeatures()` auf Straßenkandidaten gesnappt;
- Mehrfachtreffer und gleich kurze alternative Routen werden explizit im mobilen Sheet
  gelöst, nicht geraten;
- die bestätigte Geometrie wird als normale `DistributionTask` mit App-ID und OSM-
  Provenance über den bestehenden M5-Mutationspfad gespeichert;
- manuelles Einzeichnen bleibt als Fallback sichtbar;
- `M6SelectionPreview.tsx` und Preview-/Mock-Daten bleiben außerhalb des Produktionsgraphen.

Der Runtime-Code ist entwickelt und getestet. Remote bleibt Migration 0004 unangetastet;
der Worker verweigert Source-Writes ohne `source_json` weiterhin ausdrücklich mit
`schema_migration_required`.

## House renderer checkpoint

Der aktuelle Runtime-Slice rendert persistierte House Tasks im normalen MapLibre-Browse-Renderer.

Umgesetzt:
- `CampaignSnapshot.houseTasks` und `HouseTask.geometry` werden über `src/map/houseRenderer.ts` in eine gebatchte `vf-houses`-GeoJSON-Source überführt;
- `Feature.id` und `properties.houseTaskId` bleiben die stabile App-House-ID, OSM bleibt ausschließlich Provenance;
- Renderer-Properties sind auf `houseTaskId`, `status` und Team-`color` begrenzt;
- feste House-Layer zeigen Fläche, Status-Outline, Auswahl und Session Highlight, ohne House-spezifische Layer oder DOM-Nodes;
- normale House-Layer liegen unter den Street-Layern, `HOUSE_MIN_ZOOM` startet bei 15;
- House-Klicks verwenden `queryRenderedFeatures` auf `vf-houses-fill` mit kleinem Touch-Hitbox und der Reihenfolge Street, House, Area;
- Area-, Street- und House-`setData()` sind getrennt, Auswahl und Session Highlight setzen nur Filter;
- echte `houseTaskIds` laufen durch den vorhandenen Field-Session-Highlight-Pfad, inklusive House-only Sessions;
- `?diag=1` zeigt Source-/sichtbare House-Zahlen.

Noch offen:
- reale Android-/iPhone-Browserprüfung der Touch-Dichte und des endgültigen House-`minzoom`;
- finale Geräte- und Dense-Mobile-Abnahme für den gesamten FC4-Weg.

Der bestehende Street-Renderer bleibt unverändert und darf nicht zu einer gemischten riskanten `vf-tasks`-Source umgebaut werden, solange dafür kein nachgewiesener Bedarf besteht.

## D1 rollout status

Dokumentierter Remote-Stand bleibt nur Migration 0001 bis 0003.

Vorbereitet, aber nicht remote angewendet:
- 0004: Smart Street provenance;
- 0005: House Tasks;
- 0006: Field Groups, Credentials, Memberships und FC1 Idempotency;
- 0007: Field Sessions und minimierte Domain Events;
- 0008: durable Comments und Comment-Tombstones;
- 0009: deterministische Automation-Konfiguration.

Der House-Renderer-Slice benötigt keine neue Migration und darf keine vorbereitete Migration remote anwenden.

## Security and performance boundaries

Weiterhin verbindlich:
- Worker bleibt authoritative Authorization Boundary;
- IDs sind Selektoren, keine Credentials;
- keine neue Permission- oder Identity-Runtime im Renderer-Slice;
- keine Secrets, Tokens oder unnötigen Domain-Daten in Renderer-Properties;
- persistierte House-Geometrie wird von MapLibre gerendert, nicht pro House durch React, SVG oder Canvas;
- feste kleine Source-/Layer-Anzahl statt Layer oder DOM-Nodes pro House;
- `GeoJSONSource.setData()` nur bei echten Domain-Datenänderungen, nicht bei Auswahl, Session-Filtern, Pan, Zoom oder Rotate;
- Dense-House-Daten müssen auf realistischen mobilen Geräten geprüft werden.

## Immediate next

1. Smart House Candidate Selection in den normalen Area-/Street-Kontext integrieren.
2. Reale Android-/iPhone-Browserprüfung für House-/Street-Rendering, Touch-Hit-Test und
   Dense-Mobile-Verhalten durchführen.
3. TypeScript, Dependency Audit, Production Build und den vollständigen `check`-Flow auf
   dem jeweils exakten GitHub-Head verifizieren.
4. PR #72 Draft und offen lassen.
5. Keine Migration remote anwenden, nicht explizit deployen, nicht mergen und keinen
   neuen Branch oder PR erstellen.
