# StreetEngine: Audit und Fehleranalyse

Stand 2026-09-12, Evidence-Freeze `b126e70899ad5a5c206d8c3ed0fa1fe7b34766fe`, PR #92.
Fortsetzung auf `fix/street-engine-smart-marking`, Base `integration/main-street-runtime@f4facd6ef354c5ba6de861519b696bce6f46a209`.
Dieses Dokument ergänzt das historische D1-Audit und ersetzt dessen offene, inzwischen lokal verifizierte Delete-Vermutung. Es behauptet keine Live-Freigabe.

## Urteil

Die Engine ist für 20.000 Houses derzeit nicht nutzbar: Der lokale Zweitile-Lauf bricht in `addresses` mit `house_assignment_budget` ab. Das bloße Erhöhen des Limits wäre kein belastbarer Fix: Graph, Adressen und Publish materialisieren weiterhin große Arrays; die Linkphase liest den gesamten Graph pro 250er-Slice erneut. 10.000 synthetische Houses bestehen den vorhandenen DO-Test, beweisen jedoch weder reale Gebäudekomplexität noch Worker-CPU, Gerätespeicher oder Overpass-Verfügbarkeit.

Der konkrete gemeldete Livefehler bei Buildings/Cursor 0 bleibt **UNVERIFIED**. Ohne dessen Jobfehler und Deployment-SHA ist keine eindeutige Liveursache möglich. Zwei unabhängige aktuelle Fehler sind lokal bewiesen:

1. `fetchTile` überspringt alle offenen/ungültigen Buildings ohne Zähler. Eine Antwort mit einem adressierten, offenen Building ergibt `ready`, eine Straße, null Houses. Die erste neue Regression erwartet `failed` und schlägt am Freeze-Stand fehl. Kategorie: Normalisierung/Datenqualität und falscher Erfolg, nicht Billing.
2. `way.geometry.map(p => [p.lon,p.lat])` wirft bei `null` eine TypeError. Der äußere Catch macht daraus `overpass_transport_error`, wodurch ein Datenfehler Providerwechsel und Retry auslöst. Zweite Regression schlägt fehl: `pending` statt eines klaren Datenfehlers. Kategorie: Parser-/Normalisierungsfehler plus falsche Retry-Klassifikation.

## D1-Gate

`AREA_DELETE_READ_PATH = VERIFIED_FIXED`, `D1_STATUS = OPEN` ausschließlich wegen der direkt beteiligten Linkphase. Details und Grenzen: [D1-Gate](../verification/2026-09-12-street-engine-d1-gate.md).

Vorbereitete Area: Manifestabfrage vor Snapshot; RxDB-Außenpfad ohne Houses/Tasks; kompakter Area-Tombstone und D1-Cascade. Legacy-Area: auf `areaId` begrenzte Child-Reads für Tombstones. Keine neue Delete-Umschreibung. Vorhandene lokale 2k-/10k-Regressionen sowie unabhängige RxDB-Clients bestehen. Keine Zuordnung der gemeldeten 4,5 Millionen Rows ohne Datenbank und Messzeitfenster.

Begrenzter Rest: `street_network_staging` wird in `link` je 250 adressierbaren Buildings vollständig für `kind=edges` gelesen. Die 10k-Fixture mit 20 Straßen liest dieselben Edge-Payloads 40-mal für Link und einmal für Publish, zusammen 527.629 Bytes. Der passende Primärschlüssel löst den absichtlich breiten Read nicht. Retry/Crash addiert weitere Reads. Ziel für spätere Phase: unveränderlicher, an Generation und Inhalt gebundener Graph mit begrenztem Cache oder räumlichen Partitionen, Cold-Recovery weiterhin aus D1. Keine Änderung anderer D1-Bereiche in diesem Auftragsschritt.

## Ende-zu-Ende-Vertrag am Freeze

