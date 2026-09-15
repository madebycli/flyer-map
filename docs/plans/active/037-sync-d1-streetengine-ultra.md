# Plan 037: Sync, D1 und StreetEngine Reliability

Stand: 2026-09-14

Status: active, Runtime-Arbeit weitgehend abgeschlossen; externe/sicherheitsbedingte Gates offen.

Baseline: `unstable@35e9987efcf7a113a93df22b47f6f828cd0a4944`

Audit-Branch: `audit/sync-d1-streetengine-ultra-2026-09-14`

Verifizierter Runtime-Head: `05857c6e254f3a4524a71bff49097a0aa820d699`

Audit: `docs/status/SYNC_D1_STREETENGINE_ULTRA_AUDIT_2026-09-14.md`

## Ziel

Flyer Map soll mit mehreren gleichzeitig arbeitenden Geräten deterministisch konvergieren, lokale Writes nicht durch ältere Pulls sichtbar verlieren, Retention ohne Resurrection beherrschen, StreetEngine-Derived-Data generation-sicher veröffentlichen und kurze Auth-Sessions über rotierende Trusted Devices erneuern können.

## Unveränderte Architekturprinzipien

- D1 ist kanonische persistente Wahrheit.
- RxDB ist lokale durable Replica.
- Durable Object/WebSocket ist Hint/Invalidation, nicht SoT.
- UI-Mutationen sind sofort lokal sichtbar.
- Ein lokal akzeptierter Write gilt erst nach Server-ACK oder explizitem Konflikt als synchronisiert.
- Eine kaputte Collection darf unabhängige Collections nicht blockieren.
- Delete darf nicht resurrecten.
- StreetEngine bleibt generation-basiertes Derived Data.
- 12h Admin-/Organizer-Access-Sessions bleiben kurzlebig; Remember Device ist ein separates rotierendes Credential.
- Free-Tier-Aussagen benötigen echte Cloudflare-Metriken.
- Keine Production-Aktion ohne gesonderte Anweisung.

## Abgeschlossene Phasen

### A. Ordering P0

**VERIFIED**

```text
local mutation
-> RxDB write + push proof
-> automatic refresh nur same-collection barrier
-> andere Collections dürfen weiterlaufen

refreshAndWait
-> bereits akzeptierte Mission-Writes abwarten
-> kanonischen Checkpoint lesen
-> bis Ziel pullen
```

Der globale automatische Barrier wurde durch bestehende Regression verworfen.

### B. Multi-Client / Restart Semantics

**VERIFIED für die implementierten Verträge**

- Lost ACK bleibt idempotent.
- Actor-scoped Offline-Intent bleibt isoliert.
- Multi-tab normaler Replication-Leader/Handover dupliziert Writes nicht.
- Browser-/DB-Restart behält pending RxDB-Push.
- Push-only Replication mit identischem Identifier kann den pending Push wieder aufnehmen.

### C. Retention / Rebootstrap

**VERIFIED mit einem verbleibenden Multi-Tab-Gate**

- `0024_rxdb_sync_retention.sql`: Retention-Floor + Epoch.
- unter Floor: `rxdb_checkpoint_expired` statt silent skip.
- Recovery drainiert zuerst alle lokalen Pushes.
- danach lokale Mission-DB entfernen und full bootstrappen.
- compacteter Delete wird im Restart-E2E nicht resurrected.

Offen bleibt ein expliziter Test/Protokoll für einen zweiten bereits offenen Tab während des destruktiven DB-Resets. Bis dahin kein automatischer aggressiver physischer Feed-GC.

### D. StreetEngine / Progress

**VERIFIED für Guard/Chaos/Realtime-Fix**

- Publish bleibt an Area, Geometry/Fingerprint, Generation, Status, Lease und Campaign-Write-Guard gebunden.
- stale Generation/Resize/Delete-Chaosregressionen liegen vor.
- UI Generation Visibility verhindert gemischte Generationen.
- D1 ist kanonischer Progress.
- WebSocket sendet best-effort Hints.
- abgelaufener 5-Minuten-Socket-Scope wird aktiv geschlossen, damit der Client reauthentifiziert/reconnectet.
- 2s Polling mit Backoff bleibt Recovery-Fallback.

