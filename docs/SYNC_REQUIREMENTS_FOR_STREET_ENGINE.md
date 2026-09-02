---
id: sync-requirements-for-street-engine
type: contract
status: required
last_updated: 2026-09-02
related: [ADR-0026, ADR-0021, plan-029-established-street-preparation-engine]
source_of_truth_for: [street-engine-sync-boundary, street-engine-feed-contract, street-task-identity]
---

# Sync Requirements for Street Engine

## Scope

Dieses Dokument ist der verbindliche Übergabevertrag zwischen der serverseitigen Street Engine und dem separaten RxDB-/D1-Feed-Workstream. Der Street-Engine-Branch ändert keine RxDB-, Change-Feed-, Durable-Object-, D1-Sync- oder Sync-Migrationsdatei.

## Engine output

Die Engine verarbeitet ausschließlich serverseitig geladene und normalisierte Straßen. Sie besitzt:

- OSM-Eligibility, inklusive expliziter Highway-Allowlist und Access-Blocklist;
- exaktes JSTS-Clipping gegen die gespeicherte Area-Geometrie;
- lineare Fragmentierung, deterministische Sortierung und fail-closed Topologiefehler;
- Source- und Fragment-Identität sowie die Algorithmusversion;
- Smart-Street-fähige, bereits geprüfte LineString-Geometrien.

Der Engine-Output ist eine deterministische Kandidatenliste:

- sourceOsmWayId: numerische OSM-Way-Provenance;
- sourceKey: stabile Identität des normalisierten Input-Ways vor dem Clipping;
- fragmentKey: stabile, richtungsinvariante Identität des geprüften Clipping-Fragments;
- label: aus name, ref oder dem festen Fallback Straße;
- geometry: ein vollständiges, geprüftes LineString-Fragment.

Der Engine-Output enthält noch keine Feed-Mutation, keinen Client-Status und keinen frei wählbaren Nutzer-Task. Diagnostics müssen mindestens die Algorithmusversion, Straßen-Eligibility, invalide Eingaben, Topologiefehler, Fragmentanzahl, Duplikate und die getrennten Road-/Building-Quellenmetriken enthalten.

## Versioned algorithm

Die aktuelle Street-Engine-Version lautet:

street-v2-jsts-2.12.1-turf-7.4.0

Jede Änderung an Clipping, Eligibility, Fragmentidentität, Smart-Street-Geometrie oder relevanter Normalisierung erhöht diese Version. JSTS 2.12.1 bleibt server-only. Turf wird modular importiert. Der Browser führt weder OSM-Fetch noch Street-Clipping aus.

## Canonical stable Task ID

Die app-owned automatische Street-ID ist generation-unabhängig und muss bytegenau mit diesem Vertrag berechnet werden:

1. Für ein LineString-Fragment werden die Vorwärtskoordinaten und die umgekehrte Koordinatenfolge als JSON serialisiert.
2. Die lexikographisch kleinere JSON-Repräsentation wird als coordinates gewählt.
3. Es wird geometryJson = JSON.stringify({ type: "LineString", coordinates }) gebildet.
4. Es wird exakt dieses Objekt mit exakt dieser Feldreihenfolge JSON-serialisiert:

{
  "namespace": "server-prepared-street-v1",
  "campaignId": campaignId,
  "areaId": areaId,
  "sourceOsmWayId": sourceOsmWayId,
  "geometry": geometryJson
}

5. Die ID ist task_auto_ plus der kleingeschriebene SHA-256-Hash der UTF-8-Bytes dieses Identity-JSON.

Die Preparation-Generation gehört absichtlich nicht in die ID. Ein gleicher Way und ein gleiches geprüftes Fragment behalten bei einer Reprepare dieselbe ID. OSM-Way-ID und Fragmentgeometrie sind Provenance beziehungsweise Identitätseingabe, nie ein vom Client wählbarer Task-Schlüssel.

## Generation and fingerprint