| Stufe | Dateien/Funktionen | Geprüfter Vertrag und Lücke |
|---|---|---|
| Zeichnen/Editieren | `src/App.tsx`, `src/domain/geometry.ts`, `FieldBottomSheet.tsx` | Gemeinsamer kompakter HUD, Undo/Cancel/Confirm, Freigegeben/n-max bereits implementiert; reale Touch-/Resize-Abnahme offen. Kommentar-Toggle bereits vorhanden. |
| Start/Status | `useNetworkWorkspace.tsx`, `areaTaskPreparationApi.ts`, `beginAreaTaskPreparation` | Server entscheidet anhand kanonischer Area/Hash; unveränderte failed/pending Generation wird fortgesetzt. GET kann Alarm planen, ist deshalb kein rein passiver Live-Diagnoseaufruf. |
| Ausführung | `campaignSyncDurableObject.ts`, `PreparationRunner` | Ein begrenzter Schritt pro Alarm; Crash-Wakeup vor Fetch; D1 ist Autorität. Kein expliziter Pause-/Resume-Befehl vorhanden. Tab schließen pausiert den Serverjob nicht. |
| Quelle | `preparation.ts::fetchTile`, `sourceCache.ts` | Sequenziell, zwei Defaultprovider, keine beliebige Clientquery; historische Quellzeit, Tilecache. Erfolgsmetriken vorhanden; Fehlerantworten verlieren Status/Typ/Bytes/Providerdetails. Cache speichert bisher still reduzierte Daten. |
| Tiles/Graph | `preparationTiles`, `buildRoadNetwork` | Fester 0,01°-Raster, Area-Intersection, stabile Fragment-IDs, Layer/Bridge-Level. Graphphase lädt alle Roads; keine feinere CPU-Checkpointgrenze. |
| Buildings/Adressen | `fetchTile`, `addresses.ts::addressBuildings` | Hausnummer als Gate, direkte Adresse vor Nodes, RBush, deterministische Eigentümersuche. Konflikt gleicher Building-ID wird abgelehnt. Widersprüchliche doppelte Address-Nodes werden per Map zuletzt übernommen; Reihenfolgeunabhängigkeit ist ein zusätzlicher Testbedarf. Building-Multipolygon-Relations werden von der Way-Query nicht erfasst. |
| House-Link | `associateHouses`, Linkphase | Area-Innenpunkt, Adress-/Distanzfilter und Ambiguität; 250er-Slices, stabile SHA-IDs. Voller Edge-Read und neuer RoadIndex je Slice. |
| Staging/Publish | `chunkPersistence.ts`, `baseStorage.ts` | Revision, Geometry, Generation, Status und Lease-Token schützen eine D1-Batchtransaktion mit Manifest und Feed. Kein partieller Publish bei Feedfehler. Quelle/Targets/alte und neue Daten werden vor dem Batch vollständig gelesen/aufgebaut. |
| Arbeitserhalt | `reconcile.ts`, Overlays, `street_manual_house_parents` | Status/Label/Coverage und manuelle Eltern werden geprüft; A/B/C-Race und Migration bestehen. Entfernte bearbeitete Geometrie ist nicht vollständig als Archiv vorgehalten. Kommentare bei Legacy-Autotask-Migration brauchen gezielte FK-/Lesepfadregression. |
| Feed/RxDB | `rxdbChangeFeed.ts`, `rxdbSync.ts`, `rxdbMissionSync.ts` | Physische volle Pages erhalten Fortsetzung; Child-Cleanup über Area-Sichtbarkeit. Bootstrap lädt weiter beide Prepared-Kinds, obwohl eine Collection angefragt wird. Dieser begrenzte Audit ändert das Protokoll nicht. |
| Generation/Map | `generationVisibility.ts`, `incrementalGeoJson.ts`, House-/Area-/Street-Renderer | Manifestzählungen sperren gemischte Generationen; vorhandenes vollständiges Abbild kann erhalten bleiben. API-Test: 10k Houses, Statusdiff <200 Bytes. Kein echter GPU-/iPad-Nachweis. |

