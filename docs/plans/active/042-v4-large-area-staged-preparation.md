# Plan 042: Street Engine V4 staged large-area preparation

## Tageslimit und Fortschrittsanzeige 2026-09-25

Der Nutzer meldet das erreichte tägliche Cloudflare-D1-Free-Limit für gelesene und geschriebene Zeilen. Deshalb keine weiteren Beta-D1-Abfragen, keinen Live-Retry und keinen Merge, dessen Beta-Release automatische D1-Migrationen ausführt, bevor das Limit zurückgesetzt ist. Die auf PR #129 veröffentlichte Diagnose hat `baseStep` und `baseFailureClass` ergänzt; es fehlt noch ein neuer echter Fehler-Snapshot.

HTTP-GET berechnete V4-`totalTiles` aus 102 Geometrie-Tiles, während WebSocket denselben Fortschritt mit 130 Quell-Shards meldete. Beide Wege verwenden jetzt die Shard-Zahl; in der Planungsphase ohne bekanntes Manifest erscheint noch keine erfundene Gesamtzahl. Ein erneut gestarteter äußerer Auftrag zeigt den alten fehlgeschlagenen V4-Job nicht mehr als aktuellen Fortschritt. Diagnostik- und Fallback-Polling laufen sequenziell und seltener, pausieren in versteckten Tabs; Präfixzugriffe auf Staging-Zeilen nutzen die bestehende Primärschlüssel-Reihenfolge. Das ist eine lokale Korrektur, keine bestätigte Beta-Veröffentlichung. Der echte D1-Verbrauch der gesamten Gebiet-8-Verarbeitung sowie der Base-Fehler bleiben offen.

## Post-PR-#128-Diagnose 2026-09-25

Der Gerätelog von 11:28 UTC meldet auf dem exakten neuen Beta-Worker erneut `street_engine_v4_publish_internal_failure` bei `v4-base` Cursor 0. Der Log wurde 514 ms nach einem erneuten Start kopiert, sodass äußere Preparation `pending` und noch alter V4-Job `failed` zugleich zu sehen sind. Die 55.270 Streets und 46.665 Houses stammen aus dem unmittelbar vorher fehlgeschlagenen Lauf, nicht aus dem eben gestarteten Retry. Der konkrete Fehler ist unbekannt: der Worker schreibt `baseStep` beim Catch, aber `worker/streetNetwork/diagnostics.ts` entfernt es aus dem öffentlichen Snapshot. Der nächste Beta-Fix gibt nur bekannte Base-Schritte und eine klassifizierte Fehlerart frei und testet den Diagnosevertrag. Das 220-KB-Feed-Limit hat den Fehler offenbar nicht behoben; einen anderen Ursachenfix darf der Log nicht vortäuschen.

## Post-PR-#127-Retry-Befund 2026-09-25

PR #127 wurde auf Beta veröffentlicht. Der echte Gebiet-8-Retry lud alle 130 Shards des aktuellen Packs und berechnete 55.270 Streets und 46.665 Houses. Der erste `v4-base`-Schritt endete mit dem generischen `street_engine_v4_publish_internal_failure`, ohne Veröffentlichung. Die konkrete Ausnahme ist bisher unbekannt. Die Feed-Paketierung erlaubt bisher nur 75 KB je Street, während die Basis 220 KB erlaubt; eine größere einzelne Geometrie kann daher erst beim Base-Schritt scheitern. Der Beta-Fix vereinheitlicht das Limit auf 220 KB, ergänzt einen Test mit >75 KB Street-Geometrie unter dem 50-Query-Alarm und speichert bei Fehlern den konkreten Base-Unterschritt und einen eigenen Row-Budget-Code. Der reale Lauf muss die Ursache beziehungsweise den Fix erst bestätigen.

## Post-Release-Befund 2026-09-24

PR #125 ist auf Beta deployed. Der echte Gebiet-8-Lauf blieb bei `v4-source` Cursor 0 ohne Job-Fehlversuch und endete durch den Runner-Absturzschutz mit `area_preparation_runner_unavailable`. Ein lokaler Replay mit dem bisherigen echten 130-Shard-Pack und `requestDatabase(db,50)` reproduzierte den nicht persistierbaren `d1_invocation_budget_exceeded` im ersten Source-Schritt. Ursache sind einzelne DELETE-/INSERT-Statements für bis zu 32 Node-Gruppen innerhalb eines Alarms. Auch die spätere Graph-Phase las 32 Usage-Gruppen einzeln. Gruppenschreibungen werden nun als begrenzte `json_each`-Batches ausgeführt und Graph-Usage in Achtergruppen gelesen. Derselbe 50-Statement-Replay erreicht nach 762 Arbeitsschritten `ready` mit 62.179 Streets / 52.276 Houses. CI, neuer Beta-Release und echter Gebiet-8-Retry sind für diesen Fix offen.

## Post-PR-#126-Retry-Befund 2026-09-25

