---
id: sync-requirements-for-street-engine
type: contract
status: required
last_updated: 2026-09-02
related: [ADR-0026, ADR-0021, plan-029-established-street-preparation-engine]
source_of_truth_for: [street-engine-sync-boundary, street-engine-feed-contract]
---

# Sync Requirements for Street Engine

## Scope

Dieses Dokument ist der Übergabevertrag zwischen der serverseitigen Street Engine und dem separaten RxDB-/D1-Feed-Workstream. Dieser Street-Engine-Branch ändert keine RxDB-, Change-Feed-, Durable-Object-, D1-Sync- oder Sync-Migrationsdatei.

## Input

Der Sync-Adapter erhält ausschließlich serverseitig erzeugte, bereits validierte und auf genau eine Campaign/Area/Generation bezogene Daten:

- `campaignId`, `areaId`, `areaPreparationGeneration` und der versionierte Preparation-Fingerprint.
- Vollständige kanonische Prepared-Street-Kandidaten mit stabiler app-owned `id`, `taskType: street`, `geometry`, Label, OSM-Provenance und Server-Timestamps.
- Den vorhandenen Campaign-Snapshot oder die serverseitig geladene Menge automatischer Street Tasks für diese Area.
- Den Reconcile-Plan mit `inserts`, `deleteIds`, `unchangedIds` und optionalem `worked-conflict`-Block.

Der Client liefert keine OSM-Geometrie, keine frei wählbare Query und keinen eigenen Generation- oder Task-Identitätswert.

## Output

Bei Erfolg veröffentlicht der Adapter eine idempotente, vollständige Generation in der bestehenden Campaign-State- und Feed-Semantik:

- Insert/Upsert der neuen stabilen automatischen Street Tasks.
- Tombstones für zulässige obsolete offene automatische Street Tasks.
- Keine Änderung an manuellen Tasks.
- Keine Änderung an Status, Label, `createdAt` oder `completedAt` eines bereits vorhandenen stabilen automatischen Tasks.
- Ein Feed-Ereignis oder ein äquivalenter Snapshot-Stand, der dieselbe Generation vollständig und in deterministischer Reihenfolge repräsentiert.

Ein `worked-conflict` ist ein harter, retrybarer fachlicher Fehler. Er darf keine Teilmenge veröffentlichen und darf keinen bearbeiteten automatischen Task löschen.

## Ownership

| Feld | Server Street Engine | Sync-/Feed-Adapter | Nutzer/Client |
| --- | --- | --- | --- |
| Task-ID | erzeugt und unveränderlich | transportiert | nie geändert |
| OSM-Provenance | erzeugt und validiert | transportiert | nicht als Identität verwendet |
| Geometrie | kanonisch erzeugt und validiert | transportiert | nicht automatisch umgeschrieben |
| Generation/Fingerprint | erzeugt und guarded | veröffentlicht | nicht gewählt |
| Status/Label/createdAt/completedAt | bei bestehender ID erhalten | erhält beim Upsert | nutzer-owned |
| Tombstones | liefert zulässige Delete-Menge | veröffentlicht atomar | nicht frei erzeugt |

## Atomicity

Die bestehende D1-Guard muss Campaign-Revision, Write-Token, Area-Geometrie, Generation und Pending-State gemeinsam prüfen. Canonical Task Writes, zulässige Tombstones, Change-Feed-Events und Ready-State müssen dieselbe atomare Transaktion oder die bereits etablierte äquivalente Guarded-Publish-Grenze verwenden. Kein Feed-Event darf vor erfolgreicher State-Publikation sichtbar werden.

Ein neuer oder verzögerter Job darf eine neuere Generation nie überschreiben. Ein Retry mit identischem Fingerprint muss keine Delete/Create-Churn erzeugen.

## Post-Commit

Erst nach erfolgreichem Commit darf der Worker die Generation als `ready` markieren und den bestehenden Campaign-/Sync-Invalidierungsweg auslösen. Der Client darf dann den Snapshot lesen und die vorbereiteten Straßen map-first anzeigen. Vorher darf er weder Teilfragmente noch `ready` simulieren.

## Tests für die Sync-Integration

- gleicher Input zweimal: gleicher Task-ID-Satz, keine unnötigen Deletes/Inserts;
- veränderte Area oder Algorithmus-Version: neue Generation, alte Generation kann nicht publishen;
- geänderter OSM-Way: nur betroffene offene automatische Tasks ändern;
- obsolete offene automatische Task: Tombstone erlaubt;
- obsolete bearbeitete automatische Task: harter Conflict, kein Delete;
- manuelle Task in gleicher Area: unverändert vorhanden;
- zwei autorisierte Geräte: gleicher finaler Snapshot und keine Client-seitige OSM-Anfrage;
- Feed-Replay und Retry: idempotent, keine halbe Generation;
- Feed-/State-Commit nach Fehler: keine sichtbaren Teilpublikationen.

## Planner prompt

Implementiere die Sync-Integration für `docs/SYNC_REQUIREMENTS_FOR_STREET_ENGINE.md` auf dem separaten RxDB-/D1-Sync-Branch. Prüfe zuerst den exakten aktuellen Head und die vorhandene `serverPreparedStreetReconcile`-Semantik. Übernimm stabile Prepared-Street-IDs, feldweise Ownership, Tombstones für offene obsolete automatische Tasks und harte worked-conflicts. Führe State- und Feed-Publikation unter der bestehenden guarded atomic boundary aus. Ändere keine Street-Engine-Geometrie, keine Browser-Overpass-Schicht und keine manuellen Tasks. Liefere exakte Head-SHAs, Tests und eine klare Aussage, dass keine echten Geräte getestet wurden, falls das nicht möglich war.
