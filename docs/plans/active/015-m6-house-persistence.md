---
id: plan-015-m6-house-persistence
type: plan
status: active
last_updated: 2026-08-26
related: [plan-012-platform-app-expansion, ADR-0013, architecture-data, architecture-map, architecture-offline-sync, architecture-security]
---

# Plan 015: M6 durable House persistence

## Ziel

Die bereits vorhandene Smart-House-Auswahl wird auf eine echte, offline-/sync-fähige House-Task-Domain vorbereitet. House Tasks erhalten anwendungs-eigene Task-IDs, persistierte Gebäude-Geometrie, optionale OSM-Provenance und optional einen Bezug zu einer Street Task. Bestehende Street Tasks und M5-Synchronisation dürfen dabei nicht regressieren.

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

### Gewählt: additive `house_tasks`-Tabelle, gemeinsame Task-Domain

Die bestehende `tasks`-Tabelle besitzt seit M3 einen festen `CHECK (task_type IN ('street'))`. Statt diese etablierte Tabelle destruktiv umzubauen, erhält M6 House eine separate additive `house_tasks`-Tabelle. Im Client-/Mutation-Modell erscheinen Street und House weiterhin als gemeinsame `DistributionTask`-Union, damit IDs, Status-Operationen, Offline-Mutationsqueue und spätere History dieselbe Task-Semantik nutzen können.

Datenfluss:

`SmartBuildingCandidate -> HouseTask snapshot -> M5 task.create -> Worker validation/authorization -> house_tasks`

Beim Laden führt der Worker Street- und House-Zeilen wieder in `CampaignSnapshot.tasks` zusammen.

### Pre-Migration-Verhalten

Vor Migration 0005 bleiben Street-Snapshots vollständig lesbar/schreibbar. Sobald ein Snapshot oder eine Mutation eine House Task persistieren möchte, muss der Worker vor einer Revision-Übernahme sichtbar mit `schema_migration_required` ablehnen. House-Daten dürfen niemals still verworfen oder als Street gespeichert werden.

## Aufgaben

1. `DistributionTask` als diskriminierte Street-/House-Union modellieren.
2. House-Geometrie als validierten Polygon-Snapshot und OSM-Provenance mit genau einem Way unterstützen.
3. Optionalen `parentStreetTaskId` validieren und innerhalb derselben Campaign/Area auf eine Street Task begrenzen.
4. M5 `task.create`, Mutation-Diff und Immutability-Regeln für House Tasks erweitern.
5. Additive Migration `0005_m6_house_tasks.sql` ergänzen.
6. CampaignRepository um House-Schema-Erkennung, Reads und atomare Snapshot-Persistenz erweitern.
7. Vor 0005 House-Writes sicher mit `schema_migration_required` blockieren.
8. Street-Progress weiterhin ausschließlich mit Street Tasks berechnen, bis House-Progress separat ausgewiesen wird.
9. Smart-Building-Kandidaten in persistierbare House-Task-Snapshots überführen.
10. Regressionstests für Domain, Validation, SQL/Persistence, Pre-Migration und Cross-Campaign/Parent-Referenzen ergänzen.
11. DATA/MAP/OFFLINE_SYNC/SECURITY, WORKBENCH, CURRENT und Context-Graph aktualisieren.
12. Tests, TypeScript, Dependency Audit, Build und Cloudflare Preview auf dem exakten Head prüfen.

## Akzeptanzkriterien

- House Tasks besitzen `task_<uuid>`-ähnliche anwendungs-eigene IDs und niemals OSM-IDs als Primäridentität.
- House Tasks speichern einen validierten Polygon-Snapshot.
- OSM-House-Provenance ist optional, inert und bei OSM genau ein positives Way-ID-Element.
- Optionaler Parent verweist nur auf eine Street Task derselben Campaign und desselben Areas.
- Street Tasks bleiben vollständig kompatibel.
- M5 kann House Create/Rename/Status/Delete wie andere Tasks konflikt- und offline-fähig abbilden.
- House-Geometrie, Parent und Provenance sind nach Erstellung unveränderlich, bis ein späterer expliziter Reconciliation-Slice definiert wird.
- Ohne Migration 0005 werden House-Writes abgelehnt, ohne Revision oder Street-Daten zu verändern.
- Keine Remote-D1-Migration wird in diesem Slice automatisch ausgeführt.
- Keine neue Dependency, kein Service Worker, kein Manifest, keine PWA-Änderung.

## Risiken

- Die gemeinsame Task-Union darf bestehende Street-only Renderer/Statistiken nicht versehentlich als House-fähig behandeln.
- Snapshot-Replacement muss Street und House atomar behandeln, ohne House-Daten bei altem Schema zu verlieren.
- Parent-Referenzen dürfen keine Campaign-/Area-Grenzen umgehen.
- OSM-Gebäudegeometrie bleibt untrusted input und muss serverseitig validiert werden.

## Entscheidungen

- Separate additive House-Tabelle statt riskantem Rebuild der bestehenden Street-Tabelle.
- Gemeinsame Task-IDs und M5-Mutationstypen bleiben erhalten.
- House-Progress wird noch nicht in Street-Prozentwerte gemischt.
- Keine Remote-Migration in dieser Implementierungsarbeit.

## Nicht-Ziele

- Pickup Tasks in `house_tasks` speichern.
- Street/House-Aggregationsformel für gemeinsame Prozentwerte definieren.
- Field-Session-Event-Persistenz implementieren.
- Live-Group-Credentials implementieren.
- Organization Accounts, TOTP oder Capability-Runtime implementieren.
- OSM-Refresh bestehender House-Geometrie automatisch übernehmen.
