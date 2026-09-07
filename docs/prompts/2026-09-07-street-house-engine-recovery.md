# STREET + HOUSE ENGINE FORENSIC RECOVERY PROMPT

Repository: `madebycli/flyer-map`

Du übernimmst die technische Rettung und belastbare Produktakzeptanz der automatischen Street-/House-Preparation.

## Ausgangslage

Die isolierte Street-Engine-Linie PR #75 ist engineering-seitig weit entwickelt und CI-grün. Trotzdem meldet der Nutzer nach etwa einer Woche Arbeit, dass praktisch nur ein **kleines Gebiet mit ungefähr zehn Straßen** zuverlässig funktioniert habe. Behandle das als echte Produktakzeptanz-Warnung.

Die Aufgabe ist deshalb **nicht**: noch einmal einen neuen Street-Algorithmus erfinden. Die Aufgabe ist: reale fehlschlagende Gebiete instrumentieren, die erste fehlerhafte Stage beweisen, Fehlerklassen bilden, Root Causes beheben, Regression Fixtures erzeugen und anschließend Engine + Sync + Map wirklich end-to-end akzeptieren.

Nutze hierfür das stärkste verfügbare Reasoning-Modell. Wenn GPT-6 Pro/Astra im Account verfügbar ist: bevorzugt Pro für die forensische Root-Cause-Arbeit. Alternativ GPT-5.6 Sol Extra High/High.

## Pflicht-Context

Lies zuerst:

