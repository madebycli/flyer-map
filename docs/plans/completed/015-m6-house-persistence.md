---
id: plan-015-m6-house-persistence
type: plan
status: completed
last_updated: 2026-08-26
related: [plan-012-platform-app-expansion, ADR-0013, architecture-data, architecture-map, architecture-offline-sync, architecture-security]
---

# Plan 015: M6 durable House persistence

## Ziel

Die bereits vorhandene Smart-House-Auswahl wird auf eine echte, offline-/sync-fähige House-Task-Domain vorbereitet. House Tasks erhalten anwendungs-eigene Task-IDs, persistierte Gebäude-Geometrie, optionale OSM-Provenance und optional einen Bezug zu einer Street Task. Bestehende Street Tasks, Renderer, Fortschrittsberechnung und M5-Synchronisation dürfen dabei nicht regressieren.

## Baseline / Source of Truth

- `AGENTS.md`
- `docs/status/CURRENT.md`
- `docs/status/WORKBENCH.md`
- `docs/context-map.yaml`
- `docs/plans/active/012-platform-app-expansion.md`
- `docs/decisions/ADR-0013-smart-street-house-identity.md`
- `docs/architecture/DATA.md`
- `docs/architecture/MAP.md`
- `docs/architecture/OFFLINE_SYNC.md`
- `docs/architecture/SECURITY.md`

## Relevante Context-Graph-Nodes

- `adr-smart-task-identity`
- `data`
- `map`
- `offline-sync`
- `security`
- `plan-platform-expansion`

## Architekturentscheidung

### Gewählt: additive `house_tasks`-Tabelle und separate House-Collection im Snapshot

Die bestehende `tasks`-Tabelle besitzt seit M3 einen festen `CHECK (task_type IN ('street'))` und wird heute direkt vom Street-Renderer, von Street-Statistiken und von bestehender M5-Logik verwendet. Statt diese etablierte Street-Domain in diesem Slice breit umzubauen, erhält M6 House eine separate additive `house_tasks`-Tabelle und `CampaignSnapshot.houseTasks`.

House Tasks benutzen weiterhin dieselben anwendungs-eigenen `task_<uuid>`-IDs, Statuswerte, Campaign-/Area-Scoping- und M5-Konfliktprinzipien wie Street Tasks. Die Mutation Queue erhält dafür eng begrenzte `house.create`, `house.rename`, `house.set-status` und `house.delete`-Operationen. Damit bleibt der bestehende Street-Pfad unverändert und House kann später bewusst in Renderer, Progress und History integriert werden.

Datenfluss:

`SmartBuildingCandidate -> HouseTask snapshot -> M5 house.create -> Worker validation/authorization -> house_tasks`

### Pre-Migration-Verhalten

Vor Migration 0005 bleiben Street-Snapshots vollständig lesbar/schreibbar. Sobald ein Snapshot oder eine Mutation eine House Task persistieren möchte, lehnt der Worker vor einer Revision-Übernahme sichtbar mit `schema_migration_required` ab. House-Daten werden niemals still verworfen oder als Street gespeichert.

## Umgesetzte Aufgaben

1. `HouseTask` mit Polygon-Geometrie, Status, optionaler Provenance und optionalem Parent modelliert.
2. `CampaignSnapshot.houseTasks` rückwärtskompatibel als optionale Collection ergänzt.
3. House-Geometrie serverseitig als Polygon-Snapshot und OSM-Provenance mit genau einem Way validiert.
4. `parentStreetTaskId` innerhalb derselben Campaign/Area auf eine Street Task begrenzt.
5. M5 House-Mutationen, Mutation-Diff und Immutability-Regeln ergänzt.
6. Additive Migration `0005_m6_house_tasks.sql` ergänzt.
7. CampaignRepository um House-Schema-Erkennung, Reads und atomare Snapshot-Persistenz erweitert.
8. Pre-0005 House-Writes mit `schema_migration_required` vor Revision-Claim blockiert.
9. Street-Progress und Street-Renderer unverändert auf `tasks` belassen.
10. Smart-Building-Kandidaten in persistierbare House-Task-Snapshots überführt.
11. Regressionstests für Domain, Validation, SQL/Persistence, Pre-Migration, Parent-Referenzen und Parent-Kaskade ergänzt.
12. DATA/MAP/OFFLINE_SYNC/SECURITY, WORKBENCH und CURRENT aktualisiert.
13. Context-Graph wird mit dem Abschluss dieses Plans auf die completed-Datei geroutet.

