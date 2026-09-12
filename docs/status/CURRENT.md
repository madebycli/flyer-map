---
id: status-current
type: status
status: active
last_updated: 2026-09-08
---

# Current Project State

## Aktuelle Untersuchung: PR #92, 2026-09-12

Phase A untersucht StreetEngine, systemweite D1-Lesekosten und Sync auf dem
Staging-Runtime-Stand `6adaf10`. Reproduktionstests und aktuelle CI-Nachweise
stehen im [laufenden Audit](STREET_ENGINE_D1_AUDIT.md). Reale Preparation-Ursache
und D1-Verbrauchszuordnung sind noch offen; kein Runtime-Fix oder Deploy in
dieser Untersuchung. Die folgenden älteren Stände sind historische Einordnung.

## Main Runtime plus Street/House Integrationskandidat

Die getrennte Integrationslinie kombiniert den grünen Main-Runtime-Kandidaten aus Draft-PR #80 mit der Street/House Network Recovery aus Draft-PR #79. Plan 032 und ADR-0027 führen kanonische Network-Coverage, House-Zuordnung, D1-Jobs, RxDB-Synchronisation und MapLibre-Darstellung in den vollständigen Organizer Worker ein.

`main` enthält die Organizer-/Admin-Oberfläche und die zugehörigen Organization-, Security- und Campaign-Module. Plan 033 verbindet diese ausgelieferte Oberfläche mit dem vollständigen Worker: `worker/indexOrganizer.ts` ist im Main-Kandidaten der kanonische Entry Point und umschließt weiterhin die bestehende Field-, Collection-, Pickup- und RxDB-Runtime.

Der Runtime-Vertrag `/api/runtime` meldet nicht-sensitive Capability- und Versionsinformationen. Organization Login-Routen werden im zusammengesetzten Worker erkannt. Bekannte API-Routen fallen nicht mehr auf die SPA oder den generischen API-404 zurück.

Genehmigte Main-Domains sind Aliase desselben Workers und derselben D1. Sie verwenden dieselben Organization-, Campaign-, Map-, Street-, House- und Change-Feed-Daten. Sessions bleiben durch sichere `__Host-`-Cookies je Origin getrennt, und Writes bleiben same-origin geschützt. Hostnamen sind kein Bestandteil fachlicher IDs.

## Production-Status

Live-Fortschritt nach Deployment `58d30cb`: Master bestätigt POST 202/pending,
anschließend failed mit `area_preparation_osm_failed`. Die Request-Annahme
funktioniert jetzt; Ready ist weiterhin nicht erreicht. Ein separater Workflow
`street-live-diagnostics.yml` liest ausschließlich aggregierte Schema-/Job-
Fehlerdaten aus der bestehenden Admin-Staging-D1, ohne Deploy oder Migration.
Der konkrete interne Job-Code muss vor einer weiteren Runtime-Korrektur gelesen
werden, da der öffentliche OSM-Fehler auch andere Job-Fehler zusammenfasst.

Street-Live-Fixkandidat: Ein leerer POST-Body-Stream wurde von `/preparation`
fälschlich als Client-Payload mit HTTP 400 abgewiesen. Die Prüfung akzeptiert
jetzt nur tatsächlich leere Streams und verwirft weiterhin jedes Nutzdatenbyte,
auch bei behauptetem Content-Length 0. Die UI nennt bei Ablehnung den HTTP-Status.
23 fokussierte Tests und der lokale JS-TypeScript-Check bestehen. Der lokale
Build-Aufruf wurde wegen abgebrochener Netzwerkfreigabe nicht ausgeführt.
Masters Live-Meldung (HTTP 400, 25 s, Antworttext in DevTools nicht verfügbar)
passt zum reproduzierten Fehler, beweist aber noch nicht die gesamte Ursache.
Deployment und authentifizierte Street-/House-/Sync-Live-Abnahme bleiben offen;
STREET_ENGINE_LIVE_READY bleibt FALSE.

Der Code ist ein Aktivierungskandidat. Production wurde nicht deployed, Production-D1 wurde nicht migriert und Secrets wurden nicht verändert. Vor Merge und Aktivierung müssen die Voraussetzungen in `docs/status/MAIN_RUNTIME_PARITY_HANDOFF.md` vollständig nachgewiesen werden. Main-Merges lösen den Production-Build aus und benötigen deshalb Masters separate Freigabe.

Draft-PR #80 hält die Main-Komposition getrennt von `main`. Runtime-Head `1c9e567abb2b37d585af5fc98d649485fbe35410` bestand CI Run `34214219630` vollständig. Die Street/House-Integration wird separat getestet; Production bleibt unverändert.

## Offene getrennte Arbeit

- Draft-PR #79 liefert die Street-/House-Network-Basis für die getrennte Integrationslinie.
- SYNC-CURSOR-001 bleibt separat offen.
- Die bekannten Admin-Security-Findings SEC-001 bis SEC-007 und Fresh-MFA bleiben sichtbar und werden durch die Runtime-Komposition nicht als gelöst erklärt.
- Historische Feature- und Staging-Branches werden von Plan 033 nicht verändert oder portiert.