## Grenzen und Fehlersichtbarkeit

| Grenze | Aktueller Codewert | Bedeutung |
|---|---:|---|
| Area-Raster | 0,01°, maximal 256 Tiles | Gradmaß, nicht überall gleiche Fläche; keine adaptive Unterteilung dichter Tiles |
| Quellantwort | 4.000.000 Bytes/Antwort, 16.000.000 aggregierte Erfolgsbytes | Fehler-/Fallbackbytes fehlen bisher in Gesamtkosten; kein Speicherbeweis |
| Quellfeatures | 30.000/Antwort | Roads/Nodes/Buildings zählen zusammen |
| Timeout | Overpass 15 s, lokaler Abort 18 s je Provider | Default-Fallback kann zwei Timeouts kosten |
| Retry | maximal 3 Phasenversuche, je bis 2 Provider | Worst case 6 Quellanfragen für ein Tile; Backoff/Jitter, kein paralleles Shotgun-Fetch |
| Job-Lease | 60 s | DB-CAS schützt Eigentümer; lange CPU-Phasen brauchen separate Messung |
| Runner | 65 s Crash-Wakeup, >6 aufeinanderfolgende Runnerfehler stoppen | Phasenfehler und Runnercrash sind unterschiedliche Zähler |
| Graph | maximal 20.000 Roads/Fragmente im Netzwerkpfad | Ein einzelner Graphschritt bleibt groß |
| Houses | maximal 10.000 adressierbare Targets | 20k bricht vor Publish ab, auch wenn Quellbytes/Tiles passen |
| Link | 250 Targets/Schritt | Erneuter Graph-Read je Slice |
| Base/Overlay | 220.000-Byte-Basechunks; 16 Buckets | Gebündelte JSON-Inhalte sind keine einzelnen billable House-Rows |
| Staging/Publish | höchstens 35 Stagingchunks bzw. Publishstatements | Gesamtaufruf zusätzlich durch 50-Query-Guard begrenzt |

