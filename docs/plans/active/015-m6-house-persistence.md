---
id: plan-015-m6-house-persistence
type: plan
status: active
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

Vor Migration 0005 bleiben Street-Snapshots vollständig lesbar/schreibbar. Sobald ein Snapshot oder eine Mutation eine House Task persistieren möchte, muss der Worker vor einer Revision-Übernahme sichtbar mit `schema_migration_required` ablehnen. House-Daten dürfen niemals still verworfen oder als Street gespeichert werden.

## Aufgaben

1. `HouseTask` mit Polygon-Geometrie, Status, optionaler Provenance und optionalem Parent modellieren.
2. `CampaignSnapshot.houseTasks` rückwärtskompatibel als optionale Collection ergänzen.
3. House-Geometrie serverseitig als validierten Polygon-Snapshot und OSM-Provenance mit genau einem Way validieren.
4. Optionalen `parentStreetTaskId` innerhalb derselben Campaign/Area auf eine Street Task begrenzen.
5. M5 House-Mutationen, Mutation-Diff und Immutability-Regeln ergänzen.
6. Additive Migration `0005_m6_house_tasks.sql` ergänzen.
7. CampaignRepository um House-Schema-Erkennung, Reads und atomare Snapshot-Persistenz erweitern.
8. Vor 0005 House-Writes sicher mit `schema_migration_required` blockieren.
9. Street-Progress und Street-Renderer unverändert auf `tasks` belassen, bis House-Progress/Rendering separat integriert wird.
10. Smart-Building-Kandidaten in persistierbare House-Task-Snapshots überführen.
11. Regressionstests für Domain, Validation, SQL/Persistence, Pre-Migration und Cross-Campaign/Parent-Referenzen ergänzen.
12. DATA/MAP/OFFLINE_SYNC/SECURITY, WORKBENCH, CURRENT und Context-Graph aktualisieren.
13. Tests, TypeScript, Dependency Audit, Build und Cloudflare Preview auf dem exakten Head prüfen.

## Akzeptanzkriterien

- House Tasks besitzen `task_<uuid>`-ähnliche anwendungs-eigene IDs und niemals OSM-IDs als Primäridentität.
- House Tasks speichern einen validierten Polygon-Snapshot.
- OSM-House-Provenance ist optional, inert und bei OSM genau ein positives Way-ID-Element.
- Optionaler Parent verweist nur auf eine Street Task derselben Campaign und desselben Areas.
- Street Tasks bleiben vollständig kompatibel und ihre bestehenden Map-/Progress-Pfade ändern sich nicht.
- M5 kann House Create/Rename/Status/Delete konflikt- und offline-fähig abbilden.
- House-Geometrie, Parent und Provenance sind nach Erstellung unveränderlich, bis ein späterer expliziter Reconciliation-Slice definiert wird.
- Ohne Migration 0005 werden House-Writes abgelehnt, ohne Revision oder Street-Daten zu verändern.
- Keine Remote-D1-Migration wird in diesem Slice automatisch ausgeführt.
- Keine neue Dependency, kein Service Worker, kein Manifest, keine PWA-Änderung.

## Risiken

- Snapshot-Replacement muss Street und House atomar behandeln, ohne House-Daten bei altem Schema zu verlieren.
- Parent-Referenzen dürfen keine Campaign-/Area-Grenzen umgehen.
- OSM-Gebäudegeometrie bleibt untrusted input und muss serverseitig validiert werden.
- Die optionale House-Collection darf von älteren lokalen Snapshots fehlen, ohne deren Laden zu brechen.

## Entscheidungen

- Separate additive House-Tabelle statt riskantem Rebuild der bestehenden Street-Tabelle.
- Separate Snapshot-Collection und Mutationstypen halten den Street-Renderer und Street-Progress in diesem Slice stabil.
- House und Street teilen weiterhin ID-, Status-, Scope- und Konfliktprinzipien.
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
