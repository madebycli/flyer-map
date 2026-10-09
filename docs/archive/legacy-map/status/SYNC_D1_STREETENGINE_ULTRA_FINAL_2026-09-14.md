# Sync / D1 / StreetEngine Ultra Audit: final verified checkpoint

Stand: 2026-09-14

Dieser Checkpoint ergänzt und supersediert nur die **Verifikationsangaben** in
`SYNC_D1_STREETENGINE_ULTRA_AUDIT_2026-09-14.md`. Architektur, Befunde und Begründungen bleiben dort ausführlich dokumentiert.

## Exakter Stand

- Baseline: `unstable@35e9987efcf7a113a93df22b47f6f828cd0a4944`
- Audit-Branch: `audit/sync-d1-streetengine-ultra-2026-09-14`
- Letzter Runtime-/Auth-Implementierungshead: `05857c6e254f3a4524a71bff49097a0aa820d699`
- Finaler verifizierter Audit-/Safety-Head: `15f3a1a0ab6d5bff3d9a831597d40401d0003d98`
- Draft PR: #96 gegen `unstable`, offen, draft, ungemergt.
- `unstable` war beim Abschluss weiterhin exakt auf `35e9987efcf7a113a93df22b47f6f828cd0a4944`; kein Base-Drift.

## Finale Gates

Auf `15f3a1a0ab6d5bff3d9a831597d40401d0003d98`:

- CI #1675 / run `34897001000`: **SUCCESS**
- Independent StreetEngine Scale Audit #102 / run `34897000935`: **SUCCESS**

Damit sind auf einem gemeinsamen finalen Head grün:

- vollständige Test-Suite;
- Typecheck;
- Dependency Audit;
- Production Build;
- unabhängiger synthetischer StreetEngine Scale Audit;
- Sync-Ordering-Regressions;
- Restart-/expired-checkpoint-Rebootstrap-Regressions;
- Trusted-Device-Rotation/Replay/Invalidierung/Client-Retry;
- StreetEngine Progress-Realtime-Regressions;
- physischer Change-Feed-GC-Safety-Gate.

## Physischer Change-Feed-GC

Der destruktive lokale Rebootstrap ist für Restart/Single-Instance bewiesen, aber ein zweiter bereits offener Tab während `removeRxDatabase()` bleibt kein separat bewiesener Recovery-Vertrag.

Deshalb ist der aktuelle Releasezustand fail-closed:

- `worker/` enthält keinen produktiven `DELETE FROM campaign_sync_changes`-Pfad.
- `tests/rxdbPhysicalFeedGcGate.test.ts` scannt produktiven Worker-Code und schlägt fehl, sobald ein solcher Delete eingeführt wird.
- Retention-Floor/Epoch und `rxdb_checkpoint_expired` bleiben implementiert.
- Aggressiver physischer Feed-GC bleibt deaktiviert, bis ein koordinierter Multi-Tab-Rebootstrap existiert und getestet ist.

Status: `PHYSICAL_CHANGE_FEED_GC = SAFELY_DISABLED_PENDING_MULTITAB_PROTOCOL`.

## Trusted Device Auth

Status: `TRUSTED_DEVICE_AUTH = VERIFIED`.

- Access Sessions bleiben 12h.
- Remember Device: 60d idle, 90d absolute.
- Tokens serverseitig nur gehasht.
- Rotation bei jeder Nutzung.
- Replay eines ersetzten Tokens widerruft die gesamte Family.
- relevante Credential-/Account-/Membership-Änderungen widerrufen Subject-Families.
- Logout widerruft die aktuelle Remember-Family.
- Recovery-Code-Organization-Session bekommt keinen Remember-Token.
- RxDB-Transport verwendet Singleflight-Session-Refresh, sodass parallele Collection-401s genau einen rotierenden Remember-Token konsumieren.

## D1 Free Tier

Status bleibt bewusst:

`D1_FREE_TIER_FEASIBILITY = UNKNOWN_REMOTE_METRICS_REQUIRED`.

Lokale Budgettests sind ein Sicherheitsindikator und zeigen mit Spitzen um 48 Queries pro Invocation sehr wenig Reserve zum Free-Limit. Sie sind keine Cloudflare-Billing-Ground-Truth.

Ein endgültiger Verdict benötigt einen **ausdrücklich autorisierten, isolierten Staging-Messlauf** mit echten vollständigen Invocation-Metadaten, insbesondere `meta.rows_read`, `meta.rows_written`, Query Count und CPU/Dauer. Dieser Audit hat keinen solchen Remote-Write-/Migration-/Messlauf gestartet.

## Releasegrenze

Kein Merge, kein Deploy, keine Production-D1-Migration/-Writes und keine Secret-Rotation sind Teil dieses Checkpoints. PR #96 bleibt Draft.