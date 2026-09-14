# Plan 037: Sync, D1 und StreetEngine Reliability

Stand: 2026-09-14

Status: active

Baseline: `unstable@35e9987efcf7a113a93df22b47f6f828cd0a4944`

Audit: `docs/status/SYNC_D1_STREETENGINE_ULTRA_AUDIT_2026-09-14.md`

## Ziel

Flyer Map soll mit mehreren gleichzeitig arbeitenden Geräten deterministisch konvergieren, lokale Writes niemals durch ältere Remote-Daten sichtbar verlieren, Area/StreetEngine-Lifecycle ohne Resurrection beherrschen und D1-Verbrauch pro Route quantitativ begrenzen.

## Anforderungen

- React/TypeScript/Vite/MapLibre/RxDB/Cloudflare Worker/DO/D1 bleiben der Stack.
- D1 bleibt kanonische persistente Wahrheit.
- RxDB bleibt lokale durable Replica.
- DO/WebSocket bleibt Hint/Invalidation, nicht SoT.
- UI-Mutationen sind sofort lokal sichtbar.
- Ein als lokal akzeptierter Write gilt erst als synchronisiert, wenn der Server ihn bestätigt oder einen expliziten Konflikt zurückgibt.
- Delete darf nicht resurrecten.
- StreetEngine ist generation-basiertes Derived Data.
- Auth muss Remember-Device unterstützen, ohne langlebige unrotierte Access-Cookies.
- Free-Tier-Aussagen brauchen echte Cloudflare-Metriken; lokale SQLite-Schätzungen werden nicht als Billing verkauft.
- Keine Production-Aktion, keine Production-D1-Migration, keine große Remote-Fixture.

## Architektur

### Client Sync Coordinator

```text
UI local mutation
-> RxDB write
-> assign local push-proof generation
-> optimistic UI remains visible
-> short coalescing window by mutation class
-> close round N (manual sync closes immediately)
-> flush persistence gates
-> freeze watermark N
-> await server ACK/conflict for proofs <= watermark N
-> read canonical server checkpoint
-> pull each collection to target
-> rebase/preserve round N+1 pending local intent
-> round N converged
```

Refresh sources (`manual`, `online`, `visibility`, WebSocket hint, safety) dürfen nicht direkt unkoordiniert `reSync()` starten. Sie senden einen Trigger an den Coordinator. Ein Hint kann zusammengefasst werden.

### Konflikte

- Status: servergeordnete fachliche Semantik, explizit diagnostizierbar.
- Label/Name/Farbe: property-level Three-Way Merge wie heute.
- Geometry/Team-Zuordnung: optimistic concurrency, struktureller Konflikt.
- Delete: serverseitige finale Gültigkeitsentscheidung, stale Updates abweisen.
- CRDT nur für zukünftige Datentypen mit echter concurrent-edit Semantik.

### Server Sync

```text
RxDB Push
-> Auth
-> assumed master / field-level decision
-> idempotent mutation ledger
-> guarded D1 batch
-> monotone feed seq / per-collection head
-> contentless changed hint
```

### StreetEngine

```text
Area geometry + algorithm version
-> desired generation
-> building
-> guarded publish
-> published
-> obsolete on next resize
-> deleted on Area delete
```

Publish muss Area, Geometry-Fingerprint, Generation und Lease in demselben Guard validieren.

### Change Feed

Langfristig:

```text
heads + retention(min_seq/bootstrap_epoch) + ordered deltas
```

Ein Client unter `min_seq` erhält `bootstrap_required`, statt einen nicht mehr bedienbaren alten Checkpoint still weiterzuverwenden.

## Dateistruktur

| Bereich | Dateien |
|---|---|
| Coordinator/P0 | `src/data/rxdbMissionSync.ts`, `src/data/campaignStore.ts` |
| Sync-Protokoll | `src/data/rxdbSyncProtocol.ts`, `src/domain/rxdbMutationAdapter.ts` |
| Worker Pull/Push | `worker/rxdbSync.ts`, `worker/rxdbChangeFeed.ts`, `worker/syncHeads.ts` |
| Street Lifecycle | `worker/mutationHandler.ts`, `worker/mutationRepository.ts`, `worker/areaTaskPreparation.ts`, `worker/streetNetwork/runner.ts`, `worker/streetNetwork/chunkPersistence.ts` |
| Auth | `worker/adminAuth.ts`, `worker/organizationAuth.ts`, neue additive Session-Family-Migration nur nach Tests |
| Progress | `worker/campaignSyncDurableObject.ts`, `worker/areaTaskPreparationApi.ts`, Client workspace/state |
| Tests | `tests/rxdbRefreshOrdering.test.ts`, `tests/rxdbP0Semantics.test.ts`, neue Chaos-/Lifecycle-Tests |
| D1 Budget | `tests/helpers/d1Budget.ts`, `scripts/street-d1-budget.ts`, Observability |
| Docs | Audit, ADR-0032, dieser Plan, CURRENT/context-map nach verifiziertem Ergebnis |

