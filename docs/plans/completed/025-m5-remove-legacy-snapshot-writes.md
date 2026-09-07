---
id: plan-025-m5-remove-legacy-snapshot-writes
type: plan
status: completed
last_updated: 2026-09-01
related: [plan-m5-sync, plan-feature-complete-platform, architecture-data, architecture-offline-sync, architecture-security, quality, ADR-0022]
---

# Plan 025: M5 finaler Schreibvertrag ohne Legacy-Snapshot-Writes

## Ziel

Die M5-Transition endet mit einem eindeutigen Schreibvertrag: Snapshot bleibt Read Model und lokaler Cache, normale Änderungen laufen über explizite Mutationen, und der alte vollständige Snapshot-PUT kann keinen Serverzustand mehr verändern.

## Ausgangspunkt

- Branch: `plan-feature-complete-platform`;
- Draft PR #72 gegen `ui-app-launcher-sheet`;
- verifizierter Ausgangs-Head: `22a4d1b9da97f13c768e327a65bd143e11cafdc8`;
- CI-Ausgang: Workflow #819 erfolgreich;
- Remote-D1 bleibt ausschließlich bis Migration 0003 dokumentiert; keine Migration oder manueller Deploy ist Bestandteil dieses Plans.

## Umsetzung

1. Der Snapshot-PUT antwortet mit HTTP 410 und `legacy_snapshot_write_retired`, bevor Payload oder Access für einen Schreibversuch verarbeitet werden.
2. `replaceCampaignSnapshot` und der Client-Helper `putCampaignSnapshot` werden entfernt.
3. `POST /api/campaigns` nutzt `createInitialCampaignState` als Insert-only-Initialisierung mit Revision 0 und atomarer Child-Erzeugung. Bestehende Campaigns werden nicht ersetzt.
4. Der Store entfernt automatische Legacy-Recovery-PUTs. Bei einem Snapshot-Mismatch ohne ausstehende Queue speichert er die lokale Version als Konfliktkopie, übernimmt den kanonischen Serverzustand und zeigt den Konfliktzustand an.
5. Die vorhandenen Campaign-, Team-, Area-, Street-, House-, Collection- und Pickup-Aktionen bleiben auf den bestehenden M5- oder spezialisierten Mutationsverträgen. Es wird kein breiter Ersatzpfad ergänzt.
6. Repository-, HTTP- und statische Guard-Tests halten den neuen Vertrag fest.

## Akzeptanzkriterien

- keine Route schreibt mehr einen vollständigen Snapshot nach D1;
- `PUT /api/campaigns/:id/snapshot` liefert deterministisch 410 ohne Revision-Claim, D1-Batch oder Snapshot-Authorization;
- `POST /api/campaigns` erzeugt nur eine neue Campaign mit Revision 0 und scheitert bei bestehender Campaign ohne Lösch- oder Update-Operation;
- der Client enthält weder den Snapshot-PUT-Helper noch automatische Legacy-Recovery;
- ein leerer M5-Queue-Zustand macht den Server-Snapshot bei Konflikt kanonisch und bewahrt den lokalen Zustand in der bestehenden Konfliktablage;
- Tests, Typecheck, Dependency Audit und Production Build laufen auf dem resultierenden Branch-Head erfolgreich;
- keine Remote-Migration, kein Deploy, kein Merge und kein Ready-for-Review.

## Nicht-Ziele

- keine Änderung des Snapshot-Lesevertrags;
- keine neue Queue, Datenbank, Mutation-Domain oder Permission-Runtime;
- keine pauschale Migration alter lokaler Snapshots;
- keine Änderung an historischen Migrationen 0001 bis 0003 oder an vorbereiteten Migrationen 0004 bis 0014;
- keine automatische Reparatur oder Überschreibung kanonischer D1-Daten aus lokalem Cache.

## Übergabe

Nach dem Commit werden Branch-Head, PR #72 und CI auf exakt demselben SHA geprüft. Der endgültige Runtime-Checkpoint wird nur in CURRENT und diesem Continuation-Prompt eingetragen, wenn GitHub ihn tatsächlich meldet. Reale Android-/iPhone-Gates bleiben unabhängig von CI offen.
