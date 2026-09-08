---
id: status-current
type: status
status: active
last_updated: 2026-09-08
---

# Current Project State

## Main Runtime Kandidat

`main` enthält die Organizer-/Admin-Oberfläche und die zugehörigen Organization-, Security- und Campaign-Module. Plan 033 verbindet diese ausgelieferte Oberfläche mit dem vollständigen Worker: `worker/indexOrganizer.ts` ist im Main-Kandidaten der kanonische Entry Point und umschließt weiterhin die bestehende Field-, Collection-, Pickup- und RxDB-Runtime.

Der Runtime-Vertrag `/api/runtime` meldet nicht-sensitive Capability- und Versionsinformationen. Organization Login-Routen werden im zusammengesetzten Worker erkannt. Bekannte API-Routen fallen nicht mehr auf die SPA oder den generischen API-404 zurück.

Genehmigte Main-Domains sind Aliase desselben Workers und derselben D1. Sie verwenden dieselben Organization-, Campaign-, Map-, Street-, House- und Change-Feed-Daten. Sessions bleiben durch sichere `__Host-`-Cookies je Origin getrennt, und Writes bleiben same-origin geschützt. Hostnamen sind kein Bestandteil fachlicher IDs.

## Production-Status

Der Code ist ein Aktivierungskandidat. Production wurde nicht deployed, Production-D1 wurde nicht migriert und Secrets wurden nicht verändert. Vor Merge und Aktivierung müssen die Voraussetzungen in `docs/status/MAIN_RUNTIME_PARITY_HANDOFF.md` vollständig nachgewiesen werden. Main-Merges lösen den Production-Build aus und benötigen deshalb Masters separate Freigabe.

## Offene getrennte Arbeit

- Draft-PR #79 hält die Street-/House-Network-Arbeit und bleibt für diesen Main-only-Slice pausiert.
- SYNC-CURSOR-001 bleibt separat offen.
- Die bekannten Admin-Security-Findings SEC-001 bis SEC-007 und Fresh-MFA bleiben sichtbar und werden durch die Runtime-Komposition nicht als gelöst erklärt.
- Historische Feature- und Staging-Branches werden von Plan 033 nicht verändert oder portiert.
