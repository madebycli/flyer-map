# Sync, D1 und StreetEngine Ultra Audit

Stand: 2026-09-14

Baseline: `unstable@35e9987efcf7a113a93df22b47f6f828cd0a4944`

Audit-Branch: `audit/sync-d1-streetengine-ultra-2026-09-14`

Verifizierter Runtime-Head: `05857c6e254f3a4524a71bff49097a0aa820d699`

Draft-PR: #96 gegen `unstable`, ungemergt.

Status: **Runtime-/Test-Arbeit dieses Audits ist verifiziert. Zwei externe/sicherheitsbedingte Gates bleiben offen: reale Cloudflare-D1-Billing-Metriken und Multi-Tab-sicherer physischer Feed-GC. Keine Production-Aktion.**

## Beweisregeln

- `PROVEN`: direkt aus aktuellem Source, Regressionstest oder ausgeführter CI nachgewiesen.
- `LIKELY`: Source ist riskant, der konkrete Fehler aber noch nicht reproduziert.
- `HYPOTHESIS`: plausible Ursache, die gezielte Messung benötigt.
- `UNKNOWN`: Evidenz fehlt.

Lokales `git clone` war in der Ausführungsumgebung nicht verfügbar. Verifikation erfolgte über exakte GitHub-Commits und GitHub Actions. Es werden keine erfundenen lokalen Testergebnisse verwendet.

## 1. Executive Matrix

| Bereich | Ergebnis | Status |
|---|---|---|
| Pull überholt lokalen Push | Baseline reproduzierbar fehlerhaft; collection-aware Push-Proof-Barrieren implementiert | **PROVEN FIXED** |
| Unabhängige Collections | retrybarer Team-Push blockiert Street-Pull nicht | **PROVEN** |
| Explizite Konvergenz | `refreshAndWait()` wartet bereits akzeptierte Mission-Writes vor Ziel-Checkpoint | **PROVEN** |
| Restart + pending Write | RxDB 17.5 behält pending Push über Restart; push-only mit identischem Replication-Identifier drainiert ihn | **PROVEN** |
| `rxdb_checkpoint_expired` | pending Writes drainen, lokale Mission-DB wird sauber neu aufgebaut, kanonischer Bootstrap folgt | **PROVEN** |
| Delete Resurrection nach Retention | compacteter Delete wird beim Rebootstrap nicht zurückgepusht/resurrected | **PROVEN im Single-Instance/Restart-E2E** |
| Multi-Tab Rebootstrap | normale Leader-Election/Handover ist bewiesen; destruktiver DB-Rebootstrap mit zweitem noch offenen Tab nicht separat bewiesen | **OPEN SAFETY GATE** |
| Change-Feed Retention Floor | `campaign_sync_retention` + Epoch; alter Checkpoint erhält `rxdb_checkpoint_expired`, Null-Checkpoint bootstrapped | **PROVEN** |
| Physischer Feed-GC | darf erst nach Multi-Tab-Rebootstrap-Beweis automatisiert werden | **BLOCKED BY SAFETY GATE** |
| Konflikte / Idempotenz | Property-level Three-Way, `target_deleted`, Lost-ACK exactly-once, actor isolation | **PROVEN** |
| StreetEngine Generation Guard | Area/Geometry/Generation/Status/Lease schützen Publish | **PROVEN** |
| StreetEngine Chaos | stale Generation/Resize/Delete-Regressions auf Audit-Branch vorhanden | **PROVEN in Tests** |
| Preparation Progress | D1 kanonisch, WebSocket Hint + Poll-Fallback; abgelaufene Socket-Scopes reconnecten statt still zu sterben | **PROVEN FIXED** |
| Campaign Admin Session | 12h Access Session | **PROVEN** |
| Organizer Session | 12h Access Session | **PROVEN** |
| Trusted Device | 60d idle / 90d absolut, serverseitig gehasht, Rotation, Replay-Family-Revoke, Credential-Invalidierung | **PROVEN** |
| RxDB nach 12h | Singleflight Remember-Refresh verhindert parallelen Token-Replay durch fünf Collections | **PROVEN BY CODE + FULL CI** |
| D1 Query Ceiling | lokale Full-Schema-Harnesses liegen nahe am Free-Limit; bekannte Maximalwerte um 48 Queries/Invocation | **PROVEN LOCAL RISK** |
| D1 Free Tier Billing | echte vollständige `meta.rows_read` / `rows_written` aus isoliertem Cloudflare-Staging fehlen | **UNKNOWN** |

## 2. Sync Ordering P0

Die Baseline konnte einen kanonischen Checkpoint lesen und Pull starten, bevor ein bereits akzeptierter lokaler RxDB-Write serverseitig bestätigt war.