### E. Trusted Device Auth

**VERIFIED**

Migration `0025_trusted_devices.sql` und Server-/Client-Vertrag:

```text
Access Session = 12h
Remember idle = 60d
Remember absolute = 90d
server stores token hash only
use -> rotate once
replay old token -> revoke family
password/account/membership security change -> revoke subject families
logout -> revoke current family
Organization recovery session -> no remember token
```

Organization und Campaign Admin besitzen eigene `__Host-...remember` Cookies. Nach Auth-401 wird Refresh einmal versucht und der Originalrequest höchstens einmal wiederholt.

RxDB-Transport benutzt für parallele Collection-401s einen Singleflight-Refresh, damit legitime Parallelität die Replay-Erkennung nicht auslöst.

## Testmatrix, aktueller Stand

PASS/abgedeckt:

- slow push + manual refresh ordering;
- retryable Team push + independent Street pull;
- Lost ACK / duplicate retry;
- actor isolation;
- normal multi-tab leader handover;
- restart with pending push;
- expired checkpoint + push drain + full bootstrap;
- compacted delete does not resurrect in restart E2E;
- retention-floor race;
- property-level merge / same-field conflict / target_deleted;
- StreetEngine generation chaos;
- progress socket expiry + reconnect trigger;
- trusted-device rotate/replay/expiry;
- Organization/Campaign Admin remember bridges;
- account/membership invalidation;
- client 401 -> refresh -> one retry.

Noch offen:

- destructive expired-checkpoint rebootstrap mit zweitem bereits offenen Browser-Tab;
- echte Cloudflare D1 Billing-Metadaten für vollständige Invocations;
- optionale fachliche Produktentscheidung für gleichzeitigen Same-Status-Konflikt.

## D1 Budget Gate

Lokale Full-Schema-Harnesses zeigen, dass kritische Invocations mit Spitzen um 48 Queries gefährlich nahe am Free-Limit von 50 Queries/Worker-Invocation liegen. Lokale SQLite-Zähler werden nicht als Cloudflare-Billing ausgegeben.

Endgültige Messung benötigt ausdrücklich freigegebenes isoliertes Staging mit:

- `meta.rows_read`
- `meta.rows_written`
- Query Count
- CPU/Dauer
- 400 / 1k / 5k / 10k / 20k repräsentative Fälle

Bis dahin:

`D1_FREE_TIER_FEASIBILITY = UNKNOWN`

## Verifikation

Runtime-Head `05857c6e254f3a4524a71bff49097a0aa820d699`:

- CI #1671 / `34896353117`: PASS für Tests, Typecheck, Dependency Audit, Production Build.
- Independent StreetEngine Scale Audit #98 / `34896353122`: PASS.
- `unstable` war weiterhin exakt `35e9987efcf7a113a93df22b47f6f828cd0a4944`.

## Nächste erlaubte Schritte

1. Dokumentations-/Context-Handoff abschließen und noch einmal CI prüfen.
2. Multi-Tab-Rebootstrap-Protokoll als separaten Follow-up bauen, bevor physischer Feed-GC aktiviert wird.
3. Nur nach ausdrücklicher Staging-Autorisierung Cloudflare-D1-Meta-Messung durchführen.
4. Draft PR #96 nicht automatisch mergen oder deployen.

## Rollback

- Ordering-Fassade ist ohne Schemaänderung isoliert revertierbar.
- Retention-Migration ist additiv; physischer GC bleibt deaktiviert.
- Trusted-Device-Migration ist additiv; ohne Remember-Cookie funktionieren die bisherigen 12h-Sessions weiter.
- Progress-Hint bleibt optional; D1/Polling ist kanonischer Fallback.