1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`
4. `docs/architecture/MAP.md`
5. `docs/architecture/DATA.md`
6. `docs/quality/QUALITY.md`
7. Street-/Area-/Map-bezogene ADRs und Pläne aus dem Graphen
8. `docs/SYNC_REQUIREMENTS_FOR_STREET_ENGINE.md`
9. Third-party Street Engine Dokumentation im Repo
10. `docs/reports/2026-09-07-current-development-audit.md`
11. `docs/context-replan-2026-09-07.yaml`

Danach Remote verifizieren:

- PR #75 open/Draft/unmerged;
- Branch `feature/established-street-preparation-engine` aktueller Head;
- exact-head CI;
- Cloudflare Preview;
- PR #74 aktueller Sync-Head;
- relevante Engine-/Adapter-/Area-Preparation-Dateien;
- welche Street-Engine-Version tatsächlich in einem testbaren Staging-Kandidaten läuft.

Snapshot nur zur Orientierung: PR #75 war am 2026-09-07 auf `501b8058302342358c8eaed5c67e378b02deb0c0` und Engineering-CI war grün. Remote gewinnt.

## Bestehender Vertrag – nicht blind zerstören

Die isolierte Engine hat bereits wichtige Invarianten:

- JSTS `2.12.1` serverseitig für exaktes LineString/Polygon Clipping.
- Turf `7.4.0` modular für Smart Street A/B Snapping und Slicing.
- keine Browser-Overpass-Engine.
- Roads/Buildings serverseitig getrennte bounded Overpass Phasen.
- Algorithmusversion `street-v2-jsts-2.12.1-turf-7.4.0`.
- stabile richtungsinvariante SHA-256 Auto-Street-ID.
- gemeinsame Preparation Generation/Fingerprint.
- unabhängige `street_status` / `house_status`.
- Street Erfolg bleibt gültig, wenn House scheitert.
- House retry lädt Buildings only; Street retry Roads only.
- Policy A: sobald automatische Street/House-Arbeit begonnen hat, destruktive Reprepare action-required statt bearbeitete Tasks zu löschen.
- atomare guarded Publish-Grenzen.
- keine manuellen Tasks anfassen.

Diese Invarianten nur ändern, wenn eine konkrete reproduzierte Ursache beweist, dass der Vertrag selbst falsch ist. Dann ADR/Contract bewusst aktualisieren.

# PHASE 1 – Reale Failure Corpus anlegen

## Keine Tiny-Area-only Tests mehr

Baue eine Corpus-Matrix aus echten Gebietsformen und Größen. Nutzerbeispiele haben Vorrang. Ergänze zusätzlich kontrollierte repräsentative Fixtures.

Empfohlene Klassen:

- sehr kleines dichtes Wohngebiet;
- kleines Vorstadtgebiet;
- mittleres Wohngebiet;
- großes Stadtviertel;
- längliches Gebiet entlang Hauptstraße;
- konkaves Polygon;
- Polygon mit schmalem Hals;
- Gebiet an Stadt-/Ortsrand;
- ländliches Gebiet;
- Gebiet mit vielen unbenannten Ways;
- Gebiet mit Fußwegen/Service Roads/privaten Ways;
- Gebiet mit komplexen Multipolygon-/OSM-Geometrien in der Umgebung;
- dichtes Building-Volumen;
- großes Gebiet mit wenigen Roads;
- Gebiet über Overpass-Response-Limit-Risiko.

Für jeden Corpus-Fall speichern:

- Area ID / test fixture ID;
- GeoJSON geometry;
- Bounding box;
- Fläche/ungefähre Ausdehnung;
- erwartete qualitative Road/Building-Präsenz;
- tatsächlicher Stage Failure;
- Logs/Metriken;
- reproduzierbar ja/nein;
- finaler Fix/Test.

Keine personenbezogenen Nutzer-/Produktionsdaten in Fixtures übernehmen.

# PHASE 2 – Stage-by-stage Telemetrie

Führe eine eindeutige Preparation Correlation ID/Generation durch alle Stages und logge **strukturierte, secrets-freie Diagnostik**.

## Stage A – Input Area

Messen/validieren:

- GeoJSON type;
- coordinate count;
- ring closure;
- duplicate points;
- self-intersections soweit relevant;
- winding/normalization;
- bbox;
- area size;
- geometry hash;
- algorithm fingerprint.

Fail closed mit explizitem error code statt generischem 500.

## Stage B – Query Planning

Für Roads und Buildings getrennt:

- Query bounds;
- Anzahl Subqueries/Tiles/Chunks;
- Query text hash, nicht notwendigerweise kompletten Text loggen;
- Overpass endpoint;
- timeout budget;
- max response bytes;
- aggregate byte budget;
- feature limit;
- concurrency.

Prüfe, ob große Gebiete in Requests geraten, die technisch fast immer timeouten oder Limits reißen.

## Stage C – Overpass Transport

Pro Request:

- start/end duration;
- HTTP status;
- timeout;
- 429;
- 5xx;
- response bytes;
- content parse success;
- element counts nach Typ;
- retry/backoff decision;
- aggregate budget consumed.

Roads und Buildings strikt getrennt auswerten.

## Stage D – OSM Normalization

Messen:

- raw ways/nodes;
- ways missing nodes;
- invalid coordinate sets;
- normalized LineStrings;
- duplicate source ways;
- excluded ways nach Reason;
- retained ways.

Eligibility Reasons ausgeben:

- highway allowed;
- highway not allowed;
- access blocked/private;
- invalid geometry;
- insufficient points;
- duplicate.

## Stage E – JSTS Conversion/Topology

Messen:

- conversion failures;
- topology exceptions;
- invalid polygon repairs, falls erlaubt;
- intersection failures;
- geometry collections;
- zero-length lines;
- extremely fragmented outputs.

Wichtig: niemals Exceptions nur catchen und „0 streets“ zurückgeben. Ein Geometry-Fehler muss als Fehlerklasse sichtbar sein.

## Stage F – Clipping

Pro Source Way beziehungsweise aggregiert:

- candidate ways;
- intersects area;
- clipped fragments count;
- fragments rejected zero/too-short/invalid;
- retained fragments;
- duplicate fragment keys;
- total geometry points before/after.

Vergleiche bei Fehlerfällen visuell/debugmäßig einzelne bekannte Straßen mit dem Area Polygon.

## Stage G – Stable Identity / Reconcile

Prüfe:

- `sourceOsmWayId`;
- `sourceKey`;
- `fragmentKey`;
- canonical direction;
- exact identity JSON;
- SHA-256 ID;
- inserts/updates/deleteIds/unchangedIds;
- no-churn bei identischer Reprepare;
- preservation user-owned fields.

Keine lokale zweite Hash-/ID-Implementierung.

## Stage H – D1 guarded publish

Messen:

- claim/generation/write-token;
- stale generation rejection;
- DB batch size;
- insert/update/delete counts;
- feed entry count;
- constraint errors;
- FK errors;
- transaction rollback;
- publish duration;
- final phase state.

Canonical tasks + Change Feed müssen nach Vertrag atomar konsistent sein.

## Stage I – House Phase

Separat messen:

- building query bytes/count;
- normalized buildings;
- clipping/centroid/house-task generation je nach Implementierung;
- publish counts;
- house-specific errors.

Street Ready darf durch House Failure nicht zurückgerollt werden.

## Stage J – Client Read/Sync/Render

Nach erfolgreichem Server-Publish prüfen:

- Pull erhält neue Streets;
- RxDB schreibt sie;
- active campaign/area filter zeigt sie;
- MapLibre source enthält Features;
- Layer visibility/zoom/filter;
- Smart Street liest persistierte Geometrie;
- keine Voraussetzung „manuell Street hinzufügen“, bevor Auto Streets sichtbar werden.

Das ist besonders wichtig, weil „Server erzeugt Streets“ und „Nutzer sieht Streets“ zwei verschiedene Akzeptanzgates sind.

# PHASE 3 – Fehlerklassen statt Einzelfixes

Nach mindestens mehreren realen Failures gruppieren:

- Overpass timeout/rate limit;
- response too large;
- bad query chunking;
- normalization missing nodes;
- eligibility overfiltering;
- topology/clipping exception;
- fragment explosion;
- D1 batch/limit;
- generation race;
- phase-state bug;
- Change Feed/Sync bug;
- client campaign/area filter;
- Map render/layer bug;
- House-volume-only failure.

Für jede Klasse:

1. minimal reproduzierende Fixture;
2. Root Cause;
3. Fix;
4. Regressionstest;
5. Corpus rerun.

Keine neue Heuristik hinzufügen, ohne zu beweisen, welche Failure-Klasse sie löst und welche Invarianten sie nicht beschädigt.

# PHASE 4 – Overpass Robustheit

Untersuche ernsthaft, ob die aktuelle bounded Query-Strategie für große Areas geeignet ist.

Prüfpunkte:

- bbox vs polygon query cost;
- Chunking/Tiling;
- dedupe über Chunk-Grenzen;
- shared nodes;
- max concurrent requests;
- backoff/jitter;
- total wall-time budget;
- aggregate response budget;
- endpoint fallback nur wenn architektonisch erlaubt;
- 429 handling;
- 504/timeout;
- partial chunk failure.

Wichtige Invariante: Bei einem Street-Phase Partial Failure **keine partielle Generation publishen und niemals fälschlich `street_status=ready`**.

Wenn Chunking eingeführt/angepasst wird, dedupe und deterministische Identität müssen identisch bleiben.

# PHASE 5 – Geometry Robustheit

Erzeuge Regressionen für:

- line touches polygon boundary;
- line overlaps boundary;
- line enters/exits mehrfach;
- MultiLineString/GeometryCollection output;
- reversed coordinate order;
- duplicate consecutive points;
- tiny fragment;
- self-intersecting area input;
- polygon orientation;
- precision close to boundary;
- extremely long OSM way crossing many areas.

Stable ID darf bei reiner Richtungsumkehr nicht wechseln.

# PHASE 6 – House Robustheit

House Engine separat behandeln.

- Buildings dürfen Street-Preparation nicht blockieren, wenn Street erfolgreich ist.
- großes Building-Volumen darf seine eigene Phase failen.
- House-only retry darf Roads nicht erneut laden.
- Street-only retry darf fertige House Tasks nicht regenerieren.
- aggregated legacy `status` nicht mit vollständigem House Ready verwechseln.
- Client muss `street_status` und `house_status` korrekt darstellen.

# PHASE 7 – Worked Task Safety

Automatische Reprepare mit bereits bearbeiteten Tasks:

Statusvarianten mindestens:

- open;
- completed;
- later;
- not-deliverable.

Sobald Policy A greift:

- keine bearbeitete automatische Street löschen;
- keine stale candidate publishen;
- kein endloser Retry Button;
- action-required UI/error code;
- manuelle Tasks unverändert.

Obsolete **open** auto Street darf tombstoned werden.

# PHASE 8 – Sync Integration

Vergleiche PR #75 Vertrag mit aktuellem PR #74 Code.

Pflichtpunkte:

1. konkurrierende `worker/serverPreparedStreetReconcile.ts` entfernen/ersetzen, falls noch vorhanden;
2. nur eine Stable-ID-Implementierung;
3. kanonischer `reconcilePreparedStreetTasks`-Pfad;
4. sourceKey/fragmentKey korrekt materialisieren;
5. D1 Feed/Tombstone/Generation Guard auf denselben Deltas;
6. user-owned fields preservation;
7. no-churn;
8. worked-task block;
9. independent phase states im Pull/Replay;
10. stale generation never visible.

Integration erst nach Engine-Corpus-Stabilität, damit nicht zwei Fehlerquellen gleichzeitig debuggt werden.

# PHASE 9 – Smart Street Acceptance

Smart Street ist map-first:

- vorbereitete Streets sind sofort sichtbar;
- Nutzer muss nicht erst „Straße manuell hinzufügen“ klicken;
- Punkt A auf vorbereitete Street;
- Punkt B auf derselben auswählbaren Street;
- beide auf tatsächliche persistierte Geometrie snappen;
- nur kleiner Abschnitt zwischen A/B highlighten;
- gespeicherte Segmentgeometrie korrekt;
- nicht komplette OSM-Way übernehmen;
- reverse A/B;
- Nähe Kreuzung;
- kurze Segmente;
- Zoomstufen;
- mobile touch precision.

Keine Browser-Overpass-/Clipping-Neuberechnung als Abkürzung.

# PHASE 10 – Akzeptanzmatrix

Empfehlung für einen belastbaren Release-Corpus: mindestens mehrere Dutzend repräsentative Fälle über kleine, mittlere und große Gebiete. Diese Zahl ist **eine neue Qualitäts-Empfehlung**, kein bereits bestehender Produktvertrag.

Pro Fall dokumentieren:

- Street stage success/failure;
- House stage success/failure;
- counts;
- duration;
- no partial publish;
- rerun idempotency;
- second-client visibility;
- map render;
- Smart Street sample.

Akzeptanz nicht nur über „HTTP 200“, sondern über sichtbare kanonische Tasks.

# PHASE 11 – Tests

Mindestens:

- unit: eligibility/normalization/identity;
- geometry: clipping corpus;
- reconcile: stable ID/user fields/tombstones/worked block/no churn;
- integration: Overpass fixture -> normalize -> clip -> publish -> D1 feed;
- rollback failure;
- independent phases;
- stale generation;
- multi-client pull;
- browser map render;
- Smart Street slice;
- large synthetic stress.

Keine vorhandenen grünen Tests abschwächen.

# PHASE 12 – Arbeitsweise

Nach jedem Failure:

1. erster failing stage;
2. konkrete Metriken/logs;
3. kleinste Fixture;
4. Fix;
5. exact tests;
6. full corpus subset;
7. full corpus;
8. exact-head CI;
9. isolated staging.

Nicht „mehr Timeouts geben“ oder Limits einfach erhöhen, bevor bewiesen ist, dass genau das die Ursache ist.

# Harte Grenzen

- PR #75 Draft/unmerged lassen.
- PR #74 Draft/unmerged lassen.
- keine Production D1 Migration.
- kein Production Deploy.
- rollback branch nicht anfassen.
- keine bearbeiteten Auto-Tasks zerstören.
- manuelle Streets/Statuses nicht verlieren.
- keine client-side OSM authority.
- keine partielle Street Generation als ready veröffentlichen.

# Abschlussbericht

Liefere erst am Ende:

- exact Engine Head;
- exact Sync Head;
- Engine version;
- Failure Corpus Anzahl/Klassen;
- Root Causes;
- Fix SHAs;
- tests/typecheck/audit/build;
- exact-head CI;
- staging URL/version;
- kleine/mittlere/große Area Ergebnisse;
- Street counts;
- House counts/states;
- idempotent rerun;
- two-client visibility;
- Smart Street A/B result;
- worked-task result;
- Production touched: no;
- verbleibende reale externe Device-Gates.

**Höre nicht nach dem ersten kleinen erfolgreichen Gebiet auf.** Die Aufgabe ist erst beendet, wenn die bekannten realen Failure-Klassen verstanden und innerhalb der verfügbaren Umgebung geschlossen sind oder ein exakt nachgewiesener externer Provider-/Limit-Blocker übrig bleibt.