Test-first-Beweis:

- Historischer Regressionstest `tests/rxdbRefreshOrdering.test.ts` wurde auf die Baseline zurückgebracht.
- Test-only Commit `a87d7e567b622acbe87b162ba73cbab3830e506f` scheiterte mit `refresh must not report current while the local write is still waiting for its push gate`.
- Ein erster globaler Barrier wurde verworfen, weil er einen unabhängigen Street-Pull hinter einem retrybaren Team-Push blockierte.

Akzeptierter Vertrag:

```text
automatic refresh(collection set)
-> relevante Persistence Gates flushen
-> Collection ohne pending same-collection Push sofort reSync
-> Collection mit pending Push separat warten/coalescen
-> andere Collections bleiben unabhängig

explicit refreshAndWait()
-> alle bereits akzeptierten Mission-Writes abwarten
-> kanonischen Ziel-Checkpoint lesen
-> bis zum Ziel pullen
-> erst dann Konvergenz melden
```

## 3. Retention und sicherer Rebootstrap

Migration `0024_rxdb_sync_retention.sql` führt pro Campaign/Collection einen Retention-Floor und Epoch ein.

Serververtrag:

- Checkpoint unter Floor: HTTP 409 `rxdb_checkpoint_expired` plus `minCheckpointSeq`/`epoch`.
- Checkpoint exakt am Floor: inkrementeller Pull bleibt gültig.
- `checkpoint: null`: Full Bootstrap aus kanonischem State.
- Ein Race, bei dem Retention nach dem Head-Read weiterläuft, darf nicht still Änderungen überspringen.

Client-Recovery:

```text
expired checkpoint
-> normale Replications stoppen
-> alle fünf Collections push-only mit exakt gleichem replicationIdentifier starten
-> awaitInSync nur in diesem Recovery-Drain
-> alle pending lokalen Writes serverseitig bestätigen/konfliktauflösen
-> lokale Mission-RxDB schließen
-> lokale DB + Sync-Fortschritt entfernen
-> Full Bootstrap vom kanonischen Server
-> normale Replications neu starten
```

Wichtiger RxDB-17.5-Beweis: ein pending Push überlebt Browser-/DB-Restart und wird durch push-only mit demselben Identifier wiedergefunden.

E2E-Beweis: Offline-Write bleibt erhalten, ein neuer kanonischer Task erscheint nach Bootstrap und ein bereits compacteter gelöschter Task wird nicht resurrected.

### Noch gesperrt: automatischer physischer Feed-GC

Der Full-Rebootstrap entfernt die lokale Mission-DB. Normale RxDB-Multi-Tab-Leader-Election und Handover sind getestet, aber ein zweiter noch offener Tab während dieses destruktiven Reset-Pfads ist nicht als eigener Vertrag bewiesen. Deshalb gilt:

`PHYSICAL_CHANGE_FEED_GC = DISABLED / NOT RELEASE-GATED`

Retention-Floor und Fehlervertrag dürfen existieren; automatische aggressive Feed-Löschung bleibt bis zum Multi-Tab-Rebootstrap-Protokoll gesperrt.

## 4. Konflikt- und Delete-Semantik

Der aktuelle Adapter ist kein globales Document-LWW:

- Team Name/Farbe und andere unabhängige Properties können rebasen.
- Same-field-Races liefern Konflikt.
- server-owned Strukturfelder bleiben geschützt.
- Update gegen gelöschtes Ziel wird `target_deleted`.
- Retry eines bereits kanonisch angewandten Werts kann als ACK enden.
- Lost HTTP ACK erzeugt keinen zweiten Domain-Effekt und keinen zweiten Feed-Eintrag.
- Field-Group-A Offline-Intent wird nicht von B hochgeladen.

## 5. StreetEngine als Derived Data

Aktueller Vertrag:

```text
Area geometry + algorithm version
-> desired generation
-> bounded building phases
-> guarded publish
-> published generation
-> obsolete bei neuer Geometry/Generation
-> delete cleanup bei Area delete
```

Publish prüft kanonische Area, exakte Geometry/Fingerprint, Generation, Preparation-Status, Lease sowie Campaign Write Token/Revision. Base Storage trennt generierte Basis von User-Work-Overlays.

Auf dem Audit-Branch existieren Generation-/Chaosregressionen für stale Publish, Resize/Delete und Sichtbarkeit. Die UI darf keine gemischte Generation präsentieren.

## 6. Preparation Progress

D1 bleibt kanonische Progress-Quelle. Der Durable Object sendet nur best-effort `preparation`-Hints; der Client hält zusätzlich ein bounded 2s-Polling mit Backoff/Authorization-Stop vor.

