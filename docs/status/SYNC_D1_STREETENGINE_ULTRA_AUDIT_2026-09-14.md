# Sync, D1 und StreetEngine Ultra Audit

Stand: 2026-09-14

Baseline: `unstable@35e9987efcf7a113a93df22b47f6f828cd0a4944`

Historischer Vergleich: `fix/live-map-sync-organizer-2026-09-10`

Status: **Phase 1 Audit. Keine Runtime-Änderung in diesem Commit.**

## Beweisregeln

- `PROVEN`: direkt aus aktuellem Source, vorhandenem Test oder exaktem historischen Diff nachgewiesen.
- `LIKELY`: Source-Reihenfolge ist riskant, aber der konkrete Fehler ist auf aktuellem HEAD noch nicht durch einen ausgeführten Regressionstest bewiesen.
- `HYPOTHESIS`: plausible Ursache, die noch gezielte Messung benötigt.
- `UNKNOWN`: Evidenz fehlt.

Keine lokale Shell-Testausführung ist Teil dieses Checkpoints. Die aktuelle Ausführungsumgebung konnte das Repository nicht per `git clone` erreichen. Spätere Verifikation muss über GitHub Actions oder eine andere tatsächlich ausführbare Umgebung erfolgen.

## 1. Executive Matrix

| Bereich | aktueller Zustand | Root Cause | Risiko | Ziel | Änderung | Beweis |
|---|---|---|---|---|---|---|
| Refresh vor Push-ACK | `refreshAndWait()` fragt den Server-Checkpoint ab, bevor bestehende `pendingPushProofs` sicher bestätigt sind | historische Push-Barriere aus `14046b1` fehlt | lokaler Write kann von älterem Pull überholt werden | harte Barrier vor Ziel-Checkpoint | Regression zuerst, dann zentraler Barrier im Sync-Coordinator | `PROVEN` für Reihenfolge und fehlende Barriere; aktueller sichtbarer Rollback bis Testlauf `LIKELY` |
| online/visibility refresh | `campaignStore` ruft `runtime.sync?.refresh()` direkt auf | alte `serverWritePending`/Write-Barrier aus `03d5a28` nicht mehr vorhanden | gleicher Race außerhalb manueller Syncs | alle externen Refresh-Trigger über Coordinator | keine zweite Wahrheit im Store, sondern Coordinator-API | `PROVEN` |
| WebSocket/Safety resync | WebSocket `changed` und Safety-Pfad können Pull anstoßen; Safety liest zuerst Head | Hint-Pfad kennt Pending-Write-Grenze nicht | stale Pull/unnötige D1-Reads | Hint nur invalidiert; Coordinator entscheidet sichere Runde | Barrier/round-aware invalidation | `PROVEN` |
| RxDB Konflikte | Server implementiert feldbezogene Three-Way-Prüfung; RxDB Default verwirft Fork bei ungelöstem Konflikt zugunsten Master | keine explizite Produktsemantik pro Feld im ADR | gleichzeitige Statusedits können still server-wins enden | explizite Konfliktmatrix | Status servergeordnet, unabhängige Felder mergebar, strukturelle Konflikte explizit | `PROVEN` für Code, Produktentscheidung offen |
| Delete Resurrection | Adapter lehnt Update gegen serverseitig gelöschtes Dokument mit `target_deleted` ab; echte Create ohne assumed master bleibt erlaubt | Create und stale Update werden unterschieden | alte Offline-Updates dürfen Delete nicht rückgängig machen | Tombstone/Generation bis alle relevanten Clients sicher neu bootstrappen können | Tests für Offline-Delete, Restart, stale push, compaction | Schutz im Adapter `PROVEN`; Ende-zu-Ende mit Feed-Compaction `UNKNOWN` |
| Area + StreetEngine | Base-Storage-Pfad erzeugt bei `area.create`/`area.update-geometry` eine neue Preparation-Generation und plant Runner, obwohl Legacy-Flag `AUTO_AREA_PREPARATION_ENABLED=false` bleibt | alter und neuer Lifecycle koexistieren | Dokumentation widerspricht Runtime; Resize-Races schwer nachvollziehbar | ein generation-basierter Lifecycle | Legacy-Flag/Docs bereinigen nach Regressionen | `PROVEN` |
| stale StreetEngine publish | Publish-Claim prüft Area-Existenz, exakte Geometrie, Generation, Status und Lease in derselben D1-Batch-Guard | vorhandene Guard-Architektur | alte Generation könnte nur bei Guard-Lücke gewinnen | alter Job darf nie nach neuer Geometry/Delete publizieren | Chaos-/Race-Regressionen, Guard beibehalten | Source-Guard `PROVEN`, vollständiger Race-Test noch nötig |
| Area delete | Base-Pfad löscht bounded Base/Overlay/Staging/Jobs/Preparation/canonical Task-Daten atomar mit Campaign-Write-Token | eigene kompakte Delete-Transaktion | Resurrection über alte Clients/Feed bleibt Restthema | Delete ist endgültige serverseitige Ordnungsentscheidung | stale-client Regression + Feed-Retention-Konzept | serverseitiges Cleanup `PROVEN`; vollständige Konvergenz `UNKNOWN` |
| Change Feed | `campaign_sync_changes` enthält Payload/Tombstones; `campaign_sync_heads` reduziert Head-Leseweg | keine nachgewiesene Retention-/Compaction-Policy auf aktuellem Auditpfad | unbegrenztes Wachstum, Altclient-Catchup | bounded retention + Full-Bootstrap-Grenze | min retained seq / bootstrap epoch / GC | `LIKELY`, repo-weite aktuelle GC-Suche noch als Implementierungsgate |
| D1 Budget | lokaler V6-Audit stark verbessert, aber echte Cloudflare `meta.rows_read/rows_written` für komplette Invocation fehlen | SQLite-Schätzung ist nicht Billing-Ground-Truth | falsche Free-Tier-Aussage | kleine isolierte Staging-Messung | erst nach expliziter Staging-Autorisierung | lokale Werte `PROVEN`, Livekosten `UNKNOWN` |
| D1 Invocation Limit | vollständige DO-Fixture lag lokal bei max. 48 D1 Queries/Invocation | nur 2 Queries Reserve zum Free-Limit 50 | Auth/Schema/unerwartete Pfade können Limit reißen | Ziel <=40 auf kritischen Invocations | Query-Inventar + echte Meta | `PROVEN` für lokale Fixture, Remote `UNKNOWN` |
| Admin Auth | Campaign-Admin Session 12h | fixer `ADMIN_SESSION_SECONDS` | tägliche Logins | kurze Access-Session + langlebiges rotierendes Device Credential | eigener Refresh-/Device-Session-Vertrag | `PROVEN` |
| Organizer Auth | Organization Session 12h | fixer `SESSION_SECONDS` | tägliche Logins | wie oben, mit MFA-Assurance | Rotation/Revocation/Replay Detection | `PROVEN` |
| normale Campaign Session | 30 Tage | eigener historischer Session-Vertrag | inkonsistente UX/Security-Semantik | vereinheitlichte Session-Familien | Migration ohne Token-Leak | `PROVEN` |
| Progress | D1 enthält Phase/Cursor/Metriken; Public State berechnet Prozent | Anzeige hängt weiter an Endpoint/Poll/Invalidation | stale UX, unnötige D1-Polls | DO/WebSocket Progress-Hints + kanonische Reconcile-Abfrage | Hint ist nie SoT | Datenpfad teilweise `PROVEN`, UX-Abbruchstelle `UNKNOWN` |

