# Sync, D1 und StreetEngine Ultra Audit

Stand: 2026-09-14

Baseline: `unstable@35e9987efcf7a113a93df22b47f6f828cd0a4944`

Audit-Branch: `audit/sync-d1-streetengine-ultra-2026-09-14`

Verifizierter Phase-A-Head: `d276ccdd6c2350997d3fdd377fb28824e56fd88d`

Status: **Ordering-P0 Phase A implementiert und CI-verifiziert. Gesamtauftrag weiter offen. Keine Production-Aktion.**

## Beweisregeln

- `PROVEN`: direkt aus aktuellem Source, vorhandenem Test oder ausgeführter CI nachgewiesen.
- `LIKELY`: Source ist riskant, aber der konkrete Fehler noch nicht reproduziert.
- `HYPOTHESIS`: plausible Ursache, die gezielte Messung benötigt.
- `UNKNOWN`: Evidenz fehlt.

Lokales `git clone` war in der Ausführungsumgebung nicht verfügbar. Verifikation erfolgt deshalb über exakte GitHub-Commits und GitHub Actions. Kein lokaler Testlauf wird als Ersatz behauptet.

## 1. Executive Matrix

| Bereich | Zustand | Evidenz / Root Cause | Status |
|---|---|---|---|
| Refresh vor Push-ACK | Baseline konnte Checkpoint/Pull vor bereits akzeptiertem lokalen Push abschließen | historischer Regressionstest auf aktuellem Baseline-Code wiederhergestellt; CI `34865295021` rot mit `refresh must not report current while the local write is still waiting for its push gate` | **PROVEN P0, Phase A behoben** |
| automatische Refreshes | globaler Barrier war zu grob und blockierte unabhängige Collections | CI `34866065831` scheiterte an `a retryable Team push does not block an independent Street pull` | **PROVEN Designfehler, verworfen** |
| collection-aware Barrier | `refresh(names)` blockiert nur Collections mit eigenem pending push proof; sichere Collections re-syncen sofort | Head `d276ccdd...`, CI `34867857864` komplett grün | **PROVEN** |
| explizite Konvergenz | `refreshAndWait()` wartet Phase A auf alle bereits akzeptierten Mission-Writes, dann liest es den Ziel-Checkpoint | historischer Ordering-Test + vollständige CI grün | **PROVEN** |
| RxDB Konflikte | feldbezogene Three-Way-Prüfung, server-owned Struktur geschützt | `rxdbMutationAdapter` Tests für unabhängige Felder, same-field conflict, timestamp drift | **PROVEN** |
| Delete Resurrection | Update gegen serverseitig gelöschtes Ziel wird `target_deleted`; echtes Create ohne assumed master bleibt getrennt | Adapter-Test vorhanden | **PROVEN auf Mutationsebene** |
| Lost ACK | erneuter Push nach bereits committed Mutation erzeugt keinen zweiten Domain-Effekt/Feed-Eintrag | `rxdbP0Semantics` | **PROVEN** |
| Actor Offline Isolation | Field Group A Offline-Intent bleibt actor-scoped und wird nicht von B hochgeladen | `rxdbP0Semantics` | **PROVEN** |
| Multi-Tab Leader | ein Replication Leader; Handover dupliziert Write nicht | bestehender Test | **PROVEN** |
| Area + StreetEngine | Base-Storage-Pfad erzeugt bei Area create/geometry update neue Preparation-Generation und plant Runner, obwohl Legacy-Flag `AUTO_AREA_PREPARATION_ENABLED=false` bleibt | aktueller Source | **PROVEN, Dokumentations-/Lifecycle-Schuld offen** |
| stale StreetEngine publish | Publish guard prüft Area, exakte Geometry, Generation, Status und Lease | Persistence/ChunkPersistence Source | **PROVEN im Guard, E2E-Chaos offen** |
| Area delete | Base-Pfad räumt Base/Overlay/Staging/Jobs/Preparation/Task-Daten atomar unter Campaign Write Token | Mutation Repository | **PROVEN serverseitig, Offline-End-to-End offen** |
| Change Feed Retention | geordneter Feed und Heads vorhanden; Retention/GC noch nicht repo-weit final bewiesen | nächste Auditphase | **OPEN** |
| D1 Query Reserve | vorhandene vollständige lokale DO-Fixture lag bei max. 48 Queries/Invocation | Budget-Harness | **PROVEN lokal, zu wenig Reserve** |
| D1 Billing | echte vollständige Cloudflare `rows_read`/`rows_written` Invocation-Metadaten fehlen | keine autorisierte Remote-Messung | **UNKNOWN** |
| Admin Auth | Campaign-Admin Session 12h | fixer Serververtrag | **PROVEN** |
| Organizer Auth | Organization Session 12h | fixer Serververtrag | **PROVEN** |
| normale Campaign Session | 30 Tage | separater Vertrag | **PROVEN** |
| Remember Device | kein separat nachgewiesenes rotierendes Device-Credential | Auth-Audit | **OPEN** |
| Progress | Phase/Cursor/Metriken existieren serverseitig; Realtime-/UI-Vertrag noch nicht vollständig bewiesen | Preparation Public State/Runner | **PARTIAL** |

