# Plan 037: Sync, D1 und StreetEngine Reliability

Stand: 2026-09-14

Status: active

Baseline: `unstable@35e9987efcf7a113a93df22b47f6f828cd0a4944`

Aktueller Audit-Branch: `audit/sync-d1-streetengine-ultra-2026-09-14`

Verifizierter Phase-A-Head: `d276ccdd6c2350997d3fdd377fb28824e56fd88d`

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
- Eine kaputte Collection darf unabhängige Collections nicht blockieren.
- Delete darf nicht resurrecten.
- StreetEngine ist generation-basiertes Derived Data.
- Auth soll Remember-Device unterstützen, ohne langlebige unrotierte Access-Cookies.
- Free-Tier-Aussagen brauchen echte Cloudflare-Metriken; lokale SQLite-Schätzungen werden nicht als Billing verkauft.
- Keine Production-Aktion, keine Production-D1-Migration, keine große Remote-Fixture.

## Architektur

### Client Sync Coordinator

Phase A ist implementiert und verifiziert:

```text
UI local mutation
-> RxDB write
-> push proof collection:id
-> optimistic UI remains visible

automatic refresh(collection set)
-> flush relevant debounce gates
-> safe collections reSync immediately
-> blocked collection waits only for its own pending push proofs
-> bounded release -> reSync that collection

explicit refreshAndWait()
-> flush all relevant gates
-> wait all already accepted mission writes
-> read canonical checkpoint
-> pull to target
-> converged
```

Ein globaler automatischer Barrier wurde verworfen, weil ein retrybarer Team-Push sonst unabhängige Street-Pulls blockiert.

Phase B kann bei Bedarf einen Proof-Generation-Watermark ergänzen:

```text
close round N
-> freeze proof watermark N
-> wait only proofs <= N
-> canonical checkpoint
-> pull/rebase
-> new local writes belong to N+1
```

### Konflikte

- Status: aktuelle servergeordnete Konfliktsemantik bleibt vorerst bestehen; Produktentscheidung zu sichtbarem Same-Status-Konflikt offen.
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

Zu prüfen und danach zu entscheiden:

```text
heads + retention(min_seq/bootstrap_epoch) + ordered deltas
```

Wenn Retention eingeführt wird, darf ein Client unter dem Retention-Floor nicht still inkrementell weiterlaufen. Er braucht einen expliziten Full-Bootstrap-Vertrag.

## Dateistruktur

| Bereich | Dateien |
|---|---|
| Coordinator/P0 | `src/data/rxdbMissionSync.ts`, `src/data/rxdbMissionSyncCore.ts`, `src/data/campaignStore.ts` |
| Sync-Protokoll | `src/data/rxdbSyncProtocol.ts`, `src/domain/rxdbMutationAdapter.ts` |
| Worker Pull/Push | `worker/rxdbSync.ts`, `worker/rxdbChangeFeed.ts`, `worker/syncHeads.ts` |
| Street Lifecycle | `worker/mutationHandler.ts`, `worker/mutationRepository.ts`, `worker/areaTaskPreparation.ts`, `worker/streetNetwork/runner.ts`, `worker/streetNetwork/chunkPersistence.ts` |
| Auth | `worker/adminAuth.ts`, `worker/organizationAuth.ts`; neue additive Session-Family-Migration nur nach Tests |
| Progress | `worker/campaignSyncDurableObject.ts`, `worker/areaTaskPreparationApi.ts`, Client workspace/state |
| Tests | `tests/rxdbRefreshOrdering.test.ts`, `tests/rxdbP0Semantics.test.ts`, `tests/rxdbSyncRuntime.test.ts`, neue Chaos-/Lifecycle-Tests |
| D1 Budget | `tests/helpers/d1Budget.ts`, `scripts/street-d1-budget.ts`, Observability |
| Docs | Audit, ADR-0032, dieser Plan, CURRENT/context-map nach verifiziertem Ergebnis |

## Umsetzungsschritte

### Phase A: Ordering P0, erledigt und verifiziert

Ergebnis:

1. Historischen Ordering-Test portiert.
2. Baseline-Fehler in CI `34865295021` reproduziert.
3. Ersten globalen Barrier gebaut und durch bestehende Regression in CI `34866065831` verworfen.
4. Collection-aware automatische Barrier implementiert.
5. `refreshAndWait()` als explizite globale Konvergenzbarriere beibehalten.
6. Bestehende Source-Contract-Tests auf Coordinator/Core-Split angepasst.
7. CI `34867857864`: Tests, Typecheck, Dependency Audit und Production Build grün.
8. Independent StreetEngine Audit `34867857844`: grün.

