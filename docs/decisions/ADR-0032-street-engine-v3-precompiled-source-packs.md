# ADR-0032: Street Engine V3 vorkompilierte Source-Packs

Status: **ACCEPTED**  
Stand: 2026-09-16

## Supersession

Dieses ADR setzt für Street Engine V3 die im Auftrag vom 2026-09-16 festgelegte Free-Tier-First-Greenfield-Richtung um. Es superseded die Compute-Default-Entscheidung aus ADR-0031 für V3. ADR-0031 bleibt historische Evidenz für die damalige V2-Entscheidung. Autorisierungs-, Sync- und User-State-Grenzen werden nicht stillschweigend aufgehoben.

## Problem

Die bestehende StreetEngine bereitet OSM-Daten im User-Request-Pfad auf. Der reale Gebiet-3-Lauf benötigte `activeElapsedMs=615168` und `wallElapsedMs=680301`; Public-Overpass-Retries, D1-Staging und wiederholte Schema-/Statuspfade sind damit Teil des normalen Laufzeitrisikos. Das kollidiert mit dem neuen höchsten Architekturziel: StreetEngine darf Cloudflare-Free-Tier-Quoten der restlichen Anwendung nicht gefährden.

Ein bloßer Sprachwechsel löst das nicht. Der gemessene Graph-/Address-/Link-/Publish-Anteil des realen Laufs beträgt nur rund 21,5 Sekunden. Der größere Hebel ist, deterministische OSM-Aufbereitung aus dem User-Request-Pfad zu entfernen.

## Entscheidung

Street Engine V3 verwendet **vorkompilierte, immutable, content-addressed Source-Packs**.

Der Build Plane darf außerhalb des Cloudflare-Request-Pfads laufen und erledigt so viel deterministische Arbeit wie möglich, insbesondere:

- Road-Normalisierung;
- Building-Polygon-Validierung;
- Adressnormalisierung und Addressable-Status;
- Road-Segmentierung und Graph-Metadaten;
- Building-Interior-Points;
- räumliche Indizes;
- stabile Source-IDs;
- mehrere deterministisch sortierte House-to-Road-Kandidaten mit Distanz/Snap-Metadaten;
- Shard-/Border-Metadaten.

Die Runtime bleibt auf Area-spezifische Arbeit begrenzt:

- Source-Manifest pinnen;
- relevante Shards auswählen;
- Transferbudget vor dem Fetch prüfen;
- Area-Polygon exakt anwenden;
- Road-Segmente an der Area-Grenze clippen;
- vorkompilierte Kandidaten auf aktive Segmente abbilden;
- generation-spezifische IDs bilden;
- Auth/Reconciliation;
- atomar publizieren.

## Storage

Bevorzugtes Production-Modell:

- **R2/static:** immutable Source-Shards, immutable Manifeste und optional immutable Result-Packs;
- **D1:** Campaign-/Area-Metadaten, aktive Manifest-/Result-Referenzen, kleine Counts/Auditdaten, User-Status, Kommentare und Overlays.

D1 ist im V3-Normalpfad kein Raw-OSM-Archiv und kein großvolumiger Geometrie-Staging-Store.

Große Objekte werden nur über einen validierten SHA-256 adressiert. Kein Client darf eine beliebige Source-URL vorgeben.

## Runtime-Ausführung und Trust

Zielmodell ist D+E aus dem Greenfield-Auftrag:

1. vorkompilierte StreetEngine-ready Packs als Datenarchitektur;
2. Browser/Web Worker als normaler Compute-Kandidat, sofern Device-Benchmarks ihn bestätigen;
3. bounded Server-Verifier/Fallback mit demselben deterministischen Vertrag.

Ein Browser ist keine Vertrauensgrenze. Ein Browserresultat darf nicht allein aufgrund eines Client-Hashes kanonisch werden. Der Server prüft mindestens Source-/Algorithmus-/Area-Hash, Schema, Bounds, Counts, Source-IDs und Result-Hashes; die genaue Verifikationsstärke wird benchmarkbasiert festgelegt.

## Resource Gate

Jede Generation wird gegen ein StreetEngine-eigenes Budget geprüft. Startziele pro Gebiet-3-Run:

- Worker Requests <=100;
- D1 Rows Read <=10.000, bevorzugt <=5.000;
- D1 Rows Written <=500;
- DO Requests <=100;
- R2 Class-B Origin Reads <=200;
- Browser Download <=20 MiB Ziel;
- Browser Download >40 MiB: Hard Stop;
- Browser Upload <=5 MiB Ziel.

Die Werte sind Subsystembudgets, nicht Cloudflare-Kontolimits.

## Source-Format

Der erste Production-Kandidat sind kleine immutable binäre Spatial-Shards. FlatGeobuf bleibt die verpflichtende Benchmark-Control. PMTiles ist primär Rendering-Kandidat. Parquet/DuckDB-Wasm wird nur übernommen, wenn reale Messungen den spezialisierten Pfad schlagen.

Der erste binäre Vertrag heißt `street-engine-v3-binary-shard-v1`. Die konkrete Byte-Kodierung wird erst nach dem Format-Benchmark festgeschrieben; das Manifest und die Content-Addressing-Grenze sind bereits stabilisierbar.

## Globalität

Coverage wird über datengetriebene Manifeste/Catalog-Einträge beschrieben. Keine Engine-Logik darf NRW, Deutschland oder einen Geofabrik-Pfad hardcoden. Shard-Bounds sind global in WGS84 definiert; Antimeridian-Abdeckung wird durch getrennte Bounds/Shards repräsentiert.

## Lifecycle

Pro Coverage gelten als Zielzustände `current`, `previous` und optional `staging`. Alte unreferenzierte Hash-Objekte werden nach Grace Period gesammelt. Browsercache ist versionsgebunden und begrenzt. D1 erhält keine unbegrenzten generation-scoped Geometrie-Staging-Daten.

## Rollback

V3 wird additiv neben V2 gebaut. Solange die Acceptance Gates nicht erfüllt sind, bleibt V2 der aktive Beta-Pfad. Ein V3-Cutover erfolgt erst nach Shadow-Vergleich und kann durch Rückstellen des aktiven Manifest-/Runtime-Flags zurückgenommen werden. Immutable alte Source-Objekte bleiben für die definierte Rollback-/Grace-Periode erhalten.

## Nicht entschieden

Noch benchmarkabhängig:

- TypeScript Worker vs Rust/WASM Worker;
- genaue binäre Shard-Kodierung vs FlatGeobuf;
- optimale Shard-Zielgröße;
- vollständige vs stichprobenbasierte Server-Verifikation;
- echter iPad-Peak-Memory;
- reproduzierbares Gebiet-3-Gate <=60 s und <=20 MiB.

Keiner dieser Werte darf vor Messung als bestanden gelten.