## 2. Verifizierter Ordering-P0

### Baseline

Die Baseline besaß bereits:

- lokale RxDB Writes;
- `pendingPushProofs` pro `collection:id`;
- `awaitDocumentPushed()`;
- Push-Confirmation Timeout;
- per-Collection Pull-Checkpoints.

Der Fehler lag in der Orchestrierung: `refreshAndWait()` konnte zuerst den kanonischen Server-Checkpoint lesen und Pulls starten, bevor ein bereits akzeptierter lokaler Write bestätigt war.

### Test-first-Beweis

`tests/rxdbRefreshOrdering.test.ts` wurde aus der historischen Fix-Linie auf den aktuellen Audit-Stand zurückgebracht.

Commit vor Runtime-Fix: `a87d7e567b622acbe87b162ba73cbab3830e506f`.

CI run `34865295021`:

- Checkout: grün
- Install: grün
- Test: **rot**
- konkrete Assertion: `refresh must not report current while the local write is still waiting for its push gate`

Damit ist die P0-Race reproduziert.

### Verworfener globaler Fix

Commit `63537c5760ab2ede6a1679d490e46c0b90ccd01a` setzte einen globalen Pending-Write-Barrier vor Refreshes.

CI run `34866065831` blieb rot, weil ein retrybarer Team-Push einen unabhängigen Street-Pull blockierte. Das beweist, dass `pendingPushProofs.size === 0` als globale automatische Bedingung architektonisch falsch ist.

### Akzeptierte Phase-A-Lösung

Öffentliche Fassade `src/data/rxdbMissionSync.ts`, bestehender RxDB-Core in `src/data/rxdbMissionSyncCore.ts`.

Automatische/invalidation-driven Refreshes sind collection-aware:

```text
refresh(requested collections)
-> relevant debounce gates flush
-> collection without pending local proof: reSync now
-> collection with pending local proof: queue independently
-> proof resolves or bounded error
-> reSync only that collection
```

Explizites `refreshAndWait()` ist absichtlich stärker:

```text
flush all mission persistence gates
-> wait all already accepted mission writes
-> request canonical checkpoint
-> pull to target
-> report convergence
```

Ein Proof-Generation-Watermark für kontinuierliche neue Writes ist Phase B, nicht Teil des behaupteten Phase-A-Fixes.

## 3. Phase-A-Verifikation

Verifizierter Head: `d276ccdd6c2350997d3fdd377fb28824e56fd88d`.

GitHub Actions:

- CI `34867857864`: **SUCCESS**
  - Tests grün
  - Typecheck grün
  - Dependency Audit grün
  - Production Build grün
- Independent StreetEngine Audit `34867857844`: **SUCCESS**

Damit bestehen gleichzeitig:

- delayed local push + explicit refresh ordering;
- unabhängiger Street-Pull trotz retrybarem Team-Push;
- Lost-ACK-Idempotenz;
- actor-scoped Offline-Replay;
- bestehende Konflikt- und Runtime-Suiten;
- StreetEngine unabhängiger Scale-Audit.

Kein Deploy, keine Remote-Migration, kein D1-Write außerhalb der Testharnesses.

## 4. End-to-End-Sync-Karte

```text
React/UI
  -> Domain Mutation
  -> CampaignStore
  -> MissionRxdbSync Coordinator
  -> RxDB/Dexie lokale Collection
  -> RxDB Replication Push Queue
  -> /api/campaigns/:id/rxdb/push/:collection
  -> Worker Auth
  -> handleRxdbPush
  -> deriveMutationFromRxdbWrite
  -> handleCampaignMutation
  -> validation + authorization + mutation ledger
  -> guarded D1 batch
  -> campaign_sync_changes + campaign_sync_heads
  -> DO/WebSocket changed hint
  -> collection-aware coordinator refresh
  -> RxDB pull/checkpoint
  -> lokale Replica
  -> CampaignSnapshot Materialisierung
  -> React / MapLibre / Generation Visibility
```

## 5. Konflikt- und Delete-Semantik

Der aktuelle Adapter ist kein globales Document-LWW:

- Campaign Name und Default Map View getrennt;
- Team Name und Farbe unabhängig mergebar;
- Area Name, Team und Geometry getrennt, Compound Structural Changes abgelehnt;
- Street/House Status und Label getrennt;
- Network, Road Position und Preparation Generation server-owned;
- Update gegen gelöschtes Ziel wird `target_deleted`;
- retry, dessen gewünschter Feldwert bereits kanonisch ist, kann als ACK enden.

Offen bleibt eine Produktentscheidung für gleichzeitige echte Same-Status-Änderungen. Der Audit ändert diese Semantik nicht nebenbei.

## 6. StreetEngine als Derived Data

Aktueller Base-Storage-Vertrag:

```text
Area geometry + algorithm version
-> geometry fingerprint
-> area_task_preparations generation=pending
-> street_network_jobs(generation, lease)
-> bounded phases
-> guarded publish
-> street_base_areas/chunks + overlays
-> generationState im RxDB Pull
```