## Akzeptanzkriterien

- House Tasks besitzen anwendungs-eigene `task_*` IDs und niemals OSM-IDs als Primäridentität.
- House Tasks speichern einen validierten Polygon-Snapshot.
- OSM-House-Provenance ist optional, inert und bei OSM genau ein positives Way-ID-Element.
- Optionaler Parent verweist nur auf eine Street Task derselben Campaign und desselben Areas.
- Street Tasks bleiben vollständig kompatibel und ihre bestehenden Map-/Progress-Pfade ändern sich nicht.
- M5 kann House Create/Rename/Status/Delete konflikt- und offline-fähig abbilden.
- House-Geometrie, Parent und Provenance sind nach Erstellung unveränderlich, bis ein späterer expliziter Reconciliation-Slice definiert wird.
- Beim Löschen der Parent-Straße wird nur die optionale Parent-Beziehung auf `null` gesetzt. Der House-eigene `updatedAt` bleibt dabei unverändert und entspricht damit dem D1-`ON DELETE SET NULL`-Verhalten.
- Ohne Migration 0005 werden House-Writes abgelehnt, ohne Revision oder Street-Daten zu verändern.
- Keine Remote-D1-Migration wird in diesem Slice automatisch ausgeführt.
- Keine neue Dependency, kein Service Worker, kein Manifest, keine PWA-Änderung.

## Risiken und Absicherung

- Snapshot-Replacement behandelt Street und House in FK-sicherer Reihenfolge.
- Parent-Referenzen werden im Worker auf Campaign-/Area-Konsistenz geprüft.
- OSM-Gebäudegeometrie wird als untrusted input serverseitig validiert.
- Ältere lokale Snapshots dürfen `houseTasks` weiterhin auslassen.
- House-Renderer und kombinierter Street/House-Fortschritt bleiben bewusst getrennte Folgeslices, damit Polygon-Houses nicht versehentlich in den Street-LineString-Renderer geraten.

## Entscheidungen

- Separate additive House-Tabelle statt riskantem Rebuild der bestehenden Street-Tabelle.
- Separate Snapshot-Collection und Mutationstypen halten den Street-Renderer und Street-Progress stabil.
- House und Street teilen ID-, Status-, Scope-, Revision-, Idempotenz- und Konfliktprinzipien.
- House-Progress wird noch nicht in Street-Prozentwerte gemischt.
- Keine Remote-Migration in dieser Implementierungsarbeit.

## Nicht-Ziele

- Pickup Tasks in `house_tasks` speichern.
- Street/House-Aggregationsformel für gemeinsame Prozentwerte definieren.
- House-Map-Layer vollständig in die normale Feldkarte integrieren.
- Field-Session-Event-Persistenz implementieren.
- Live-Group-Credentials implementieren.
- Organization Accounts, TOTP oder Capability-Runtime implementieren.
- OSM-Refresh bestehender House-Geometrie automatisch übernehmen.

## Abschluss

Der Slice ist als Draft PR #70 gegen `release-platform-integration-2026-08-26` isoliert. Ein vollständiger Implementierungs-Head hat bereits Tests, TypeScript, Dependency Audit, Production Build und Cloudflare Workers Build bestanden. Für eine Zusammenführung zählt ausschließlich der abschließende PR-Head nach allen Code- und Doku-Änderungen; dieser muss dieselben Gates erneut grün bestehen.