Der Area-Geometrie-Hash ist der SHA-256-Hash der kanonisch nach Schlüssel sortierten Area-Geometrie. Der versionierte Preparation-Fingerprint ist der SHA-256-Hash der UTF-8-Bytes von:

{
  "algorithmVersion": "street-v2-jsts-2.12.1-turf-7.4.0",
  "geometryHash": "..."
}

Eine andere gespeicherte Area-Geometrie oder Algorithmusversion erzeugt eine neue Generation. Ein veralteter Job darf weder Tasks noch Ready-State veröffentlichen. Derselbe Fingerprint ist idempotent und darf keinen Delete/Create-Churn erzeugen.

## Adapter ownership and reconcile delta

Der Sync-/D1-Adapter materialisiert aus jedem Kandidaten den kanonischen DistributionTask. Dabei gilt:

| Feldgruppe | Street Engine | Sync-/D1-Adapter | Nutzer/Client |
| --- | --- | --- | --- |
| ID, OSM-Provenance, Geometrie | erzeugt und validiert | transportiert/publiziert | nie gewählt |
| Generation, Preparation-Fingerprint | erzeugt und guarded | publiziert | nie gewählt |
| label, status, createdAt, completedAt | bei bestehender ID erhalten | bewahrt beim Upsert | user-owned |
| updatedAt | bei Serveränderung neu setzen | publiziert | nicht frei überschreiben |
| Tombstones | liefert zulässige Delete-Menge | publiziert atomar | nie frei erzeugt |

Der Reconcile-Plan liefert exakt die Deltas inserts, updates, deleteIds und unchangedIds sowie afterTasks für den resultierenden Snapshot.

Bei gleicher ID bleiben label, status, completedAt und createdAt unverändert. Bei neuer Servergeometrie, neuer Provenance oder neuer Generation wird genau ein update erzeugt und updatedAt auf den Serverzeitpunkt gesetzt. Wenn kein server-owned Feld geändert wurde, bleibt das bestehende Objekt bytegleich und erscheint nur in unchangedIds. Ein Update wird nicht als Delete plus Insert modelliert.

## Worked street policy

Es gilt Policy A: lock after work started.

Sobald in der betroffenen Area ein automatischer Street- oder House-Task nicht mehr open ist, ist eine automatische Neuvorbereitung für diese Area action-required und nicht retrybar. Das gilt für completed, later und not-deliverable. Der Worker darf keinen stale candidate veröffentlichen, keine Teilmenge veröffentlichen und keinen bearbeiteten automatischen Task löschen. Der Reconcile-Plan liefert stattdessen blocked-worked mit den betroffenen IDs. Eine neue Vorbereitung ist erst nach einer expliziten fachlichen Auflösung durch den autorisierten Produkt-/Sync-Flow zulässig. Dadurch entsteht keine nutzlose Retry-Schleife.

Eine obsolete offene automatische Street darf als Tombstone gelöscht werden. Manuelle Tasks und automatische Tasks anderer Areas bleiben unverändert.

## Overpass source isolation

Roads und Buildings werden als getrennte, serverseitig begrenzte Overpass-Phasen geladen. Road-Queries enthalten nur die Straßenklasse, Building-Queries nur die Gebäude-Klasse. Die Antworten werden getrennt normalisiert und erst danach für den atomaren Publish zusammengeführt. Shared concurrency, Aggregate-Byte-Budget, Einzelantwort-Byte-Budget und Feature-Limits bleiben wirksam.

Diagnostics und Fehler müssen unterscheiden:

- timeout;
- HTTP 429 beziehungsweise rate-limited;
- HTTP 5xx beziehungsweise server-error;
- einzelne Antwort zu groß;
- gemeinsames Aggregate- oder Package-Limit;
- Road-Normalisierung;
- Building-Volumen;
- Street-Topologie;
- guarded D1-Publish.

Ein Fehler in einer Phase veröffentlicht keine Teilmenge. Die Client-Map bleibt map-first und erhält erst nach einem vollständigen Ready-Publish normale persistente Street-/House-Tasks.