Positive Invarianten:

- Runner lädt aktuellen Preparation-State und kanonische Area.
- Fingerprint-Mismatch wird stale/failed.
- Publish-Claim validiert Area, Geometry, Generation, Status und Lease.
- Base-Area Delete räumt server-owned Storage und canonical Kinder unter demselben Campaign Write Token.
- bearbeitete prepared Entities können über Overlay erhalten bleiben.

Noch nicht bewiesen ist der vollständige E2E-Chaosfall `old generation running -> resize/delete -> delayed publish -> offline stale client`.

Zielzustand bleibt:

```text
desired -> building -> published -> obsolete -> deleted
```

## 7. Change Feed, nächste Auditphase

Bekannt:

- `campaign_sync_changes` speichert monotone `seq`, Collection, Document-ID, Scope und Payload/Tombstone.
- `campaign_sync_heads` hält Collection-Heads.
- Pull arbeitet mit Checkpoint und High Water.
- Writer kann physische Änderungen kompakt gruppieren.

Jetzt repo-weit zu beweisen:

1. Gibt es irgendeinen Delete/GC/Retention-Pfad für `campaign_sync_changes`?
2. Gibt es bereits einen Retention-Floor oder Bootstrap-Epoch?
3. Kann ein alter Client erkennen, dass sein Checkpoint nicht mehr inkrementell bedienbar wäre?
4. Welche Indizes und Queries skalieren mit Feed-Länge?
5. Wie bleibt Delete-Resurrection ausgeschlossen, wenn alte Tombstones irgendwann entfernt werden?

Keine Retention-Migration wird implementiert, bevor diese Fragen durch Source und Regressionen beantwortet sind.

## 8. D1 Budget

Lokale Budgettests sind nützlich, aber keine Billing-Ground-Truth.

Bekannter lokaler Risikopunkt:

- vollständige DO-Budgetfixture max. etwa 48 D1 Queries/Invocation;
- Ziel mit sinnvoller Reserve: <=40, sofern ohne Korrektheitsverlust erreichbar.

Für eine endgültige Free-Tier-Aussage fehlen echte vollständige Invocation-Metadaten aus Cloudflare. Deshalb bleibt:

`D1_FREE_TIER_FEASIBILITY = UNKNOWN`

Remote-Staging-Messungen werden ohne explizite Autorisierung nicht gestartet.

## 9. Auth

Istzustand:

- normale Campaign Session: 30 Tage;
- Campaign Admin Account Session: 12 Stunden;
- Organization/Organizer Account Session: 12 Stunden;
- Cookies serverseitig abgesichert und Account-Sessions widerrufbar;
- Organization unterstützt MFA/TOTP und Recovery Codes;
- ein getrenntes rotierendes langlebiges Remember-Device-Credential ist bislang nicht nachgewiesen.

Zielrichtung für spätere getrennte Phase:

```text
short access session
+ hashed rotating device/refresh family
+ one-time rotation
+ replay detection
+ current-device revoke / logout-all
+ password/account/membership invalidation
+ MFA assurance independent from refresh lifetime
```

Keine Auth-Migration in Phase A.

## 10. Progress

Serverseitig existieren bereits Phase, Cursor, Tile-/Building-Zähler, Prozent und Quality/Failure Diagnostics. Die offene Frage liegt damit eher bei Hint/Polling/Reconnect/UI-Materialisierung als bei fehlenden Rohmetriken.

Ziel bleibt: D1 kanonisch, DO/WebSocket nur best-effort Progress Hint, nach Verlust/Reconnect einmal kanonisch reconciliieren.

## 11. Priorität ab jetzt

### P0/P1 als nächstes

1. Change-Feed Retention/Bootstrap-Grenze repo-weit beweisen.
2. direkten automatischen Same-Collection-Barrier-Test ergänzen.
3. Area Delete/Resize + active generation + stale client Chaos-Test.
4. D1 Query-Inventur und Reserve verbessern, ohne Remote-Messung vor Autorisierung.
5. danach Auth Remember-Device und Progress als getrennte Änderungen.

### Offen / UNKNOWN

- echte Cloudflare Billing-Metriken pro kompletter Invocation;
- langfristiger Feed-Retention-Vertrag;
- vollständiger Resurrection-Beweis nach zukünftiger Feed-Compaction;
- Same-Status-Produktsemantik;
- vollständige StreetEngine Resize/Delete-Chaosmatrix;
- Remember-Device Policy und Migration;
- konkrete UI-Ursache für veraltete Progress-Anzeige.

## 12. Release-Status

`SYNC_ORDERING_PHASE_A = VERIFIED`

`STREET_ENGINE_LIVE_READY = FALSE`

`D1_FREE_TIER_FEASIBILITY = UNKNOWN`

`RELEASE_READY = FALSE`

Der Draft-PR bleibt unmerged, bis die für den Gesamtauftrag vorgesehenen Folgephasen ausreichend isoliert und verifiziert sind.
