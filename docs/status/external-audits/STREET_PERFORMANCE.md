# Street Performance

## Basis

- Draft-PR: #84
- Ausgangs-Head: `c2bf0bf0ef12704ce52612181dbb574837d77749`
- Ausgangs-CI: Run `34217850254`, PASS
- Ergänzung: `tests/mainStreetPerformance.test.ts`

## Messmatrix

| Umfang / Bereich | Status | Messwert / Kriterium |
| --- | --- | --- |
| 1.000 Häuser | PASS | Bestehender Performance-Test läuft auf dem exakten Ausgangs-Head in CI erfolgreich |
| 5.000 Häuser | PASS | Bestehender Performance-Test läuft auf dem exakten Ausgangs-Head in CI erfolgreich |
| 10.000 Häuser | BLOCKED | Neuer Audit-Test ist angelegt und schreibt `totalMs`, `heapDeltaBytes`, Requests, maximale SQL-Batchgröße und Job-Metriken als Test-Diagnostik. Belastbare Werte entstehen erst im Audit-PR-Runner |
| Overpass-Bounds / Requests | PASS für vorhandene Pipeline, 10k BLOCKED | 10k-Test erwartet exakt zwei kontrollierte Overpass-Antworten, Straßen und Gebäude |
| Graph-Aufbau | PASS bis 5k, 10k BLOCKED | Erfolgreiche bestehende Performance-Suite bis 5k, 10k wird im neuen Audit-Test durch 40 Straßen plus 10.000 Gebäude belastet |
| Räumliche Zuordnung | PASS bis 5k, 10k BLOCKED | 10k-Test fordert 10.000 von 10.000 Houses mit `parentStreetTaskId` |
| SQL-Batchgröße | 10k BLOCKED | Audit-Kriterium `maxBatchStatements < 50` |
| Speicher | 10k BLOCKED | Audit-Test misst `process.memoryUsage().heapUsed` vor und nach der Pipeline |
| Render-/Sync-Daten | 10k BLOCKED | Audit-Test fordert 10.000 persistierte House-Dokumente und 10.000 `campaign_sync_changes` für `houseTasks` |
| Deterministische Street-IDs | PASS statisch, Runner-Bestätigung BLOCKED | Neuer Test beweist gleiche ID bei umgekehrter Linienrichtung und andere ID bei anderer OSM-Way-ID |

## Runner-Hinweis

Die bestehende 1k/5k-Evidenz stammt aus GitHub Actions auf Run `34217850254`. Die konkrete CPU-/RAM-Ausstattung wurde über die verfügbare Connector-Evidenz nicht belastbar als Hardware-Metadatum bereitgestellt, deshalb wird hier keine Hardware erfunden. Der neue 10k-Test protokolliert Laufzeit und Heap-Differenz direkt im Test-Runner.

## Bewertung

Aktuell gibt es keinen gemessenen P0-Engpass und damit keinen Grund für Produktcode- oder Mikrooptimierungen. Die 10k-Stufe ist bewusst als Audit-Lasttest ergänzt, ohne die Produktionspipeline zu verändern.

## Empfehlungen

1. Den neuen 10k-Test einmal im gestapelten Audit-PR auf demselben CI-Typ laufen lassen.
2. Nur bei reproduzierbarem Ausreißer die Diagnose auf Graph-Aufbau, räumliche Zuordnung, D1-Batches oder Sync-Change-Erzeugung eingrenzen.
3. Keine Optimierung allein aufgrund synthetischer Vermutung einführen.
4. Bei erfolgreichem 10k-Lauf die im CI ausgegebenen `totalMs`- und `heapDeltaBytes`-Werte in diesen Bericht übernehmen.

## Geänderte Dateien

- `tests/mainStreetPerformance.test.ts`
- `docs/status/external-audits/STREET_PERFORMANCE.md`

## Sicherheitsgrenzen

Kein Merge, kein Deploy, kein Production-D1-Write und kein Secret-Zugriff.