## Atomic publish

State-Claim, Campaign-Revision, Write-Token, Area-Geometrie, Generation und Pending-State werden gemeinsam guarded geprüft. Canonical Task Inserts, server-owned Updates, zulässige Tombstones, House-Tasks, Feed-Events und Ready-State müssen dieselbe atomare Transaktionsgrenze oder die bereits etablierte äquivalente Guarded-Publish-Grenze verwenden. Kein Feed-Event darf vor erfolgreicher State-Publikation sichtbar werden.

Nach einem erfolgreichen Commit darf der bestehende Campaign-/Sync-Invalidierungsweg auslösen. Vorher darf der Client weder Teilfragmente noch ready simulieren.

## Required integration changes for PR #74

Nach Übernahme der Street-Engine müssen im Sync-Branch:

1. die konkurrierende worker/serverPreparedStreetReconcile.ts entfernt oder durch den gemeinsamen Adaptervertrag ersetzt werden;
2. die lokale server-prepared-street-v1-Identitätsabweichung, insbesondere ein anderes Hashverfahren oder FNV-ID, entfernt werden;
3. die kanonische Implementierung worker/streetPreparation/reconcilePreparedStreetTasks.ts beziehungsweise deren bytegleiche Übernahme als einziger Street-Reconcile-Einstieg verwendet werden;
4. die Engine-Kandidaten sourceKey und fragmentKey in die kanonische DistributionTask-Materialisierung überführt werden;
5. D1-/Feed-Publikation, Tombstones, Generation Guards und RxDB-Replay auf die Deltas inserts, updates, deleteIds und unchangedIds ausgerichtet werden;
6. nur server-owned Felder bei einem bestehenden stabilen ID-Task aktualisiert werden, während Nutzerfelder erhalten bleiben;
7. Tests für stabile ID, neue Generation, user-owned Felder, updatedAt, no-churn, obsolete offene und worked automatische Tasks sowie atomaren Feed-Commit ergänzt werden.

## Planner prompt

Implementiere auf dem separaten RxDB-/D1-Sync-Branch die Integration aus docs/SYNC_REQUIREMENTS_FOR_STREET_ENGINE.md.

Prüfe zuerst den exakten aktuellen Head von PR #74 und den exakten übernommenen Street-Engine-Head. Entferne die konkurrierende worker/serverPreparedStreetReconcile.ts und jede lokale server-prepared-street-v1-Hashabweichung. Verwende die gemeinsame Reconcile-Semantik aus worker/streetPreparation/reconcilePreparedStreetTasks.ts als einzigen Street-Adapter-Einstieg.

Übernimm Kandidaten mit sourceKey, fragmentKey, sourceOsmWayId, label und geprüfter LineString-Geometrie. Materialisiere die kanonische ID exakt als task_auto_ plus lowercase SHA-256 über das festgelegte Identity-JSON. Bei gleicher ID bewahre label, status, completedAt und createdAt. Aktualisiere bei Serveränderung nur Geometrie, Provenance, Generation und updatedAt. Veröffentliche inserts, updates und zulässige Tombstones atomar unter der bestehenden D1-/Feed-Guard. Eine obsolete offene automatische Street darf gelöscht werden. Eine obsolete bearbeitete automatische Street löst Policy A action-required aus, ohne Retry-Schleife, ohne stale candidate und ohne Teilpublikation. Manuelle Tasks bleiben unverändert.

Ändere keine Street-Engine-Geometrie, keine Browser-Overpass-Schicht, keine OSM-Clientanfrage und keine D1-Migration ohne separaten autorisierten Auftrag. Liefere exakte Head-SHAs, exakte CI-/Feed-Tests und eine klare Aussage, dass keine echten Geräte getestet wurden, falls das weiterhin zutrifft.

## Non-goals

Dieser Branch implementiert keine RxDB-Collections, keine Change-Feed- oder Durable-Object-Änderung, keine D1-Sync-Migration, keine Produktionseinstellung, keinen Merge und kein Ready-for-Review.