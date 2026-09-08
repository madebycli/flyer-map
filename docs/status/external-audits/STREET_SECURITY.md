# Street Security

## Basis

- Draft-PR: #84
- Ausgangs-Head: `c2bf0bf0ef12704ce52612181dbb574837d77749`
- Audit-Test: `tests/mainStreetSecurity.test.ts`

## PASS / FAIL / BLOCKED

| Negativfall | Status | Endpunkt / Schutz |
| --- | --- | --- |
| Fremde Organization / Campaign | PASS | Campaign-gebundene Access-Kontexte werden vor Street-Write abgewiesen, zusätzlich bestehende Organization-/Campaign-Access-Suite |
| Viewer-Write | PASS | Street Network und RxDB Push verweigern Viewer mit 403 |
| Falsches Team | PASS | Nicht-Admin-Access außerhalb des Area-Teams wird mit 403 abgewiesen |
| Manipulierte Area-ID | PASS | `/api/campaigns/:campaignId/network`, unbekannte Area ergibt 404 |
| Manipulierte Street-ID / selected path | PASS | Network-Intent mit fremdem Task im Pfad ergibt 409 |
| Manipulierte House-ID | PASS | `house.set-status` gegen fremde House-ID kollidiert serverseitig |
| Fremder Origin | PASS | Main-Worker besitzt vor schreibenden API-Pfaden den Same-Origin-Write-Gate `origin_forbidden`; bestehende Security-Tests decken diesen Gate ab |
| Wiederverwendete Mutation-/Intent-ID | PASS | Network-Intent mit gleicher ID und verändertem Fingerprint ergibt 409 `intent_id_reused`; Mutation-Ledger besitzt denselben Fingerprint-Schutz |
| Veraltete Revision / Generation | PASS | House-Mutation mit alter `baseRevision` und Network-Intent mit alter Preparation-Generation ergeben 409 |
| Alter Snapshot-Writer | PASS | `legacySnapshotWriteResponse()` bleibt 410 `legacy_snapshot_write_retired` |

## Ergebnis

Kein neuer allgemeiner Security-Umbau nötig. Die ergänzte Datei konzentriert sich ausschließlich auf Street-/House-negative Fälle und berührt keinen Produktcode.

## Geänderte Dateien

- `tests/mainStreetSecurity.test.ts`
- `docs/status/external-audits/STREET_SECURITY.md`

## Sicherheitsgrenzen

Kein Merge, kein Deploy und kein Secret-Zugriff.