## 2. End-to-End-Sync-Karte

```text
React/UI
  -> Domain Mutation
  -> CampaignStore
  -> MissionRxdbSync.applyMutation()
  -> RxDB/Dexie lokale Collection
  -> RxDB Replication Push Queue
  -> /api/campaigns/:id/rxdb/push/:collection
  -> Worker Auth / resolveAccess
  -> handleRxdbPush
  -> deriveMutationFromRxdbWrite (Three-Way / assumed master)
  -> handleCampaignMutation
  -> Validation + Authorization + Mutation Ledger
  -> D1 guarded batch
  -> campaign_sync_changes + campaign_sync_heads
  -> DO WebSocket changed(seq) hint
  -> RxDB pull/checkpoint
  -> lokale RxDB Replica
  -> CampaignSnapshot Materialisierung
  -> React
  -> MapLibre / StreetEngine generation visibility
```

### Übergangsverträge

| Übergang | SoT / Besitzer | Ordnung / Idempotenz | Retry / Fehler | D1-Kosten-/Race-Hinweis |
|---|---|---|---|---|
| UI -> RxDB | lokale RxDB Replica | lokale RxDB-Reihenfolge | sofort lokal sichtbar | keine D1-Kosten |
| RxDB -> Push | RxDB Replication | assumedMasterState + newDocumentState | RxDB Retry | Pending Proof existiert clientseitig, aber Refresh-Barrier fehlt aktuell |
| Push -> Domain Mutation | Worker/D1 | Mutation-ID; Server prüft aktuelle kanonische Felder | Konflikt liefert Master/Rejection | Snapshot/Schema/Auth Reads pro Push |
| Mutation -> D1 | D1 | Campaign revision + write token + mutation ledger | idempotente Mutation-ID | Batch muss Query-Limit einhalten |
| D1 -> Feed | D1 | monotone `seq` | atomar mit Domain-Write | Payload wird im Feed gespeichert |
| Feed -> DO | D1 bleibt SoT | Hint darf duplicate/out-of-order sein | Verlust durch Safety Pull heilbar | DO soll keine kanonischen Dokumente halten |
| Pull -> RxDB | D1/Feed | Checkpoint pro Collection | RxDB retry | alter Pull darf Pending Local Intent nicht sichtbar zurücksetzen |
| RxDB -> React | lokale Replica | RxDB change stream | Collection-Fehler derzeit teilweise gemeinsam orchestriert | UI-Flackern ist P0-Symptom |
| Area -> StreetEngine | D1 Area + gewünschte Generation | geometry fingerprint + generation + lease | Runner retry/alarm | derived data; stale publish muss Guard verlieren |

