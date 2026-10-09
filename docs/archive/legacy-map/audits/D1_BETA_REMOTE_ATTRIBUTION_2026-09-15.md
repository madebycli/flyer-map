# D1 Beta Remote Attribution — 2026-09-16

## Methode und Safety Boundary

Ein GitHub-Actions-Audit führte auf `beta` genau einen echten `prepareAreaTasks()`-Lauf gegen die isolierte Beta-Umgebung aus. Die Fixture enthielt 20 Straßen und 260 absichtlich unadressierte Häuser. Ein temporärer Worker erzeugte nur synthetische OSM-Antworten. Es gab keinen Production-Deploy, keinen Production-D1-Zugriff, keine große Fixture und keine Nutzerdaten-Mutation. Fixture und Audit-Worker wurden nach dem Lauf erfolgreich gelöscht.

## Pre-Fix

- Fix-Kandidat vor dem Remote-Nachtest: `3fd06fe091e32a6b74183c390fef309dbc41aec4`
- Fehlgeschlagener Candidate-Gate: Release `35022905369`
- Kontrollierte Pre-Fix-Attribution: Release `35022122651`, Attribution `35022122658`
- Ergebnis: 1.638 Rows Read, 135 Rows Written, 107 Worker-Queries, 48 Batches, ungefähr 8.326 ms Worker-Laufzeit, 38.63 ms D1-SQL-Dauer.
- Root Cause im kontrollierten Workload: `SELECT name FROM sqlite_master WHERE type='table' AND name='street_base_chunks'` erzeugte 1.470 Rows Read.

## Fix

`hasBaseStorage()` verwendet nun `PRAGMA table_info(street_base_chunks)`, erkennt die erwartete `payload_json`-Spalte und cached nur positive Befunde pro D1-Binding über `WeakSet`. Negative Befunde bleiben ungecached, damit spätere Migrationen erkannt werden. Die Regression `tests/baseStorageSchemaProbe.test.ts` prüft genau diese Invarianten.

Der erste Release scheiterte nicht am Fix, sondern an einem vorhandenen Testdouble ohne `.all()`. Der minimale Testdouble-Fix wurde mit `8c30708d8e8d95d6e927ca920c7306e54b320667` ergänzt. Der Einmal-Dispatcher `4d016bcd09d7ac15dab9df0de2563db4269f7373` wurde mit `fa159ca8e3f1c20ae2817ebe2a111790a47758c2` entfernt.

## Post-Fix-Messung

- Audit-Commit: `2ccd1cef0e91e50c5b13974acc1e08a8fa9d73c8`
- Beta-Release: `35060954547` PASS
- D1-Attribution: `35060954577` PASS
- Ergebnis: `ready`, 20 Straßen, 260 Häuser, 107 Worker-Queries, 48 Batches, 5.025 s Worker-Dauer.
- D1-Insights-Differenz: 189 Rows Read, 105 Rows Written, 128 Insights-Query-Ausführungen, 73.6178 ms D1-Dauer.
- `PRAGMA table_info(street_base_chunks)`: vier Ausführungen, 0 Rows Read.
- Der alte `street_base_chunks`-`sqlite_master`-Fingerprint ist nicht mehr vorhanden.
- Der größte verbleibende Read-Fingerprint ist der unadressierte `edges`-Staging-Fallback mit 63 Rows Read. Er ist materiell, aber nicht der allein klar dominierende Nachfolge-Hotspot.

## Aussagegrenze

`D1_CONTROLLED_ATTRIBUTION = PASS`. Der Test beweist die Ursache und Wirkung in diesem kontrollierten Workload. `D1_HISTORICAL_4_5M_ATTRIBUTION = OPEN`: Der historische Vorfall wird ohne query- und zeitfenstergenaue Billing-Evidenz nicht prozentual diesem Pfad zugerechnet.
