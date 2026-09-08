# Street Product Flow

## Basis

- Draft-PR: #84
- Ausgangs-Head: `c2bf0bf0ef12704ce52612181dbb574837d77749`
- Audit-Test: `tests/mainStreetProductFlow.test.ts`

## Testmatrix

| Produktstufe | Status | Evidenz |
| --- | --- | --- |
| Area erstellen | PASS | Neuer Regressionstest führt `area.create` über `handleCampaignMutation` aus |
| Serverseitige Street-/House-Vorbereitung | PASS | Neuer Test führt `prepareAreaTasks` mit kontrolliertem OSM-Fixture aus |
| Persistierte Streets/Houses | PASS | Neuer Test prüft Campaign-Snapshot sowie `street_network_streets` und `street_network_houses` |
| RxDB Pull für Street/House | PASS | Neuer Test prüft `tasks` und `houseTasks` über den echten Worker-Pull-Handler |
| A/B-Abdeckung | PASS | Bereits in `tests/streetNetworkIntegration.test.ts` als Street-/House-Abdeckung über Network-Intent geprüft |
| House-Fortschritt | PASS | Bestehende Street-Network-/House-Persistenztests prüfen House-Status über M5 und den Change Feed |
| RxDB Push | PASS | `tests/streetNetworkIntegration.test.ts` prüft House-Push über `MissionRxdbSync` |
| Zweiter Client / Konvergenz | PASS | `tests/streetNetworkIntegration.test.ts` prüft zwei echte RxDB-Instanzen gegen dieselbe Worker-Runtime |

## Geänderte Dateien

- `tests/mainStreetProductFlow.test.ts`
- `docs/status/external-audits/STREET_PRODUCT_FLOW.md`

## Blocker

Keine reproduzierbare Produktcode-Regression aus der vorhandenen Suite und dem ergänzten fehlenden Eintrittspfad. Deshalb wurde kein Produktcode geändert.

## Sicherheitsgrenzen

Kein Merge, kein Deploy, kein Production-D1-Write und kein Secret-Zugriff.
