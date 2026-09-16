# Street Engine V3 Greenfield Plan

Stand: 2026-09-16
Basis: `beta@5aa61866ec6e9a4dd8d369cf34348c13502d38e7`
Branch: `feat/street-engine-v3-greenfield`

## Ziel

Street Engine V3 wird nicht als Optimierung des heutigen Overpass-/D1-Staging-Pfads behandelt. Primäres Ziel ist eine Cloudflare-Free-Tier-sichere Architektur mit reproduzierbarem Gebiet-3-Cold-Run <=60 s, Zieltransfer <=20 MB, Hard Stop >40 MB, deterministischem Resume und ohne Public-Overpass-Abhängigkeit im Normalpfad.

## Architekturentscheidung

Die Datenarchitektur ist **D: precompiled StreetEngine-ready Packs**. Das Production-Ausführungsmodell ist **E: Browser normal path + bounded server verifier/fallback**, sofern der Device-/Resource-Benchmark den Browserpfad bestätigt.

Schwere deterministische Arbeit wird aus dem User-Request-Pfad in einen Build Plane verschoben:

- OSM-Road-Normalisierung
- Building-Polygon-Validierung
- Address-Normalisierung und Addressable-Status
- Road-Segmentierung und Graph-Metadaten
- Spatial Indexes
- stabile Source-IDs
- Building-Interior-Points
- top-K Building-to-Road-Kandidaten mit Distanz, Snap-Measure und Address-Match
- Border-/Shard-Metadaten

Runtime bleibt area-spezifisch:

- Manifest/Source-Version pinnen
- relevante Shards bestimmen
- exakten Area-Polygon-Filter anwenden
- Road-Segmente an frei gezeichneter Area-Grenze clippen
- vorkompilierte House-to-Road-Kandidaten auf aktive Segmente abbilden
- generation-spezifische Task-IDs erzeugen
- Auth/Reconciliation
- atomar publizieren

## Storage Split

R2/static:

- immutable content-addressed Source-Shards
- immutable Manifest-Objekte
- optional immutable Result-Packs

D1:

- Campaign-/Area-Metadaten
- aktiver/previous Source-Manifest-Hash
- Result-Pack-Hash und Generation
- kleine Counts/Audit-Metadaten
- User-Status, Kommentare und Overlays

D1 darf im V3-Normalpfad kein Raw-OSM, keine Source-Tile-JSONs und keine tausenden generation-scoped Geometrie-Staging-Chunks halten.

## Resource Budget

Für 50 vollständige Runs/Tag werden maximal ca. 20-25 % der harten Account-Limits geplant. Engineering-Ziele pro Gebiet-3-Run:

| Ressource | Ziel |
|---|---:|
| Worker Requests | <=100 |
| D1 Rows Read | <=10.000, bevorzugt <=5.000 |
| D1 Rows Written | <=500, bevorzugt deutlich weniger |
| DO Requests | <=100 |
| DO Duration | <=25 GB-s bevorzugt |
| R2 Class-B Origin Reads | <=200 |
| R2 Class-A Writes | möglichst einstellig |
| Browser Download | <=20 MB Ziel, >40 MB Hard Stop |
| Browser Upload | <=5 MB Ziel |

## Aktueller Befund

Der reale Gebiet-3-Lauf misst `activeElapsedMs=615168`, `wallElapsedMs=680301`, erfolgreiche Fetches `213991 ms`, Graph `4036 ms`, Address `1754 ms`, Link `14192 ms`, Publish `1497 ms`.

Damit sind Graph + Address + Link + Publish zusammen nur 21,479 s bzw. ca. 3,49 % der Active-Zeit. Ein Sprachwechsel des heutigen Runtime-Hotpaths ist deshalb kein ausreichender Architekturhebel.

Query Insights zeigte für `SELECT name FROM sqlite_master WHERE type='table' AND name='street_network_jobs'` ca. 1.808 Aufrufe und 442.960 Rows Read, also 245 Rows Read pro Aufruf. Bei 2-s-Polling über einen ca. 680-s-Lauf ergeben sich allein grob 83k Rows Read für diesen Status-Schema-Check. Mit Runner-/Base-Storage-Schema-Probes liegt die codebasierte Untergrenzen-Schätzung um 100k Rows Read pro Run. Das ist keine exakte Run-Billing-Attribution, aber bereits architektonisch inakzeptabel.

## Source-Format-Spikes

Pflichtvergleich:

1. kleine immutable, größenbegrenzte binäre Spatial-Shards, bevorzugter erster Spike;
2. FlatGeobuf als etablierte Control mit Remote Spatial Filtering;
3. PMTiles nur als Rendering-Option, nicht automatisch Source-of-Truth;
4. Parquet/DuckDB-Wasm als Research-Control, nur übernehmen wenn es den spezialisierten Pfad messbar schlägt.