## 3. P0: Refresh-Ordering

### Aktueller Code

`MissionRxdbSync.refreshAndWait()` macht aktuell:

1. `requestCheckpoint()`
2. `refresh()` / `reSync()`
3. wartet, bis alle Collection-Checkpoints das vorher gelesene Ziel erreichen.

Die Methode wartet **nicht** zuerst auf bereits akzeptierte lokale `pendingPushProofs`.

Der historische Commit `14046b10be88f8aef3a33f59ed1f7f6e3a42e5ce` hatte genau dafür `waitForPendingPushes()` eingeführt: Persistence Gates flushen, Push-Beweise abwarten, erst dann Server-Checkpoint bestimmen und pullen.

Der historische Regressionstest aus `102516f8ac1a1e403cb7244d3746d0b3f4e21572` existiert auf dem aktuellen `unstable` nicht mehr.

**Klassifikation:**

- fehlende Barriere: `PROVEN`
- Regressionstest verloren: `PROVEN`
- aktueller sichtbarer Rollback bis zur erneuten Testausführung: `LIKELY`

### Bessere Implementierungsform als blindes Cherry-Pick

Nicht `campaignStore.serverWritePending` als zweite Sync-Wahrheit wieder einführen. Die Barriere gehört in `MissionRxdbSync` bzw. einen zentralen Sync-Coordinator.

Eine manuelle Sync-Runde sollte einen **Watermark** erfassen:

```text
round N close
-> campaign/team debounce gates flush
-> merke höchste Push-Proof-Generation, die zu N gehört
-> warte nur auf Proofs <= Watermark
-> request canonical server checkpoint
-> pull bis Ziel erreicht
-> Round N = converged
-> neue lokale Edits gehören bereits Round N+1
```

