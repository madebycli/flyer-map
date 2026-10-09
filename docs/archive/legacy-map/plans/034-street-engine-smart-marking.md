# Street Engine und direktes Smart Marking

## Ziel
Adressierbare Zustellziele, serverseitig fortgesetzte Vorbereitung, direktes A/B-Markieren und konsistentes Gebietslöschen.

## Anforderungen
Basis: PR #84, `f4facd6ef354c5ba6de861519b696bce6f46a209`. Keine Production-Aktion, keine neue kostenpflichtige API. Kanonische D1-Geometrie, Generation-Leases, atomarer Feed-Publish und Campaign-/Team-Autorisierung bleiben verbindlich.
Kontext: ADR-0027, ADR-0024/0025, Map, Offline Sync, Security, Quality.

## Architektur
1. Browsergetriebene D1-Schritte: bestehender TypeScript/React/Worker-Stack; Browser POST -> D1-Lease -> OSM -> Staging -> Publish. Niedrige Komplexität, aber ohne Browser keine Fortsetzung und künstliche Wartezeit je Schritt.
2. Persistenter Alarm auf vorhandener Durable-Object-Infrastruktur: autorisierter POST -> D1-Job und Alarm -> begrenzte Arbeitsschritte -> atomarer Publish; Browser liest Status. Mittlere Komplexität, unabhängig vom Browser, zusätzliche begrenzte DO-Ausführungen, keine neue externe API.
Empfehlung und technische Auswahl gemäß Auftrag: Ansatz 2. Vorhandene geometrische Pipeline bleibt wegen Generation- und Feed-Verträgen; adressbasierte Normalisierung ersetzt ungefilterte Buildings. Öffentliche OSM-Verfügbarkeit bleibt eine externe Grenze, keine garantierte 2-/10-Sekunden-SLA.

## Dateistruktur
Erste drei Dateien:
1. Dieser Plan: Scope, Entscheidungen, Abnahmekriterien und offene Gates.
2. `worker/streetNetwork/addresses.ts`: normalisierte postalische Adressen und deterministische Address-Node-Zuordnung.
3. `tests/streetEngineRecovery.test.ts`: Regressionen für Adressen, Fortsetzung und Löschung.
Weitere Änderungen: Preparation-Pipeline, Alarm-Ausführung, öffentliche Statusprojektion, Network-Workspace und RxDB-Materialisierung.

## Umsetzungsschritte
1. [x] PR-/Headstand und Repository-Verträge lesen.
2. [ ] Ursachen reproduzieren und Adressregeln absichern.
3. [ ] Serverfortsetzung und echten öffentlichen Fortschritt implementieren.
4. [ ] Direktes Smart Marking und klare Vorschau integrieren.
5. [ ] Parent-Delete als einzigen lokalen Schreibauftrag verwenden; kanonische Child-Tombstones synchronisieren.
6. [ ] Kleine, mittlere und XXL-Fixtures messen; Regressionen, Typecheck und Build ausführen.
7. [ ] Diff und Dokumentation prüfen, gestapelten Draft-PR erstellen, CI prüfen.

## Offene Fragen / Unklarheiten
- UNKLAR: Der gemeldete Text `Overpass client unavailable for preparation request` ist am aktuellen Head nicht enthalten. Live-Ursache braucht Runtime-/Request-Evidenz; nicht als behoben behaupten.
- UNKLAR: Aktuelle authentifizierte Staging-Abnahme und reale OSM-Laufzeiten.
- Echte Android-/iPhone-Abnahme bleibt separat erforderlich.
- SYNC-CURSOR-001 und Admin-Security-Findings sind keine implizit gelösten Befunde.

## Risiken und Nicht-Ziele
Keine Migration bestehender bearbeiteter House-Identitäten ohne Nachweis. Kein neuer SaaS-Provider, kein Merge, kein Production-Deploy. Keine Fake-Prozentwerte oder Fehlerunterdrückung. Abnahme verlangt konsistente Tombstones auch nach Offline-Reconnect.

## V5 budget pivot, 2026-09-09

Checkpoint `fce8c58713c1f8c0b20e4a5544040accb8042370` preserves the initial recovery.
ADR-0029 replaces the earlier assumption that per-entity persistence can remain.
The local audit proves that recovery alone does not meet the 10k Free budget.

- [x] Local trigger-based budget adapter and 400/1k/5k/10k baseline.
- [x] Record three storage alternatives, OSS evaluation and selected design.
- [x] Make remote Street workflows dispatch-only; no remote D1 run.
- [ ] Measure create and geometry delta actions; distinguish blocked actions.
- [ ] Implement chunk base and overlays, compact feed and targeted reads.
- [ ] Automatic create/geometry preparation and preserved user work.
- [ ] Push-driven progress with sparse fallback.
- [ ] Budget regression, UI/replication integration, final build and exact-head CI.
- [ ] One selected small staging acceptance with real D1 metadata, if available.

Do not mark the feature complete while these gates remain open.

## Verbindlicher Zusatzauftrag: Cloudflare, Server und Browser

Master meldet tatsächlich `Your D1 rows_read limit has been exceeded`. Die konkrete
Zuordnung zu einem Live-/Staging-Pfad ist noch nicht durch Account-Metadaten belegt.
Dieser Zusatz ersetzt keinen Punkt des Hauptauftrags. Er erweitert dieselben Gates:

1. Cloudflare-Grenzen für D1, Workers CPU/Requests/Subrequests, DO, R2, Queues und
   Workflows anhand offizieller Dokumentation verifizieren und in ADR-0029 ergänzen.
2. Budgetmessungen um leere Campaign, vollständige Worker-/DO-Invocations, Create
   und +500/-500 Geometry-Delta erweitern; EXPLAIN für MAX(seq), Scope-/Pull-Reads.
3. Zielgerichtete Collection-Synchronisation, sparsame Checkpoints, Push-Progress
   und kostengünstige Recovery direkt im bestehenden Sync-/Lifecycle-Punkt umsetzen.
4. Leere Campaign und 10k Browser-Pfade profilieren: Bundle, Initial Requests, RxDB
   Startup, Materialisierung, MapLibre setData, Render-/Main-Thread-Arbeit. Gemessene
   Bottlenecks gezielt reduzieren; fehlende reale Gerätewerte sichtbar kennzeichnen.
5. End-to-End-, Budget-, Startup- und Sync-Regressionen, Build, Typecheck und
   Produkttests als gemeinsame Abschlussgates. Bericht um Server-/Browser-Vergleich,
   Pulls je Aktion und ehrliche Free-Tier-Bewertung für typische Nutzung ergänzen.

Kein Paid-Upgrade als Problemlösung, keine Production-Aktion und keine unnötigen
Remote-D1-Runs. Lokale Schätzungen bleiben ausdrücklich von Billing-Meta getrennt.
