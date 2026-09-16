# Plan 037 — Street Engine V3 Source-Packs

Stand: 2026-09-16  
Basis: `beta@5aa61866ec6e9a4dd8d369cf34348c13502d38e7`  
Arbeitsbranch: `feat/street-engine-v3-implementation-2026-09-16`

## Ziel

Street Engine V3 aus dem Public-Overpass-/D1-Staging-Normalpfad herausführen und einen Free-Tier-sicheren Source-Pack-Pfad aufbauen. Der erste Implementierungsslice stabilisiert die Resource-Gates und den immutable Source-Pack-Vertrag. Danach folgen Builder-, Format-, Browser- und Server-Verifier-Spikes gegen identische Fixtures.

## Anforderungen

- Cloudflare-Free-Tier-Schutz ist Priorität 1.
- Gebiet-3 cold soll reproduzierbar <=60 s erreichen.
- Cold Browser-Transfer Ziel <=20 MiB, Hard Stop >40 MiB.
- Kein Public Overpass im V3-Normalpfad.
- Source-Versionen immutable, content-addressed und atomar aktivierbar.
- Keine beliebigen Source-URLs aus Browserdaten.
- Browserresultate bleiben untrusted.
- Globale Coverage ohne NRW-/Deutschland-Hardcoding.
- Kein Partial Publish.
- Source-/Result-/Browser-Cache-GC ist Teil des Produktionsdesigns.
- `main`/Stable bleibt während Entwicklung unangetastet.

## Architektur

```text
OSM PBF / Replication Diffs
        |
        v
Build Plane
  normalize roads/buildings/addresses
  build graph metadata
  precompute top-K house-road candidates
  shard + hash
        |
        v
immutable Source Manifest + Source Shards
        |
        +----------------------+
        |                      |
        v                      v
Browser Worker            Server Verifier/Fallback
select/clip               select/clip/validate
        |                      |
        +----------+-----------+
                   v
             atomic publish
          R2 result + D1 manifest
```

## Dateistruktur

Aktueller Slice:

```text
src/domain/streetEngineV3Budget.ts
src/domain/streetEngineV3SourcePack.ts
tests/streetEngineV3Budget.test.ts
tests/streetEngineV3SourcePack.test.ts
docs/decisions/ADR-0032-street-engine-v3-precompiled-source-packs.md
docs/plans/active/037-street-engine-v3-source-packs.md
```

Geplante nächste Slices:

```text
tools/street-engine-v3-builder/        # native Builder Spike
src/streetEngineV3/worker/             # Browser Web Worker
worker/streetEngineV3/                 # thin verifier/publish API
bench/street-engine-v3/                # gemeinsame Fixtures/Harness
```

Die genauen Pfade der Builder-/Benchmark-Komponenten werden erst beim entsprechenden Slice committed, damit keine leeren Architekturhülsen entstehen.

## Implementierungsschritte

### P0 — Baseline und Resource Gate

- [x] Branch direkt von aktuellem `beta` anlegen.
- [x] per-Generation Free-Tier-Budgetvertrag implementieren.
- [x] 20/40-MiB-Transfer-Preflight implementieren.
- [x] fail-closed Counter-/Manifestprüfung testen.
- [x] 50-Runs/Tag-25%-Envelope als Regression festhalten.

### P1 — Source-Pack-Vertrag

- [x] Manifest v1 definieren.
- [x] SHA-256-only Content Addressing definieren.
- [x] Source-Provenance und Versionsfelder verpflichtend machen.
- [x] globale WGS84-Bounds ohne Regionshardcoding definieren.
- [x] Antimeridian-Auswahl unterstützen.
- [x] nur intersecting Shards in Transferplanung aufnehmen.
- [x] kanonisches Manifest + stabilen Manifest-Hash definieren.
- [ ] konkrete Binärkodierung benchmarken und festlegen.

### P2 — Reproduzierbare Fixtures und Benchmark-Harness

- [ ] Gebiet-3-Fixture sichern.
- [ ] 602-House-Fixture sichern.
- [ ] Synthetic 5k/10k/20k generieren.
- [ ] semantischen Result-Hash definieren.
- [ ] gemeinsame Messausgabe für wall/cpu/memory/bytes/resources bauen.

### P3 — Builder-Spike D

- [ ] Rust-native Builder gegen Fixture bauen.
- [ ] Road-Normalisierung build-time.
- [ ] Building-Validierung build-time.
- [ ] Address-Normalisierung build-time.
- [ ] Graph-Segmente build-time.
- [ ] top-K House-to-Road-Kandidaten build-time.
- [ ] Binär-Shards ausgeben.
- [ ] FlatGeobuf-Control ausgeben.