Nur auf `pendingPushProofs.size === 0` zu warten wäre langfristig zu grob: bei kontinuierlichen neuen Edits könnte eine manuelle Barriere unnötig nie fertig werden.

## 4. Konfliktsemantik

Der aktuelle Adapter ist bereits besser als globales Document-LWW:

- Campaign Name und Default Map View werden getrennt geprüft.
- Team Name und Farbe können feldweise rebased werden.
- Area Name, Team und Geometry werden als getrennte Felder geprüft, Compound Changes werden abgelehnt.
- Street/House Status und Label werden getrennt geprüft.
- strukturelle Server-owned Felder wie Network/Position/Preparation Generation dürfen der Client nicht überschreiben.
- Update gegen gelöschtes Ziel wird als `target_deleted` abgelehnt.

### Zielmatrix

| Mutation | Semantik | Begründung |
|---|---|---|
| Street/House Status | servergeordnetes LWW pro Statusfeld **oder** expliziter Konflikt bei langer Offline-Divergenz; Produktentscheidung erforderlich | Status ist ein einzelner Benutzerintent, kein CRDT nötig |
| Label/Name | property-level optimistic concurrency | unabhängige Felder dürfen parallel überleben |
| Area Team | optimistic concurrency | fachliche Zuordnung, nicht blind überschreiben |
| Area Geometry | `baseVersion`/expected generation, struktureller Konflikt | Derived Data hängt daran |
| Delete | serverseitig finale Tombstone-/Generation-Entscheidung | keine Resurrection |
| Kommentare/Text mit echter Co-Editing-Anforderung | erst dann CRDT/Yjs/Automerge prüfen | heutige Domain rechtfertigt globale CRDT-Komplexität nicht |

RxDBs Default Conflict Handler nimmt bei ungelöstem Konflikt den Master und verwirft den Fork. Deshalb muss ein fachlich wichtiger Statuskonflikt diagnostizierbar sein und darf nicht wie erfolgreicher Sync aussehen.

## 5. StreetEngine als Derived Data

Der aktuelle Base-Storage-Pfad modelliert bereits wesentliche Teile einer Generation:

```text
Area geometry + algorithm version
-> geometry fingerprint
-> area_task_preparations.generation = pending
-> street_network_jobs(generation, lease)
-> bounded phases
-> guarded publish
-> street_base_areas/chunks + overlays
-> generationState im RxDB Pull
```

### Positive Invarianten im aktuellen Source

- Runner lädt genau den aktuellen Preparation-State und die kanonische Area.
- Fingerprint-Mismatch markiert die Preparation stale/failed.
- Publish-Claim prüft Area-Existenz, exakte Geometry, gewünschte Generation, Status und bei laufender Preparation die Lease.
- Area Delete im Base-Pfad räumt Base, Overlay, Staging, Jobs, Preparation, House/Task-Daten und die Area unter demselben Campaign Write Token auf.
- Benutzerarbeit an prepared Entities wird in Overlays erhalten.

### Noch fehlende harte Lifecycle-Semantik

Der gewünschte Zustand sollte explizit modelliert werden:

```text
desired -> building -> published -> obsolete -> deleted
```

`generation` allein ist fast ausreichend, aber der Vertrag muss in ADR und Tests festhalten:

1. Nur die aktuell gewünschte Generation darf publizieren.
2. Delete invalidiert jede laufende Generation endgültig.
3. Resize erzeugt eine neue gewünschte Generation.
4. Eine alte Generation kann nach Resize/Delete keinen Write Token gewinnen.
5. Ein Offline-Client kann eine gelöschte Area nicht durch ein Update wiederherstellen.
6. Recreate derselben ID ist entweder verboten oder benötigt eine neue Entity-Epoch.

Für sichere Resurrection-Verhinderung nach zukünftiger Feed-Compaction ist eine `entity_epoch`/Tombstone-Epoch robuster als unendlich lange Feed-Tombstones.

## 6. Area Resize