## Umsetzungsschritte

### Phase A: Ordering P0

1. historischen Ordering-Test gegen aktuellen Code portieren.
2. Fehler reproduzieren.
3. Push-Proof Watermark/Barrier in `MissionRxdbSync` implementieren.
4. externe Refresh-Trigger über Coordinator vereinheitlichen.
5. fokussierte Tests, Gesamttest, Typecheck, Build über CI.

Rollback: Commit(s) revertierbar, keine Migration.

### Phase B: Multi-Client Semantics

1. A/B/C Simulator mit Latenz/Reordering/Duplicate/Lost ACK.
2. same-status Konflikt und different-field Merge testen.
3. Konfliktzustand sichtbar/diagnostizierbar machen.
4. per-Collection Health und bounded retry definieren.

Rollback: Client Coordinator hinter bestehender API, keine Datenmigration.

### Phase C: Delete/Resize/StreetEngine

1. Delete mit laufender Generation + Offline Client.
2. Shrink/Expand/Reexpand mit Stable IDs/Overlays.
3. stale Generation Publish nach Geometry-Wechsel.
4. gewünschte Generation/Lifecycle ADR-konform härten.
5. erst dann ggf. additive Schemaänderung für Entity-/Bootstrap-Epoch.

Rollback: alte publizierte Generation bleibt bis erfolgreichem neuen Publish sichtbar; keine destruktive Migration.

### Phase D: Feed und D1

1. komplette Query-Inventur pro Route inklusive Auth/PRAGMA.
2. `meta.rows_read`, `rows_written`, Query Count, CPU, Dauer strukturiert erfassen.
3. lokale 400/1k/5k/10k/20k Modelle.
4. kleine echte Staging-Messung nur nach expliziter Autorisierung.
5. Retention/Bootstrap-Grenze implementieren, wenn nötig additive Migration.

Rollback: Feed-GC zunächst deaktiviert; Bootstrap bleibt möglich.

### Phase E: Auth

1. Session-Family-Datenmodell + Tests.
2. rotierendes Remember-Device Credential, Replay Detection, Revocation.
3. Password Change/Disable/Logout all/MFA Tests.
4. erst danach Migration und UI.

Rollback: alte 12h Session bleibt kompatibel bis neue Device Session bestätigt ist.

### Phase F: Progress/Observability

1. strukturierte Sync-Operation IDs und Diagnoseexport.
2. Progress Hint über bestehendes DO.
3. Reconnect bestätigt kanonischen D1-State.
4. Polling-Frequenz senken, sobald Hint-Recovery nachgewiesen ist.

## Testmatrix

Pflicht:

- push slow + manual refresh
- push slow + WebSocket hint
- push slow + online/visibility
- old pull before push ACK
- duplicate push / lost ACK
- reordered pull responses
- two-client same status
- different-field edits
- offline reconnect
- lost WebSocket
- browser restart with pending writes
- Area delete + active generation + offline client
- shrink/expand/reexpand
- stale generation publish
- progress hint lost/reconnect
- auth renewal/replay/revoke
- 20k local dataset performance

## D1 Budget Gates

- Free Tier hard limit: 50 D1 queries/Worker invocation.
- vorhandene Full-Schema DO-Fixture: max. 48, deshalb zu wenig Reserve.
- Ziel für kritische Pfade: <=40, sofern ohne Korrektheitsverlust erreichbar.
- Tagesbudget wird erst mit echten `meta.rows_read`/`rows_written` final klassifiziert.

## Offene Fragen / UNKLAR:

- Produktregel bei gleichzeitigem same-status Conflict: servergeordnetes LWW oder sichtbarer fachlicher Konflikt?
- Wie lange müssen offline Clients garantiert ohne Full Bootstrap aufholen können?
- Retention-Fenster für Change Feed?
- Soll Recreate einer gelöschten Entity-ID grundsätzlich verboten werden oder über Entity-Epoch erlaubt sein?
- exakte Remember-Device Policy: Empfehlung 60 Tage idle / 90 Tage absolute Laufzeit, noch Produktentscheidung.
- exakte zulässige Progress-Latenz.
- echte Cloudflare D1 Invocation-Metriken fehlen bis autorisierte Staging-Messung.