Cloudflare dokumentiert aktuell 50 D1-Queries je Free-Invocation, maximal 2 MB je D1-Row/String, 100 Bindings, 30 s Querydauer und 500 MB je Free-Datenbank. Der Tarif und konkrete Worker-/DO-Limits des Accounts wurden nicht live geprüft. [D1-Limits](https://developers.cloudflare.com/d1/platform/limits/)

Worker-Isolates haben 128 MB einschließlich WASM. Worker-CPU und DO-CPU sind getrennt zu beurteilen: normale Free-Worker-Anfragen nennen 10 ms, DO-Invocations standardmäßig 30 s. Lokale Node-CPU ist keine dieser Messgrößen. [Worker-Limits](https://developers.cloudflare.com/workers/platform/limits/), [DO-Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)

## Reproduzierbare Skalierung

`node --experimental-transform-types scripts/street-masterplan-audit.ts`

Baseline-Rohdaten: [JSON](../verification/2026-09-12-street-engine-baseline.json). Alle Quellen sind Mocks, D1 ist SQLite im Speicher. Beginn und DO-Alarmhülle fehlen in dieser Phasenmessung; der separate Bestandstest misst die vollständige DO-Hülle.

| Houses | Tiles | Ergebnis | Phasenschritte | max. Statements | zurückgegebene Rows | geschätzte Reads | geschätzte Writes | Quellbytes | Edge-Reads |
|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 0 | 1 | ready/0 Houses, 20 Roads | 6 | 27 | 58 | 68 | 67 | 3.185 | 2 |
| 399 | 1 | ready | 7 | 27 | 66 | 78 | 136 | 108.609 | 3 |
| 1.000 | 1 | ready | 9 | 27 | 76 | 88 | 152 | 266.664 | 5 |
| 5.000 | 1 | ready | 25 | 33 | 163 | 181 | 315 | 1.326.524 | 21 |
| 10.000 | 1 | ready | 45 | 40 | 270 | 294 | 534 | 2.651.604 | 41 |
| 20.000 | 2 | house_assignment_budget | 6 | 20 | 33 | 109 | 90 | 5.313.268 | 0 |

Zeit bis ready bei 399/1k/5k/10k lokal etwa 244/360/1464/2630 ms. Node-Prozess-CPU etwa 427/573/1865/2846 ms. Nur eine Messung, mit Instrumentierung, ohne Netzlatenz. Heap wurde im selben Prozess zwischen Phasen abgetastet, ohne GC-Isolation oder vollständigen Peak-Nachweis; der 10k-Sample lag bei rund 138 MB. Daraus folgt ein verpflichtendes isoliertes Speicherprofil, keine Behauptung eines Cloudflare-OOM.

## Nächster begrenzter Fix

Erst nach ADR und Plan: Quelle typisiert diagnostizieren; einzelne verworfene Buildings zählen und begrenzt mit ID/Tile/Grund sichtbar machen; vollständig beschädigte Building-Tiles ablehnen; `null` sicher validieren; Fehler nicht als Netzwerkstörung verstecken. Cacheversion erhöhen, damit alte still reduzierte Cacheeinträge nicht als verifiziert weiterleben. Öffentlich nur sichere Fehlercodes/Qualität anzeigen, keine Rohantworten, Sessions oder Upstream-Querycredentials. Keine Erhöhung der Housegrenze ohne 20k-Publish-/Sync-/Speichergates.

## Ausstehende Live-Evidence

Sanitierter fehlgeschlagener Job mit Phase/Cursor/Attempt/Lease/error_code/metrics_json.lastError und zugehörigem Build-SHA; bestehende F12-Response und Zeitfenster; tatsächliche D1-meta.rows_read oder Analytics; kleine genehmigte Quellprobe; echte iPad-Safari-/iPhone-/Android-Prüfung mit Reload, Offline/Reconnect, zweitem Client und Area-Delete. Fehleranzeige allein beweist nicht die gemeldete Ursache.

`STREET_ENGINE_LIVE_READY=FALSE`, `D1_ATTRIBUTION_CONFIRMED=FALSE`, `MAP_RENDER_P0=OPEN`.

## P1-Implementierung, Kandidat nach dem Audit

Die beiden roten Regressionen sind grün. `SourceFailure` unterscheidet Transport, JSON/HTML/remark und Normalisierung; nur allowlist-Metadaten werden persistiert. Null-Nodes werden vor Koordinatenzugriff geprüft. Building-Qualität zählt akzeptierte/verworfene Objekte und echte leere Tiles, zeigt höchstens zehn ID-/Tile-/Grundbeispiele. Ein vollständig verworfenes Building-Tile stoppt vor Cache und Publish. Cacheversion 2 verhindert Wiederverwendung der alten still reduzierten Cacheantworten. Bestehende `ready`-Generationen werden dadurch nicht automatisch neu erzeugt.

Öffentlicher Status und WebSocket-Fortschritt enthalten Qualitätsdaten; fehlgeschlagene Jobs erhalten sichere Phase/Cursor/Code/Attempt-Details. Die UI zeigt einen verständlichen Fehler, Details, Qualitätsverlust und einen expliziten Null-Häuser-Hinweis. Providerheader/Rohantworten gelangen nicht in die öffentliche Diagnose. Endpunktpfade bei eigener Providerkonfiguration bleiben redigiert; Remarktexte werden nur kategorisiert.

P1 braucht keine Migration, keine geänderten House-/D1-Limits und keinen Deploy. Großes 20k-, Pause-/Resume-, Graph-Read- und Live-Evidence-Gate bleiben offen. Exakte finale Tests/CI/SHAs stehen im Abschlusscheckpoint, nicht in den historischen Baselinezahlen oben.