### Shrink

Vollständiges blindes Neu-Erzeugen und Löschen aller alten IDs ist nicht akzeptabel, weil Benutzerstatus/History verloren gehen könnten.

Empfehlung:

- neue Geometry -> neue Preparation Generation
- neue Base generation-basiert berechnen
- Stable IDs aus stabiler OSM-/Segment-Identität ableiten oder deterministisch reconciliieren
- auto-generierte, nun außerhalb liegende **unbearbeitete** Entities aus sichtbarer Base entfernen
- bearbeitete entfernte Entities als historisches/archiviertes Overlay erhalten, nicht still löschen
- manuelle Streets/Houses getrennt behandeln
- Publish atomar von alter auf neue sichtbare Generation umschalten

### Expansion

Standardempfehlung: vollständige neue Area vorbereiten und serverseitig gegen bestehende IDs/Overlays reconciliieren. Nur Geometry-Differenz zu rechnen ist billiger, aber OSM-Straßen/Relationen an der alten Grenze machen den Algorithmus wesentlich komplexer und fehleranfälliger. Erst bei gemessenem Kostenproblem sollte inkrementelle räumliche Differenz als Optimierung eingeführt werden.

## 7. Change Feed

Aktuell:

- `campaign_sync_changes`: geordnete `seq`, Collection, document id, scope, JSON payload/tombstone.
- `campaign_sync_heads`: per-Collection Head vermeidet `MAX(seq)` auf neuem Base-Schema.
- Pull liest Delta zwischen Checkpoint und High Water.
- kompakter Writer kann mehrere Documents in einer JSON-Payload bündeln.

Offen:

- sichere Retention/GC ist im bisher geprüften aktuellen Pfad nicht nachgewiesen.
- ohne `min_retained_seq` kann ein sehr alter Client nicht erkennen, ob sein Checkpoint noch bedienbar ist.
- Payload und Routing-Metadaten sind gekoppelt; für sehr große Feeds kann das unnötige Read-Bytes verursachen.

Ziel:

```text
campaign_sync_heads
campaign_sync_retention(min_seq, bootstrap_epoch)
campaign_sync_changes(seq, routing metadata, optional compact payload)
```

Wenn `clientCheckpoint < min_seq`, gibt der Server explizit `bootstrap_required` zurück. Tombstones dürfen erst compaction-fähig werden, wenn Resurrection durch Entity-Epoch/Serverregeln ausgeschlossen bleibt.

## 8. D1 Budget

### Offizielle Grenzen, geprüft am 2026-09-14

Cloudflare dokumentiert für Workers Free/D1:

- 5.000.000 rows read pro Tag
- 100.000 rows written pro Tag
- 50 D1 Queries pro Worker Invocation
- 500 MB maximale DB-Größe im Free-Tier

Seit 2026-09-01 werden die Free-Tier-Tageslimits für Rows Read/Written hart erzwungen. Bei Überschreitung schlagen Queries bis zum täglichen Reset fehl.

Quellen:

- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/changelog/2026-09-01-d1-free-plan-limits/

### Lokaler aktueller Street-Budget-Stand

`docs/architecture/STREET_D1_BUDGET.md` zeigt nach dem Storage Pivot unter Full Schema u.a.:

| Häuser | Preparation estimated reads | Preparation total write estimate | Status estimated reads | Delete estimated reads |
|---:|---:|---:|---:|---:|
| 400 | 198 | 139 | 123 | 132 |
| 1.000 | 208 | 155 | 123 | 140 |
| 5.000 | 300 | 316 | 123 | 160 |
| 10.000 | 413 | 532 | 126 | 192 |

Zusätzlich: vollständige DO-Budgetfixture max. **48 Queries/Invocation**.

Diese Zahlen sind **keine Cloudflare-Billing-Messung**. Sie stammen aus dem lokalen SQLite/Budget-Adapter.

### Vorläufige Kostenrechnung, nur Modell

