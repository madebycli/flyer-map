# Plan 042: Street Engine V4 staged large-area preparation

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
2. Semantik mit Gebiet-7-Fixture und realen Source-Assets vergleichen. Gebiet 8 read-only mit 128 MiB Heap bis zum vollständigen staged Publish simulieren, inklusive Peak-Heap, D1-Batches, Result-Hash und Entity-Zahlen.
3. Full CI, Typecheck, Dependency-Audit, Production Build und unabhängiges Scale Audit auf unverändertem finalen PR-Head verifizieren.
4. PR nach grünen Gates mergen, ausschließlich Beta releasen, exakten Runtime-Commit prüfen. Authentifizierten Gebiet-8-Retry, Rendering, Reload, Android und zweiten Client real abnehmen; Gebiet 7 erneut prüfen.
5. Kontext-Handoff, Status, Tests und Release-Evidenz aktuell halten. `STREET_ENGINE_LIVE_READY` erst nach allen Feldgates auf `TRUE` setzen.

## Risiken und offene Fragen

- `UNKLAR:` Grund des neueren Source-Auswahlfehlers nach zwei Object-Gets. Der alte Catch verschleiert den konkreten Fehler. Neue V4-Diagnose auf Beta ist für die Feldursache nötig.
- `UNKLAR:` 128-MiB-Real-Pack-Replay und tatsächliche Cloudflare-Isolate-/D1-Grenzen. Synthetische lokale Zahlen belegen keine Cloudflare-Eignung.
- Ein lokaler RxDB-Zweittab-Test benötigt Unix-Sockets und scheitert in der aktuellen Sandbox mit `EPERM`; CI muss ihn auf einem geeigneten Runner verifizieren.
- Kein Production/Main-Eingriff und keine implizite Produktentscheidung über geänderte House-Qualität.