Gefundener Live-Fehler: WebSocket-Attachments hatten einen 5-Minuten-Scope, abgelaufene Sockets wurden aber nur übersprungen. Der Browser bekam kein `onclose` und reconnectete nicht.

Fix: beim ersten Hint nach Scope-Ablauf wird der Socket aktiv mit `4001 / scope_expired` geschlossen. Der vorhandene Client-Reconnect läuft erneut durch Auth. Regression: `tests/preparationRealtimeExpiry.test.ts`.

## 7. Trusted Device / Remember Me

Kurze Access-Sessions bleiben unverändert:

- Campaign Admin Account: 12h.
- Organization Account: 12h.

Additive Migration `0025_trusted_devices.sql` speichert ausschließlich Token-Hashes und Family-Metadaten.

Policy:

```text
Access Session: 12h
Trusted Device idle expiry: 60d
Trusted Device absolute expiry: 90d
Token use: one-time rotation
Replay of replaced token: revoke whole family
Password/account/membership security change: revoke affected subject families
Logout: revoke current remembered family
Recovery-code Organization session: no Remember token
```

Organization-Login zeigt „Dieses Gerät merken“. Nach `401 authentication_required` wird `/api/organization/session/refresh` einmal versucht und der Originalrequest höchstens einmal wiederholt.

Campaign-Admin-Requests verwenden analog `/api/campaigns/:id/admin-accounts/session/refresh` nach `401 access_required`.

RxDB besitzt denselben Mechanismus im Transport. Weil fünf Collections gleichzeitig 401 sehen können, ist der Session-Refresh Singleflight: genau ein Remember-Token wird konsumiert/rotiert, die parallelen Requests warten auf dasselbe Ergebnis und wiederholen sich danach einmal. Dadurch löst die eigene Replay-Erkennung nicht durch legitime Parallelität aus.

Regressions:

- Token Rotation + Replay Family Revoke.
- Idle und Absolute Expiry.
- Organization/Campaign-Admin Login→Refresh.
- falscher Campaign-Scope abgewiesen.
- Membership-/Admin-Deaktivierung invalidiert Remember-Familien.
- fehlgeschlagene Credential-Änderung invalidiert nicht.
- Client 401→Refresh→exactly-one retry.

## 8. D1 Budget

Lokale Query-Counts sind ein Sicherheitsindikator, keine Cloudflare-Billing-Ground-Truth.

Bekannter Risikopunkt: vollständige DO-Harnesses liegen nahe am Free-Plan-Limit von 50 D1 Queries pro Worker-Invocation; gemessene lokale Spitzen liegen um 48. Das ist zu wenig Reserve für einen belastbaren Free-Tier-Verdict.

Für die endgültige Klassifikation müssen auf einem ausdrücklich freigegebenen isolierten Staging vollständige Invocations mit Cloudflare-Metadaten gemessen werden:

- `meta.rows_read`
- `meta.rows_written`
- Query Count
- CPU/Dauer
- repräsentative 400 / 1k / 5k / 10k / 20k Fälle

Bis dahin:

`D1_FREE_TIER_FEASIBILITY = UNKNOWN`

Keine Remote-Migration, kein Remote-D1-Write und kein Staging-Messlauf wurde durch diesen Audit ohne ausdrückliche Autorisierung gestartet.

## 9. Verifikation

Verifizierter Runtime-Head: `05857c6e254f3a4524a71bff49097a0aa820d699`.

GitHub Actions:

- CI #1671 / run `34896353117`: **SUCCESS**
  - Tests: PASS
  - Typecheck: PASS
  - Dependency Audit: PASS
  - Production Build: PASS
- Independent StreetEngine scale audit #98 / run `34896353122`: **SUCCESS**

`unstable` stand beim Abschluss weiterhin exakt auf der Audit-Baseline `35e9987efcf7a113a93df22b47f6f828cd0a4944`; kein Rebase-Drift.

## 10. Release- und Reststatus

`SYNC_ORDERING = VERIFIED`

`EXPIRED_CHECKPOINT_RECOVERY = VERIFIED_SINGLE_INSTANCE_RESTART`

`STREET_ENGINE_GENERATION_GUARDS = VERIFIED`

`PREPARATION_PROGRESS_REALTIME = VERIFIED`

`TRUSTED_DEVICE_AUTH = VERIFIED`

`PHYSICAL_CHANGE_FEED_GC = BLOCKED_MULTI_TAB_REBOOTSTRAP`

`D1_FREE_TIER_FEASIBILITY = UNKNOWN_REMOTE_METRICS_REQUIRED`

`PRODUCTION_ACTIONS = NONE`

Draft-PR #96 bleibt absichtlich ungemergt. Ein Merge/Deploy ist nicht Teil dieses Auftrags.