Bei 20 aktiven Clients und einem Safety-Checkpoint alle 120s entstehen 14.400 Checkpoint-Aufrufe/Tag, wenn alle 24h aktiv wären. Schon bei nur 100 echten `rows_read` pro kompletter authentifizierter Invocation wären das 1,44 Mio Reads/Tag allein für Safety. Bei 350 Rows wären es 5,04 Mio und damit bereits über Free.

Das zeigt: Request-Frequenz ist genauso P0 wie SQL-Form. Ein WebSocket-Hint plus sehr seltene Safety-Recovery ist wirtschaftlich sinnvoller als häufiges Polling pro Client.

### Free-Tier-Urteil

`UNKNOWN` in Phase 1.

Ein ehrliches `D1_FREE_TIER_FEASIBLE[_WITH_LIMITS]` oder `NOT_FEASIBLE` benötigt echte `meta.rows_read`/`meta.rows_written` für eine **komplette** authentifizierte Invocation. Der aktuelle Audit dokumentiert ausdrücklich, dass diese Remote-Metadaten noch fehlen. Ohne explizite Staging-Autorisierung wird keine Remote-D1-Messung ausgelöst.

## 9. Auth

### Ist

- normale Campaign Session: 30 Tage
- Campaign Admin Account Session: 12 Stunden
- Organization/Organizer Account Session: 12 Stunden
- Cookies sind `HttpOnly`, `Secure`, `SameSite=Lax`; Organization nutzt `__Host-` Cookie.
- Sessions sind serverseitig gehasht und Admin/Organization Sessions können widerrufen werden.
- Organization unterstützt MFA/TOTP und Recovery Codes.

### Ziel

Kein 1-Jahr-Access-Cookie.

Empfohlenes Modell:

```text
Access session: 8-12h
Remember-device refresh family: z.B. 60 Tage idle, 90 Tage absolut
-> bei jeder Nutzung rotieren
-> nur Hash serverseitig speichern
-> alte Token-ID nach Rotation ungültig
-> Replay eines alten Tokens widerruft die ganze Device-Familie
-> Password reset/change, account disable, membership/grant revoke invalidieren Familien
-> Logout current / logout all devices
-> MFA assurance getrennt von Refresh-Lifetime
```

Unsafe Requests bleiben same-origin und brauchen explizite CSRF-Bewertung. `SameSite=Lax` allein ist kein vollständiges CSRF-Design-Dokument.

## 10. Progress

Serverseitig existieren bereits:

- Phase
- Cursor
- total tiles
- completed road/building tiles
- processed/total buildings
- Prozent
- Quality/Failure Diagnostics

`getAreaTaskPreparationPublicState()` liest Preparation + Street Job und berechnet Progress. Damit liegt das aktuelle Problem wahrscheinlich zwischen Endpoint-Frequenz, Invalidation und UI-Materialisierung, nicht in fehlenden Metriken.

Ziel:

- D1 bleibt kanonisch.
- Runner emittiert best-effort kleine Progress-Hints über den bestehenden Campaign-DO/WebSocket.
- Client nutzt Hints für UX, aber nach Reconnect/Hint-Verlust wird einmal kanonisch reconciled.
- keine hochfrequenten D1-Polls pro Client nur für Prozentanzeige.

**Klassifikation der konkreten UI-Abbruchstelle:** `UNKNOWN`, gezielter UI/Endpoint-Test folgt.

## 11. Referenzarchitekturen

