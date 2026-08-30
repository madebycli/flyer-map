# Prompt: Continue Feature Complete Platform

Dieser Living Handoff gehört zur Plan-017-Linie. Repository, aktueller Branch-Head, PR und CI bleiben Source of Truth.

## Start für einen neuen Chat

```text
Du arbeitest weiter am GitHub-Projekt `madebycli/flyer-map`.

Lies zuerst vollständig:
1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`
4. `docs/plans/active/021-collection-pickup-persistence.md`

Nutze danach den Context-Graph ab `prompt-latest-feature-complete` und `plan-collection-pickup-persistence`. Lade insbesondere Data, Offline-Sync, Map, Security, Collaboration, Live-Teams, OSM und Quality.

Prüfe vor jeder Änderung lokalen Working Tree und Remote-Branch. Nichts blind resetten, verwerfen oder überschreiben.

Verifiziere Branch `plan-feature-complete-platform`, PR #72, Base/Head/Draft/Mergeability, exakten Head und CI auf exakt diesem Head gegen GitHub.

Keine Migration remote anwenden, nicht explizit deployen, nicht mergen, PR #72 nicht Ready setzen und keinen neuen Branch oder PR erstellen.
```

## Pre-FC5.2 Green Stabilization Checkpoint

Vor diesem Living-Docs-Commit wurde der begonnene FC5.2-Vorbereitungsstand wieder vollständig grün stabilisiert.

Ausgang:
- letzter stabiler FC5.1-Head: `79bd68a42d1a11bf5b79897d0f05894975f3c543`, CI #738 grün;
- gebrochener FC5.2-Vorbereitungs-Head: `5f533fb1403263aeec35312449afd2a9abaea169`, CI #743 fehlgeschlagen;
- Ursache #743: fehlende explizite `.ts`-Endung bei `./pickup` im Node-TypeScript-Testpfad plus alte Pickup-Foundation-Tests auf `address/note/sourceBuildingId` statt des neuen FC5.2-Draft-Vertrags.

Reparierter Code-Checkpoint vor Living Docs:
- `3f413791ec5063abed66eeb1a377bc48fc4c0e5d`;
- CI #754 auf exakt diesem Head grün;
- Test, Typecheck, Dependency Audit und Production Build alle erfolgreich.

Nach jedem Living-Docs-Commit GitHub erneut prüfen. Der ältere grüne Code-Checkpoint zählt nicht als CI-Nachweis für einen neueren Dokumentations-Head.

## Was bei der Stabilisierung geändert wurde

### Pickup Domain

Der neue FC5.2-Domainvertrag bleibt bestehen und wurde nicht zugunsten alter Foundation-Kompatibilität aufgeweicht:
- App-eigene Pickup-ID;
- `title` Pflicht;
- `address` Pflicht;
- echte Karten-`position` Pflicht;
- `description` separat;
- optionale Collection Area;
- optionale OSM-/Distribution-Provenance;
- Status `open`, `collected`, `unavailable`, `needs-follow-up`;
- Archivierung statt Hard Delete.

`src/domain/pickup.ts` validiert fehlende/manipulierte Pflichtfelder kontrolliert. OSM-Provenance bleibt Datenquelle/Provenance und ist keine Pickup-Identität. Der konkrete Geocoder-Provider wird in diesem Stabilisierungsslice nicht festgelegt.

`src/domain/collection.ts` importiert `./pickup.ts` explizit. `pickups` bleibt im gespeicherten `CollectionSnapshot` vorerst optional und wird über `collectionSnapshotOrEmpty()` additiv auf `[]` normalisiert, damit bestehende FC5.1-Snapshots gültig bleiben.

### Alte PickupPanel Foundation

`src/collection/PickupPanel.tsx` ist weiterhin nicht in den normalen App-/Collection-Produktgraphen verdrahtet. Sie wurde nur typkonsistent auf den neuen Domainvertrag gebracht:
- Titel/Adresse/Beschreibung statt `note`;
- Position als echter Prop-Vertrag;
- ohne Position kein Submit;
- kein `[0, 0]`-Fallback;
- kein neuer FC5.2-Produktflow.

### Tests

`tests/pickup.test.ts` wurde auf den neuen Vertrag migriert.

Zusätzlich:
- `tests/collectionPickupPreparation.test.ts` führt 0001 + 0010 + vorbereitete 0011 gegen echtes In-Memory-SQLite aus und prüft Default-Deny-Capabilities, Area-FK, Distribution-Unabhängigkeit, Campaign-Cascade, Archivierung und JSON-Array-Invarianten;
- `tests/pickupCommentPreparation.test.ts` prüft, dass lokale Pickup-Comment-Drafts nur auf existierende Pickup-IDs zeigen können und dass `pickup-task` am persistenten Comment-Boundary weiterhin abgelehnt wird.

### Migration 0008

`migrations/0008_comments.sql` wurde auf seinen bereits vorbereiteten FC2-Inhalt zurückgeführt.

Begründung:
- `docs/architecture/DATA.md` sagt ausdrücklich, historische Migrationen nicht umzuschreiben;
- Pickup-Kommentare sind noch kein fertiger Runtime-Slice;
- daher kein nachträgliches `pickup-task` in 0008.

`src/domain/commentDraft.ts` enthält `pickup-task` nur als Domain-Vorbereitung und validiert die konkrete Pickup-ID. `normalizeCommentTargetType("pickup-task")` bleibt `null`. Persistente Pickup-Kommentare benötigen später eine additive Forward Migration plus Worker-Autorisierung.

### Migration 0011

`migrations/0011_fc5_collection_pickups.sql` bleibt vorbereitet und nicht remote angewendet.

Korrigierte Invarianten:
- enge Collector-Capabilities `can_create_pickups`, `can_edit_pickups`, `can_assign_pickups`, Default `0`;
- kein ungültiges `ON DELETE SET NULL` auf `(area_id, campaign_id)`;
- Pickups besitzen keinen Distribution-FK;
- Distribution Delete darf Pickup nicht löschen;
- Campaign Delete darf Pickup per Cascade löschen;
- ein Area-gebundener Pickup verhindert Area Hard Delete;
- archivierter Pickup darf auch `collected` sein;
- Assignment-Felder müssen JSON-Arrays sein.

## Implementierter Feature-Stand

Umgesetzt:
- FC0 PlatformShell/App-Bridge und aktiver Teamkontext;
- Live Field Groups;
- durable Field Sessions;
- Comments für bestehende persistente Targets;
- bounded Activity;
- serverseitige Stats;
- deterministische/idempotente Automation;
- Plan 018 House Polygon Renderer;
- Plan 019 Smart Street Runtime;
- Plan 020 Smart House Runtime;
- FC5.1 First-Class Collection Access, Areas und Runs.

FC5.1 umfasst Collection-only QR Access, pro Gerät revocable Collector-Sessions, Main/Child Areas, Runs, Mehrgeräte-Join, manuelle Release-/Cancel-Flows und Admin force release.

## FC5.2 Status

FC5.2 ist **noch nicht als Runtime umgesetzt**. Es existieren nur stabilisierte vorbereitende Domain-/Schema-Bausteine.

Noch nicht implementieren/als fertig behaupten:
- Geo-/Adress-Provider Worker Proxy;
- API-Key Binding;
- Adress-Autocomplete;
- Pickup Worker CRUD;
- Pickup M5 Mutationen;
- normale Pickup UI;
- MapLibre Pickup Marker;
- persistente Pickup-Kommentare;
- Sonderadressen-Workflow;
- Assignment UI;
- Pickup Stats.

## FC5 verbindliche Produktgrenzen

Master hat **Ansatz A: First-Class Collection/Pickup** festgelegt.

- Collection und Distribution bleiben getrennte fachliche Datenwelten unter derselben Campaign;
- Distribution Delete verändert Collection nicht und umgekehrt;
- nur Campaign Delete darf beide gemeinsam entfernen;
- eigene Collection Main Area und Child Areas;
- eigene Collection Runs;
- eigene Collection Road Sections;
- eigene Pickup Tasks;
- Pickup kann ohne Distribution House existieren;
- OSM IDs sind nie Pickup-/Area-/Run-/Road-Primärschlüssel;
- temporäre Collector-Zugänge sind Collection-only;
- Collector Pickup-Sichtbarkeit Default `true`, create/edit/assign Default `false`;
- Worker bleibt authoritative Authorization Boundary;
- keine kontinuierliche GPS-Historie.

## D1 / Rollout

Remote D1 bleibt dokumentiert nur 0001 bis 0003.

Vorbereitet, aber nicht remote angewendet:
- 0004 Smart Street provenance;
- 0005 House Tasks;
- 0006 Field Groups/Credentials/Memberships;
- 0007 Field Sessions/Domain Events;
- 0008 Comments, unverändert ohne Pickup-Target;
- 0009 Automation-Konfiguration;
- 0010 Collection Access/Main/Child Areas/Runs/Collector-Sessions/Claim-Historie;
- 0011 Pickup-Schema und enge Collector-Capabilities, noch ohne Runtime-Verdrahtung.

## Sicherheits-/Architekturgrenzen

- gleicher Worker;
- gleiche D1;
- gleiche M5 IndexedDB Queue;
- gleiche MapLibre Engine;
- keine zweite Datenbank/Queue/Map Engine;
- keine neue allgemeine Identity-/Permission-Runtime;
- keine Secrets/Tokens in Client-Map-Properties oder Domain Events;
- keine PWA/Service Worker/Background Sync;
- keine kontinuierliche GPS-Historie;
- keine Preview-/Mock-Daten als Produktfeature;
- kein AI-/LLM-Routing.

## Nächster Auftrag

Erst nach erneuter Verifikation des aktuellen GitHub-Heads und grüner CI darf der eigentliche FC5.2-Runtime-Slice beginnen.

Dann vor dem ersten Runtime-Persistenzcommit:
1. aktuellen OSM-basierten Adressprovider gegen ToS, Rate Limits, Datenschutz, Attribution und Kosten prüfen;
2. bestehende Collection-only Access-, Sheet-, MapLibre- und M5-Mechanik wiederverwenden;
3. Pickup ohne Distribution House, Pflicht-Koordinaten, Archivierung und getrennte App-ID sicherstellen;
4. Pickup Worker/M5/Persistenz vertikal und fail-closed implementieren;
5. Pickup Comments über additive Forward Migration, nicht durch Umschreiben von 0008, ergänzen;
6. normalen Flow Suche -> Karte -> Pickup -> Status/Kommentar vollständig testen.

Keine Migration remote anwenden, keinen manuellen Deploy, nichts mergen, PR #72 nicht Ready setzen und keinen neuen Branch/PR erstellen.