PR #126 ist erfolgreich auf Beta deployed. Der neue echte Lauf schaffte die Source-Cursor 0 bis 7, endete dort aber mit `street_engine_v4_shard_size_mismatch`. Seine Staging-Plan-Metrik zeigte noch auf das vorherige Manifest `11bed2…`; der aktuelle Beta-Pointer ist `3f3e63…`. Ein Runner-Crash hatte nur die äußere Preparation auf `failed` gesetzt, während das V4-Job-Phase `v4-source` blieb. `beginAreaTaskPreparation` eröffnete dieselbe Generation neu, doch `resetV4RetryState` setzte bisher nur terminale V4- oder Legacy-Jobs zurück. Ein neuer `started_at` muss auch für einen mittleren V4-Job alle alten Source-/Staging-Zeilen verwerfen, unter Lease-/Generation-/Timestamp-Schutz. Ein laufender transienter Retry mit unverändertem Startzeitpunkt darf seine Attempt-Zahl behalten.

## Ziel

Gebiet 8 auf Beta mit ungefähr 55.216 Streets und 46.661 Houses reproduzierbar auf `ready` bringen, ohne einen V3/V2- oder Live-Overpass-Fallback.

## Ausgangspunkt und Anforderungen

- `.ai/CONTEXT.md` routet nach `madebycli/master-context/projects/flyer-map/INDEX.md`; dessen `handoffs/CURRENT.md` und `RELEASE_CHANNEL_INVARIANT.md` sind für Release-Status maßgeblich.
- Live Beta Release #38 läuft auf `1937868f5e0ee7522134da1850262dacc97ce124`. Neueste Gerätediagnose: Source-Auswahl kann bei einem Retry vor den Shards generisch fehlschlagen; der vorherige Versuch scheiterte am Graph-Budget.
- Bestehende Source-Packs bleiben unveränderlich. Produktkapazität und Byte-/CPU-/D1-Sicherheitsgrenzen bleiben getrennt. Generation, Geometrie und Lease schützen jeden Schritt; produktive Daten werden atomar sichtbar.
- Die IDs, Junctions, House-Zuordnung, der Result-Hash und die Zähler müssen unabhängig von Shard- und Alarm-Timing deterministisch sein.

## Architektur und Dateistruktur

- `worker/streetNetwork/v4StagedPreparation.ts`: Source-Auswahl, shardweise Source-, Graph-, Address- und Link-Phasen, gebucketete Basis-/Feed-Daten und guarded Publish.
- `worker/streetNetwork/v4Preparation.ts`: V4-only Retry-Migration und Diagnose-Normalisierung.
- `worker/areaTaskPreparation.ts`: serverseitiger Job-Lifecycle und Durable-Object-Alarme.
- `tests/streetEngineV4Recovery.test.ts`: echte mehrstufige Recovery-, Budget- und Determinismus-Regressionen.

## Umsetzungsschritte und Abnahme

1. PR #125 gegen aktuelle Beta-Basis fertigstellen: alle fünf bisherigen CI-Fails als mehrstufige Lifecycle-Tests reparieren, transienten Source-Retry ohne verlorenes Attempt-Budget fortsetzen und Fehlercodes je Phase sicher normalisieren.
2. Semantik mit Gebiet-7-Fixture und realen Source-Assets vergleichen. Ein read-only Replay der aktuellen 130 Beta-Shards mit rechteckiger Gebiet-8-BBox erreichte lokal `ready`: 62.179 Streets, 52.276 Houses, 64.650 source-addressable Buildings, 118,7 MiB V8-Heap-Peak, höchstens 12 Statements pro D1-Batch. Die BBox ist größer als das exakte Gebiet; dessen Polygon und die Cloudflare-Laufzeit bleiben reale Abnahme-Gates.
3. Full CI, Typecheck, Dependency-Audit, Production Build und unabhängiges Scale Audit auf unverändertem finalen PR-Head verifizieren.
4. PR nach grünen Gates mergen, ausschließlich Beta releasen, exakten Runtime-Commit prüfen. Authentifizierten Gebiet-8-Retry, Rendering, Reload, Android und zweiten Client real abnehmen; Gebiet 7 erneut prüfen.
5. Kontext-Handoff, Status, Tests und Release-Evidenz aktuell halten. `STREET_ENGINE_LIVE_READY` erst nach allen Feldgates auf `TRUE` setzen.

## Risiken und offene Fragen

- `UNKLAR:` Grund des neueren Source-Auswahlfehlers nach zwei Object-Gets. Der alte Catch verschleiert den konkreten Fehler. Neue V4-Diagnose auf Beta ist für die Feldursache nötig.
- `UNKLAR:` tatsächliche Cloudflare-Isolate-/D1-Grenzen und reales Area-Polygon. Der 128-MiB-Real-Pack-Replay mit BBox ist lokal erfolgreich, aber der in-process SQLite-Test erreicht etwa 1,16 GiB RSS und bildet Cloudflare-D1 nicht ab.
- Ein lokaler RxDB-Zweittab-Test benötigt Unix-Sockets und scheitert in der aktuellen Sandbox mit `EPERM`; CI muss ihn auf einem geeigneten Runner verifizieren.
- Kein Production/Main-Eingriff und keine implizite Produktentscheidung über geänderte House-Qualität.