| System | lokale Writes | Server-Reihenfolge | Konfliktstrategie | Change Feed | Realtime | Offline | Übertragbarkeit |
|---|---|---|---|---|---|---|---|
| RxDB | sofort lokale Replica | Backend-Checkpoint | assumed master + client conflict handler; Default nimmt Master | backend-definiert | pull stream / RESYNC | ja | direkte Basis; Default-Konfliktverhalten muss bewusst überschrieben/diagnostiziert werden |
| Linear | lokale DB | ordered immutable sync-action IDs | serverautoritativ, Delta replay | Workspace sync-action log | ja | ja | sehr passend für monotone Campaign seq + Delta Sync; deren extreme Scale nicht kopieren |
| Figma | lokale Property sofort | Server definiert Reihenfolge | property-level; unacked lokale Property schützt vor älterem eingehendem Wert | WAL/journal + seq/checkpoint | WebSocket | ja | Flacker-Schutz und serverseitige Ordnung direkt relevant; Grafik-CRDT-Komplexität nicht nötig |
| Replicache | optimistic Mutations | Server führt Mutation IDs geordnet aus | Pull rewinds canonical state und replays pending mutations | cookie + patch + lastMutationID | contentless poke | ja | Sync-Rounds/Rebase-Modell sehr passend |
| Firestore | lokaler Cache | Backend | LWW bei mehreren Änderungen am selben Dokument | intern | listener | ja | bewusst einfaches Gegenmodell; für strukturelle Area/Derived-Data-Konflikte zu grob |
| CouchDB | lokale DB | `_changes` sequence | revision/conflicts | `_changes` | continuous feed | ja | Checkpoint/duplicate-idempotency nützlich; Datenmodell nicht 1:1 übernehmen |
| ElectricSQL | lokale DB / Shapes | Server/Postgres Stream | systemabhängig | logical stream/shape | stream | ja | Partial Sync/Shapes als Denkmuster, aber keine Migration rechtfertigt neuen Stack |
| CRDT/Yjs/Automerge | lokal first | keine zentrale Ordnung nötig | mathematisch mergebar | operation/state sync | typischerweise ja | ja | nur für echte kollaborative Text/Set-Probleme; für Status/Area unnötige Komplexität |

Quellen:

- RxDB replication: https://rxdb.info/replication.html
- Linear delta sync: https://linear.app/now/rebuilding-delta-sync-read-path
- Figma multiplayer: https://www.figma.com/blog/how-figmas-multiplayer-technology-works/
- Figma reliability/WAL: https://www.figma.com/blog/making-multiplayer-more-reliable/
- Replicache: https://doc.replicache.dev/concepts/how-it-works
- Firestore offline: https://firebase.google.com/docs/firestore/manage-data/enable-offline
- CouchDB changes: https://docs.couchdb.org/en/stable/api/database/changes.html

## 12. Priorität

### P0

1. Refresh/Push-Ordering Regression wiederherstellen und auf aktuellem HEAD ausführen.
2. Zentralen Push-Proof Barrier einbauen, nicht Store-Doppelzustand.
3. Two-/Three-Client same-entity und different-field Konflikte deterministisch testen.
4. Delete + Offline Client + active StreetEngine + stale generation testen.
5. Change-Feed Retention/Bootstrap-Grenze explizit definieren.
6. vollständige D1 Invocation instrumentieren, Remote nur nach Staging-Autorisierung.

### P1

1. generation lifecycle für create/resize/delete dokumentieren und härten.
2. Progress Hints über DO, D1 nur kanonische Reconcile-Abfrage.
3. Admin/Organizer Remember-Device Refresh Families.
4. per-Collection Sync Health statt ein globales unpräzises „Sync hängt“.

### P2

1. Feed GC/Compaction.
2. strukturierte Sync-Diagnoseexporte.
3. Query-Reserve von max. 48 Richtung <=40 senken.
4. 20k lokale Chaos-/Performance-Matrix.

## 13. Nächste Implementierungsreihenfolge

1. Regression `refresh overtakes push` auf aktuellem Code wiederherstellen.
2. Regression erwartungsgemäß rot bzw. reproduzierbar machen.
3. `MissionRxdbSync` Barrier/Watermark implementieren.
4. online/visibility/manual/WebSocket/Safety auf Coordinator-Semantik vereinheitlichen.
5. Fokus-Suite und gesamte CI.
6. danach Area Delete/Resize/Generation Chaos-Tests.
7. erst anschließend Auth/Progress/Feed-Compaction in getrennten Commits.

Keine Production-Aktion. Keine Remote-Migration. Keine große Staging-Fixture.