Keine starre NRW-Zelllogik. Bevorzugt ist ein globaler räumlicher Schlüssel mit adaptiver, größenbegrenzter Zellteilung. Start-Hypothese: ca. 256 KB bis 1 MB komprimiert pro Shard, Hard Max ca. 2 MB. Diese Zahlen sind Benchmarkparameter, keine finale Spezifikation.

## Sprache

Rust nativ ist ein starker Builder-Kandidat. TypeScript bleibt Standard für UI, Orchestration, Worker lifecycle und API-/Manifest-Verträge. Rust/WASM im Browser wird nur gewählt, wenn der identische Device-Benchmark einen materiellen Gewinn zeigt, z. B. >=2x Hotpath-Speedup, deutlich weniger Peak Memory oder wenn TypeScript das iPad-Gate verfehlt.

Der aktuelle reale Lauf beweist bereits, dass Rust/WASM allein den heutigen 10-Minuten-Pfad nicht retten kann, da der gemessene Geometrie-/Link-/Publish-Anteil nur ca. 3,5 % ausmacht.

## Benchmark-Matrix

Fixtures:

- real Gebiet 3, ca. 6.500 Source Buildings / 2.630 Houses / ca. 1.200 Roads
- real ca. 602 Houses
- synthetic 5k / 10k / 20k Houses

Geräte:

- aktuelles iPad Safari
- Desktop Safari
- Desktop Chrome
- Desktop Edge
- schwächeres Mobilgerät

Messen:

- cold p50/p95/p99
- warm p50/p95
- download/upload bytes
- Browser CPU und Peak Memory
- Server CPU
- Worker/DO Requests und DO Duration
- D1 Rows Read/Written
- R2 A/B
- Storage footprint
- Source update cost
- Publish cost
- Failure recovery

## Umsetzungsschritte

1. Baseline-Fixtures einfrieren und semantischen Result-Hash definieren.
2. Benchmark-Harness mit maschinenlesbarer Resource-Ausgabe bauen.
3. D-Builder-Spike für OSM-PBF -> StreetEngine-ready intermediate.
4. Binary-Shard- und FlatGeobuf-Ausgabe gegen identische Daten bauen.
5. TypeScript Web Worker gegen beide Source-Varianten bauen.
6. Rust-native Builder und optional Rust/WASM Worker-Core gegen identische Fixture bauen.
7. Thin Server Selector/Verifier mit Resource Counter bauen.
8. Browser-Preflight und 40-MB-Circuit-Breaker bauen.
9. R2 immutable Source/Result Store + D1 tiny manifests bauen.
10. E-Hybrid mit Resume, stale-cache, source-flip und server fallback testen.
11. Shadow-Vergleich V2/V3 auf identischen Areas.
12. Erst nach grünen Gates die alte Overpass-/D1-Staging-Engine aus dem Normalpfad entfernen.

## Offene Fragen / UNKLAR

- `UNKLAR`: exakte D1 Rows Read/Written des realen Gebiet-3-Runs aus Cloudflare Billing/Query Insights.
- `UNKLAR`: echte billable DO Duration dieses Runs.
- `UNKLAR`: V3 Cold-Transfer für Gebiet 3.
- `UNKLAR`: aktuelles iPad Peak Memory.
- `UNKLAR`: TypeScript-vs-Rust/WASM Sieger.
- `UNKLAR`: FlatGeobuf-vs-Binary-Shard reale Bytes/Range-Request-Latenz.
- `UNKLAR`: ob der Server-Verifier so billig wird, dass er kanonisch rechnen kann und Browsercompute nur Preview bleibt.

## Acceptance Gate

Der große Rewrite ist noch nicht freigegeben. Freigabe erst nach reproduzierbarer Messung der Pflichtspikes und mindestens:

- Gebiet-3 cold p95 <=60 s
- Ziel <=20 MB Download, >40 MB unmöglich durch Preflight
- D1 <=10k Rows Read/Run, bevorzugt <=5k
- D1 <=500 Rows Written/Run
- Worker <=100 Requests/Run
- DO <=100 Requests/Run
- kein Public Overpass im Normalpfad
- immutable Source-Versionen und atomic manifest switch
- deterministischer Result-Hash
- kein Partial Publish
- GC für Source, Result, Browser-Cache und temporäre Zustände

## Release

Entwicklung bleibt auf Branch von aktuellem `beta`. Nach vollständigen Tests/Benchmarks PR nach `beta`, Merge, exakten Beta-SHA verifizieren, bestehenden Beta-Release auf exakt diesen SHA deployen und `/api/runtime` gegen denselben SHA prüfen. Erst danach echter Beta-/iPad-Test. `main` bleibt unangetastet.