Keine Migration, kein Deploy.

### Phase B: Multi-Client Semantics

1. Direkten automatischen Same-Collection-Barrier-Test ergänzen, nicht nur `refreshAndWait()`.
2. A/B/C Simulator mit Latenz, Reordering, Duplicate und Lost ACK erweitern.
3. Same-status Konflikt und different-field Merge deterministisch prüfen.
4. Browser-Restart mit pending writes und Actor-Wechsel prüfen.
5. Nur bei echtem Bedarf Proof-Watermark/Rebase-Round ergänzen.
6. Per-Collection Health und bounded retry definieren.

Rollback: Coordinator-Fassade ist isoliert und ohne Schemaänderung revertierbar.

### Phase C: Delete/Resize/StreetEngine

1. Delete mit laufender Generation + Offline Client.
2. Shrink/Expand/Reexpand mit Stable IDs/Overlays.
3. stale Generation Publish nach Geometry-Wechsel.
4. gewünschte Generation/Lifecycle ADR-konform härten.
5. erst dann ggf. additive Schemaänderung für Entity-/Bootstrap-Epoch.

Rollback: alte publizierte Generation bleibt bis erfolgreichem neuen Publish sichtbar; keine destruktive Migration.

### Phase D: Feed und D1, als nächstes

1. Repo-weit beweisen, ob Retention/GC bereits existiert.
2. Feed-Schema, Heads, Pull High-Water und Bootstrap-Vertrag inventarisieren.
3. Query-Inventur pro Route inklusive Auth/PRAGMA fortführen.
4. lokale 400/1k/5k/10k/20k Modelle aus vorhandenen Harnesses nutzen.
5. Retention/Bootstrap-Grenze nur mit Tests und additiver Migration implementieren.
6. `meta.rows_read`, `rows_written`, Query Count, CPU und Dauer remote nur nach expliziter Staging-Autorisierung messen.

Rollback: Feed-GC standardmäßig deaktiviert, bis Bootstrap und Delete-Resurrection nachgewiesen sind.

### Phase E: Auth

1. Session-Family-Datenmodell + Tests.
2. rotierendes Remember-Device Credential, Replay Detection, Revocation.
3. Password Change/Disable/Logout-all/MFA Tests.
4. erst danach Migration und UI.

Rollback: alte 12h Session bleibt kompatibel bis neue Device Session bestätigt ist.

### Phase F: Progress/Observability

1. strukturierte Sync-Operation IDs und Diagnoseexport.
2. Progress Hint über bestehendes DO.
3. Reconnect bestätigt kanonischen D1-State.
4. Polling-Frequenz erst senken, wenn Hint-Recovery nachgewiesen ist.

## Testmatrix

Pflicht:

- push slow + manual refresh, Phase A grün
- retryable Team push + independent Street pull, Phase A grün
- push slow + WebSocket hint
- push slow + online/visibility
- duplicate push / lost ACK, bestehende Abdeckung vorhanden
- reordered pull responses
- two-client same status
- different-field edits, bestehende Abdeckung vorhanden
- offline reconnect, actor-isolierte Abdeckung vorhanden
- lost WebSocket + safety recovery, bestehende Abdeckung vorhanden
- browser restart with pending writes
- Area delete + active generation + offline client
- shrink/expand/reexpand
- stale generation publish
- progress hint lost/reconnect
- auth renewal/replay/revoke
- 20k local dataset performance

## D1 Budget Gates

- Kritische Invocations dürfen das Plattform-Query-Limit nicht ausreizen.
- vorhandene Full-Schema-DO-Fixture lag lokal bei max. 48 Queries/Invocation und hat zu wenig Reserve.
- Ziel für kritische Pfade: <=40, sofern ohne Korrektheitsverlust erreichbar.
- Tagesbudget wird erst mit echten vollständigen Invocation-Metriken final klassifiziert.
- `D1_FREE_TIER_FEASIBILITY = UNKNOWN`, solange Remote-Billing-Metadaten fehlen.

## Offene Fragen / UNKLAR:

- Produktregel bei gleichzeitigem Same-Status-Konflikt: aktuelle Serverordnung oder sichtbarer fachlicher Konflikt?
- Wie lange müssen Offline-Clients garantiert ohne Full Bootstrap aufholen können?
- Retention-Fenster für Change Feed?
- Soll Recreate einer gelöschten Entity-ID grundsätzlich verboten werden oder über Entity-Epoch erlaubt sein?
- exakte Remember-Device Policy, noch Produktentscheidung.
- exakte zulässige Progress-Latenz.
- echte Cloudflare D1 Invocation-Metriken fehlen bis autorisierte Staging-Messung.