### P4 — Runtime-Spikes

- [ ] TypeScript Web Worker gegen identische Packs.
- [ ] Rust/WASM Worker gegen identische Packs.
- [ ] Browser cold/warm Bytes und Peak Memory messen.
- [ ] aktuelles iPad Safari messen.
- [ ] schwächeres Mobilgerät messen.

### P5 — Thin Server Verifier/Fallback

- [ ] Source-/Algorithm-/Area-Hash pinnen.
- [ ] Bounds/Counts/Source-IDs verifizieren.
- [ ] Budget Counter für Worker/D1/DO/R2 führen.
- [ ] immutable Result-Pack + atomaren kleinen D1-Commit bauen.
- [ ] Tab-close/server-fallback/reconnect testen.

### P6 — Shadow und Cutover

- [ ] V2/V3 auf identischen Areas semantisch vergleichen.
- [ ] keine stillen Datenverluste/Task-ID-Semantikänderungen.
- [ ] Acceptance Gates vollständig grün.
- [ ] PR nach `beta` mergen.
- [ ] exakten `beta` SHA verifizieren.
- [ ] ausschließlich bestehenden Beta-Release deployen.
- [ ] `/api/runtime` muss exakt denselben SHA melden.
- [ ] erst dann echter Beta-/iPad-Test über den normalen Beta-Link.

## Acceptance Criteria

Der V3-Cutover ist erst zulässig, wenn mindestens:

- Gebiet-3 cold p95 <=60 s;
- Ziel <=20 MiB Download;
- >40 MiB Browser-Plan wird vor Fetch blockiert;
- D1 Rows Read <=10.000/Run, bevorzugt <=5.000;
- D1 Rows Written <=500/Run;
- Worker Requests <=100/Run;
- DO Requests <=100/Run;
- kein Public Overpass im Normalpfad;
- deterministic result hash;
- atomic publish;
- stale source/cache/reconnect/source-flip getestet;
- Source-/Result-/Browser-GC begrenzt Storagewachstum.

## Sicherheit

- Clientdaten sind untrusted.
- Source-Objekte werden nur über validierte SHA-256-Schlüssel adressiert.
- Keine vom Client gelieferte Upstream-URL.
- Source-/Algorithm-/Area-Versionen werden vor Publish gepinnt.
- Hash ist Integritätsnachweis, kein fachlicher Korrektheitsbeweis.

## Skalierung

Die Runtime skaliert mit den für eine Area tatsächlich benötigten Shards, nicht mit einem gesamten Regionalextract. Der Builder darf regional partitionieren, die Engine bleibt regionsunabhängig. Ein Coverage-Catalog kann mehrere Packs pro Area kombinieren.

## Kosten

Die bevorzugte Architektur muss zuerst auf Cloudflare Free sicher sein. R2 ist kein unendlicher Speicher; Lifecycle/GC und Coverage-Budget sind Pflicht. Bezahlte Komponenten dürfen später als Vergleich dokumentiert werden, sind aber keine Voraussetzung für den bevorzugten Pfad.

## Risiken

- eigener binärer Vertrag erzeugt Wartungspflicht;
- schlechte Shard-Größe kann Requestzahl oder Overfetch erhöhen;
- Browser-RAM kann auf iPad zum Gate werden;
- vollständige Server-Verifikation kann zu teuer werden;
- globale Source-Coverage kann 10-GB-R2-Free-Storage überschreiten;
- Antimeridian/Border-Semantik muss in Builder und Runtime identisch bleiben.

## Offene Fragen / UNKLAR

- `UNKLAR`: TypeScript vs Rust/WASM Gewinner auf realem iPad.
- `UNKLAR`: Binär-Shards vs FlatGeobuf reale p95/Bytes/Origin-Reads.
- `UNKLAR`: optimale komprimierte Shard-Zielgröße.
- `UNKLAR`: echte Gebiet-3-V3-Transfergröße.
- `UNKLAR`: iPad Peak Memory.
- `UNKLAR`: notwendige Tiefe der Server-Verifikation.
- `UNKLAR`: exakte R2-Coverage-Policy für globale Nutzung unter 10 GB Free Storage.

## Nicht-Ziele dieses ersten Slices

- kein V2-Runtime-Cutover;
- kein R2-Binding;
- keine D1-Migration;
- kein Browser-WASM;
- kein Beta-Deploy aus der Feature-Branch;
- kein Stable-/`main`-Deploy;
- keine Behauptung, dass <=60 s oder <=20 MiB bereits erreicht seien.
