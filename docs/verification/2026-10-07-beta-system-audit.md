# StreetEngine / flyer-map: Beta-Systemaudit

Stand: 2026-10-07 UTC. Repository: `madebycli/flyer-map`.
Kandidat: `audit/beta-performance-consistency-2026-10-07`, Base `beta`.
Dieser Bericht beschreibt geprüften Code und lokale Evidenz. Die Änderungen sind nicht deployed.

## 1. Urteil und Grenzen

**Das ist fehlerhaft:** Beta enthält reproduzierbare Fortschrittsfehler,
vermeidbare Kartenarbeit, einen quadratischen Change-Feed-Vergleich und einen
V4-Alarm, dessen innere Arbeit zusammen mit Runner-Verwaltung das 50-Query-Budget
überschreiten kann. Ein Release-Fallback kann bei unbekanntem Secret-Bestand
Ersatzschlüssel vorbereiten. Diese Pfade wurden korrigiert.

Das gesamte Projekt als „Müll“ zu bewerten wäre unbelegt. Es besitzt umfangreiche
Regressionen, serverseitige Rechteprüfungen, immutable Source-Packs, Leases,
Generationsgrenzen, transaktionale Veröffentlichung und langlebige Kartenlayer.
Die aktuelle Beta ist trotzdem keine nachgewiesen belastbare Großgebietsfreigabe.
Gebiet 8, Geräteperformance und reale D1-Abrechnung bleiben offene Gates.
Kleine, ruhige Kampagnen passen plausibel in Free; große Gebiete mit dauerhaft
vielen aktiven Clients sind ohne gemessene Budgets kein robuster Free-Tier-Plan.

## 2. Verifizierter Ausgangsstand

| Punkt | Beobachtung am 2026-10-07 |
|---|---|
| Remote Beta | `603775645a07c1587df6b3cae21e35836a6de81c`, bei Start und Abschluss erneut geprüft |
| Öffentliche Runtime | gleiche `sourceCommit`; Worker-Version `3194334a-0985-4048-8b28-b889040b796d` |
| Runtime-Kanal | `releaseChannel=beta`, `environment=unstable` als Kompatibilitätsname; V4, Source-Channel Beta |
| PR #129 | in Beta gemergter Diagnosefix; Basis der Untersuchung |
| PR #130 | offen, Draft; `daa0846c01e391734b87460be674a253de689388`; unverändert |
| Historische CI | Beta-Release `36130382463` erfolgreich; PR130 CI `36137746225` und Scale `36137746222` erfolgreich, jeweils September 25; keine Ergebnisse dieses Kandidaten |
| Regeln | Beta `protected=false`, abgefragte Repository-Rulesets leer; ausschließlich eigener Feature-Branch verwendet |
| Arbeitsbaum | frischer sauberer Checkout, keine fremden uncommitted Änderungen |
| Kontext | `.ai/CONTEXT.md`: `project_id=flyer-map`, `context_root=projects/flyer-map/`, `entrypoint=projects/flyer-map/INDEX.md`; gegen `REGISTRY.yaml` validiert |
| Release-Zuordnung | `beta-release.yml` und autoritative Release-Invariante: Beta-Branch → Beta-Worker/Beta-D1; Main bleibt Stable |
| Grenzen | keine Deployments, Migrationen, remote D1-Schreibtests, Gebietsläufe oder Secret-/Runtime-Änderungen |

Die Basis-Konfiguration `wrangler.jsonc` ist Stable. Der Beta-Workflow erzeugt
seine isolierte Konfiguration und liefert V4-Assets aus. Ein lokaler Standardbuild
ist deshalb kein Nachweis eines Beta-Deployments.

Es liegt keine neue private terminale Gebiet-8-Diagnose vor. Die historisch
berechneten 130 Shards, 55.270 Streets und 46.665 Houses samt Fehler bei Base-Cursor
0 sind Kontext, keine neue Messung. PR129 macht `baseStep`/`baseFailureClass`
sichtbar; ein neuer erfolgreicher Cloud-Ready-Lauf und die genaue D1-Ausnahme
wurden hier nicht nachgewiesen. Aktuelles Account-Kontingent unbekannt.

## 3. Anwendungs- und Datenflusskarte

| Oberfläche / Modul | Zuständigkeit und geprüfte Grenze |
|---|---|
| `/login`, `/reset`, `/start`, `/join` | Organizer-Login/MFA/Remember, Recovery, Einstieg und Zugangslinks; Server bestimmt Rechte |
| `/new`, `/admin`, `/admin/campaign/:id` | Aktionen/Kampagnen, Teams/Gebiete, Verwaltung; Org-/Campaign-Isolation in Worker und Integrationstests |
| `/admin/invites`, `/admin/security` | Einladungen, Rollen/Rechte, Sessions/Devices, Security; keine authentifizierte Browserabnahme in diesem Audit |
| `/?campaign=…`, Workbench, Gruppen/Aktionen | Feldkarte, Gebiets-/Street-/House-Sheets, Smart Marking, Filter, Fortschritt, Collection/Pickups, Statistik, Einstellungen |
| `src/App.tsx`, `src/map/MapView.tsx` | React-Domainmodelle → GeoJSON → feste MapLibre-WebGL-Layer; kleine SVG-Edit-Geometrie separat |
| `src/data/rxdbMissionSyncCore.ts`, Fassade | fünf normalisierte Collections, lokale RxDB-Replica, Leader, Pull/Push, Auth-Renewal, Checkpoints, WS-Hinweise und 120-s-Sicherheitsabgleich |
| Network-Intent-Queue | eigene fachliche Offline-FIFO, Scope-ID, Idempotenz und Single-Flight; kein Ersatz für kanonische D1-Daten |
| `worker/indexOrganizer.ts` → weitere Router | Org/Auth/Hardening → Collection/Feldgruppen → Campaign/RxDB/Netzwerk-API; Schichtkopplung bleibt hoch |
| `worker/rxdbSync.ts`, MutationHandler | D1 kanonisch; Rechte-/Konfliktprüfungen; Revision und Feed im Schreibbatch; spezialisierte Collection-Pfade separat |
| CampaignSync DO | Kampagnenweise Schreibkoordination, hibernierende WS-Invalidierung, Vorbereitung über Alarme; Passwort-KDF in eigenem DO |
| V4-Source / Vorbereitung | releasezeitlich erzeugte immutable Worker-Assets, Hash/Manifest; Plan → Shards → Node-Usage → Graph → Adressen/Dedupe → Link-Zellen → Base-Buckets → Publish |
| D1 / Basis / Work-Overlay | gebündelte Base-/Feed-Chunks plus mutable Work-Overlays; Generation/Lease/Write-Token schützen Resume und Publish |
| Infrastruktur | Workers Assets, D1, SQLite-backed DO und Rate-Limit-Bindings; keine Queue-/Cron-/R2-Bindung in geprüfter Basis-Konfiguration; Beta verwendet Worker-Assets statt Live-Overpass |

Stale Antworten, Offline/Retry, Konflikte, retained-feed floor, Generation-Sichtbarkeit,
Tenant-/Team-Scope und Mehrtab-Leadership sind durch bestehende Integrationstests
abgedeckt. Das ist Code-/Testevidenz, keine vollständige Web-/Geräteabnahme.

## 4. Priorisierte Befunde und Änderungen

| ID / Severity | Datei / Pfad | Beleg, Ursache, Wirkung | Umsetzung / nächster Nachweis |
|---|---|---|---|
| F01 P1 | `v4StagedPreparation.stageRows`, `PreparationRunner.alarm` | Ein INSERT pro Chunk verbraucht das Query-Budget. Die 20k-House-Regression scheitert vor dem Fix mit `d1_invocation_budget_exceeded` in nachfolgender Runner-Normalisierung. | `json_each`-Expansion in ≤900kB UTF-8-Envelopes, einzeln serialisiert; gleiche Chunk-IDs/Payloads und Lease-Guards. Nachher `ready`, max 41 Statements im 20-Road/20k-House-Runner. Exakte Cloud-Ursache bleibt offen. |
| F02 P1 | `beta-release.yml`, alter Unstable-Releasepfad | HTTP-/API-Fehler beim Secret-Inventory werden als erfolgreiches leeres Inventory ersetzt. Folgender Code erzeugt TOTP-/Credential-Ersatzschlüssel und übergibt sie dem Deploy. Potenzieller Verlust der Entschlüsselbarkeit bestehender Daten. | Shared Inventory-Validator bricht vor Schlüsselerzeugung ab. HTTP 503/000, success=false, fehlende/defekte Liste und kaputtes JSON getestet. Kein tatsächlicher Vorfall behauptet, keine Secrets verändert. |
| F03 P1 | Lockfile / Overrides | Aktueller Baseline-Audit blockiert durch advisories für `fast-uri`, `sharp`, `source-map-js`, `undici`. Erreichbarkeit ist je Dependency unterschiedlich. | Vier minimale transitive Updates; keine React/RxDB/MapLibre-Umstellung. Audit besteht mit unveränderter expliziter MapLibre-Ausnahme. |
| F04 P2 | `areaTaskPreparation.withProgress`, V4 WS-Progress | GET zählt Legacy-Tiles statt 130 Quell-Shards; Link-Fortschritt verwendet Quellhäuser/Shard-Anzahl statt Area-Häuser/Link-Zellen. Fixture: HTTP 80%/994 statt WS 85%/23.332, 46.665 Area-Häuser. | Gemeinsame V4-Projektion, unbekannte Shards=0; alter fehlgeschlagener Job bei äußerem Retry-pending ausgeblendet. Regressionen. UI nennt Shards korrekt. |
| F05 P2 | `v4StagedPreparation.staged/loadNodeUsage` | Composite-PK wird beim LIKE und auch PR130-OR nur bis `kind` genutzt; 4.160 Stage-Rows statt gezielter Prefix-Seeks. | Einzelranges und disjunkte UNION ALL-Ranges, ≤40 Bindings und 4 Queries für 32 Buckets. EXPLAIN prüft `chunk_key`-Grenzen; gleiche 1.040 Resultate. Owner-Suffix-DELETE in `stageGroups` bleibt Scan-Risiko. |
| F06 P2 | `App.tsx` Render-Modelle | Pro Entity lineare Area-/Team-Suche und erneute Farbkonvertierung bei Refresh. | Ein memoized Area/Team-Palette-Index, gleiche Geometrie-Referenzen/Fallbacks/first-match. Ergebnisgleichheit und Color-Änderung getestet, CPU gemessen. |
| F07 P2 | `MapView.updateRendererDiagnostics` | Alle vier Source-/Rendered-Feature-Listen werden an jedem Idle materialisiert, auch ohne offene Diagnose. | Feature-Zählungen nur mit `diag=1`; günstige Readiness bleibt. Test beweist null Feature-Traversals ohne Diagnose. Feste Layer/full-setData bleiben. |
| F08 P2 | `useNetworkWorkspace` | RBush und Segmentlängen für Smart Marking werden schon beim normalen Browse/Refresh gebaut. Area-Filter hat zusätzlich verschachtelte Suchen. | Index nur bei aktivem Marking, Set-Lookups. Getter-Regression beweist keine Geometrieindizierung im Browse; Auswahl, Offline-Persistenz und Wiederöffnung bleiben getestet. Arbeit beim Öffnen wird verschoben, nicht entfernt. |
| F09 P2 | `rxdbChangeFeedEntriesForMutation`, house.set-status | Jeder After-Street sucht in sämtlichen Before-Streets: O(n²), auch bei einer House-Mutation. Dieser Befund betrifft den Snapshot-Mutationspfad, nicht jede spezialisierte Network-Intent-Mutation. | Ein Before-ID-Index, Reihenfolge/Scopes/automatische Parent-Delta erhalten. Regression begrenzt tatsächliche ID-Leseoperationen auf linear. Vollfunktions-Benchmark. |
| F10 P2 | V4 Diagnostics / Preparation-Poller | 1-s- und 4-s-Intervalle können Requests überlappen und auch unsichtbar weiterlaufen; Sheet pollt pending alle 2s. | PR130 ausgewählte Änderungen: serialisierte Diagnose-Timer, Visibility-Pause, 5s pending / 30s canonical+terminal; Sheet 5s. Langsamere HTTP-Sichtbarkeit ist dokumentierter Tradeoff; WS bleibt aktiv. |
| F11 P2 | `worker/rxdbSync.ts` Bootstrap / `baseStorage.readPreparedEntities` | Cold Pull ignoriert Paging und materialisiert sämtliche vorbereiteten Streets/Houses je Collection, vor Team-Filter. 250 physische Feed-Rows können mehrere logische Entities enthalten. | Offen: paged Bootstrap benötigt stabilen Snapshot-/Checkpoint-/Generationsvertrag. Keine stille API-Änderung; Cloud-RAM/CPU und payload messen. Keine unautorisierte Datenantwort allein aus interner Vollmaterialisierung abgeleitet. |
| F12 P2 | Renderer-Abhängigkeit / ADR0030 | MapLibre 5.7.1 bleibt trotz kritischem Advisory bewusst ausgenommen; neuere Renderer hatten dokumentierte Browserregressionen. | Keine ungeprüfte Renderer-Migration. Vertrauenswürdige Basemap-/Attributionspfade prüfen, Renderer-Kandidat auf realem Gerät isoliert akzeptieren. Kein bewiesener eigener XSS-Angriffspfad behauptet. |
| F13 P2 | App/Map/RxDB/V4-Router | Baseline App 2.095, MapView 2.699, RxDB-Core 933/Fassade 529, V4-Staging 1.077 Zeilen; mehrere Snapshot-/Queue-/Replicazustände und Wrapper erschweren Ownership. | Kleine konkrete Extracts umgesetzt (Render-Palette, Feature-Diagnose, Progress-Projektion). Weitere Zerlegung erst mit Ownership-Vertrag; kein kosmetischer Großumbau. |
| F14 P3 | `rxdbFetchGuard` | `Request.signal` wird bei RxDB-Aufrufen ohne init.signal ignoriert. Aktuelle Core-Aufrufe sind überwiegend URL-Strings, daher kein belegter dominanter Live-Pan-Bug. | Request-Signal inkl. Abort-Reason weitergeleitet, explizites init.signal/null hat Vorrang; drei Regressionsfälle. |
| F15 P3 | Organizer Login | Öffentliche Beta zeigt 46px-Checkbox durch globale Textfeldregel; Beschriftung bricht vom Kontrollfeld weg. | Eng begrenzte Login-CSS mit 20px-Checkbox und 44px-Zeilen-Touchfläche. Post-Fix-Geräteansicht bleibt offen. |
| F16 P3 | Context graph / CI install | `current_pr92_state` war veraltet; CI nutzt npm install statt npm ci. | Alte PR92-Daten als historisch markiert, aktuelle Auditroute hinzugefügt. npm-ci-Änderung separat erwägen, hier kein CI-Verhalten still geändert. |

P0: keiner aus der verfügbaren Evidenz nachgewiesen. P1s sind zuerst abgesichert;
größere UI/Datenmodell/Infrastrukturentscheidungen bleiben ausdrücklich offen.

PR130 wurde lokal separat verglichen: 22 relevante Tests bestanden. Übernommen
wurden Polling, Shard-Bezeichnung, Retry-Progress und Prefix-Ranges, anschließend
zusätzlich korrigiert: Link-Einheiten, UNION-Seeks und Alarm-Batch-Budget.
Insbesondere wird PR130 nicht als bereits vollständige D1-/Progress-Lösung dargestellt.

## 5. Verifikation

Umgebung: Linux x64, AMD EPYC 9V74, Node v24.19.0 / npm 11.9.0;
`npm ci --ignore-scripts`. CI verwendet Node 22; dessen Ergebnis separat prüfen.

| Gate | Baseline Beta | Auditkandidat lokal |
|---|---|---|
| `npm test` | 1.029 Tests, 1.028 pass, 1 fail; 43.813s | 1.042 Tests, 1.041 pass, 1 fail; 40.932s |
| Fehler Standardlauf | `tests/rxdbP0Semantics.test.ts:427`, Unix-Socket `listen EPERM` | genau derselbe Sandbox-Fehler, kein neuer Assertionfehler |
| Vollsuite, echter nativer BroadcastChannel | isolierter Leadership/Handover-Test pass | 1.042/1.042 pass, 0 skipped, 46.701s; Defaultkommando bleibt unverändert |
| Typecheck | pass | pass, `tsc --noEmit` |
| Dependency audit | fail durch aktuelle Advisories | pass mit vorhandener MapLibre-GHSA-Ausnahme, kein clean-audit behauptet |
| Production build | pass, große Chunks | pass, große Chunks bleiben |
| Lint | kein Lint-Script/Formatter-Gate definiert | kein neu erfundenes Lint-Ergebnis; `git diff --check` sauber |
| Bestehender CI-Scale-Audit lokal | historische CI success | 0/399/1k/5k/10k/20k Houses ready, max Statements 27/27/27/29/31/37; Legacy-Quelle gemockt, kein V4-Cloud-Beweis |
| Gezielt | neue Progress-/Runner-Regressionen vor Fix fail | V4 Recovery + Organizer UI 18/18; weitere Karten/Sync/Security-Regressionen in Vollsuite |
| Öffentlicher Browser | Beta `/login` | Chrome 1363×936: Seite sichtbar, beschriftete required Felder, username/current-password Autocomplete, kein horizontaler Overflow, kein App-Consoleerror; Extensionerror getrennt |
| Lokaler echter Kartenbrowser | fehlt | Playwright-Chromium fehlt; Downloadversuch scheitert. Kein FPS-/LCP-/RAM-Wert erfunden |
| Cloud D1 / authentifizierte UI | fehlt | keine Tests oder Gebietsläufe; aktuelle Quoten/terminaler Gebiet-8-Lauf nicht zugänglich |

Native Vollsuite reproduzieren:

```sh
node --experimental-transform-types --import ./scripts/test-native-broadcast-channel.mjs --test tests/*.test.ts
npm run typecheck
npm run audit:dependencies
npm run build
```

Der alternate BroadcastChannel ist Nodes echter Transport und entfernt keine
Assertions. Er ersetzt die Unix-Socket-Sandboxgrenze; reguläre CI muss zusätzlich
das unveränderte `npm test` ausführen. Neue Kandidaten-CI wird im Draft separat
referenziert, historische grüne Runs werden nicht als eigener CI-Erfolg ausgegeben.

## 6. Performanceprotokoll

Alle Zahlen sind lokal, nicht mobile FPS oder Cloud-CPU. Rohsamples und Querypläne
liegen in `docs/verification/evidence/2026-10-07/`.

| Szenario / Tool | gleicher Datensatz und Cachezustand | Beta / vorher | Kandidat |
|---|---|---:|---:|
| Render-Join/Farbe, Node performance.now | 1k Entities / 1 Area, in-memory, 5 Warmups / 15 alternierende Samples | median 1.028ms | 0.120ms |
| Render-Join/Farbe | 20k / 32 Areas | 28.667ms | 10.676ms |
| Render-Join/Farbe | 101.935 / 1 Area, gleiche Objektanzahl wie historische Counts, synthetische Geometrie | 54.687ms, p95 86.961ms | 14.911ms, p95 76.114ms |
| Render-Join/Farbe | 101.935 / 256 Areas | 136.573ms | 11.594ms |
| Stage-Prefix, SQLite 3.53.1 EXPLAIN/VM | 32×130 Stage-Rows, 8 Buckets, 1.040 gleiche Ergebnisse, warm, 5 Warmups / 30 Samples | LIKE 2.014ms / 104.620 VM-Schritte; PR130 OR 2.382ms / 134.191 | UNION 0.846ms / 27.216 |
| Change Feed, echte Beta-Modulversion vs Kandidat | 1k Streets, eine Parent-Delta, in-memory, 1 Warmup / 3 alternierende Samples, Ergebnisgleichheit | median 7.704ms | 0.915ms |
| Change Feed | 10k Streets, gleiche Bedingungen | 341.869ms | 4.071ms |
| V4 vollständiger Alarm-Runner | 20 Roads / 20k Houses / 1 Shard, neues SQLite, immutable In-Memory-Pack, Packbau ausgenommen | vor stageRows-Fix Query-Budget-Exception | ready, max 41 Statements einschließlich Verwaltung |

Render-Benchmark enthält Indexaufbau. Schwankende p95 zeigen GC/Host-Rauschen,
die Zahlen begründen keine pauschale „ruckelfrei“-Aussage. Feature-Traversals und
Browse-RoadIndex-Vermeidung sind als tatsächliche Operationen getestet; dafür
wird keine FPS-Steigerung behauptet. Bundle bleibt ungefähr 589.77kB Hauptchunk
(179.41kB gzip) plus 920.55kB MapLibre (246.57kB gzip); keine Größenoptimierung behauptet.

Reproduktion:

```sh
node --experimental-transform-types scripts/benchmark-map-render-model.ts map-render-model.json
python scripts/benchmark-staging-prefixes.py staging-prefixes.json
node --experimental-transform-types scripts/benchmark-v4-local-budget.ts v4-budget.json runner
git worktree add --detach /tmp/flyer-map-beta-audit 603775645a07c1587df6b3cae21e35836a6de81c
# Im Baseline-Worktree npm ci ausführen oder identische node_modules verlinken.
node --experimental-transform-types scripts/benchmark-change-feed.ts feed.json /tmp/flyer-map-beta-audit/worker/rxdbChangeFeed.ts
```

### Ausführbarer Browser-/Geräte-Messplan

Nach autorisierter Beta-Promotion und freiem Budget, vorhandene ready-Daten nutzen:

1. Exakten Runtime-SHA, Gerät/OS/Browser, Viewport, Datensatz/Generation, Netzwerk
   und CPU-Throttling dokumentieren. Gebiet 7 und exakte Gebiet-8-Geometrie getrennt.
2. Kaltstart mit gelöschter Site-Replica/Cache und warmen Reload jeweils 5-mal
   aufnehmen; keine neuen Gebietsläufe dafür. Network HAR: Requests, komprimierte
   Bytes, Duplikate, Cache/304, Zeit bis erste Streets/Houses, vollständige Daten.
3. Chrome Performance oder Safari Web Inspector: Navigation bis Karte sichtbar
   und bedienbar markieren; Long Tasks >50ms, Frames/Drops, JS/Worker/GC/Layout/Paint
   und Heap vor/nach Laden notieren. Browsermemory nicht mit Worker-Isolate verwechseln.
4. Zehn identische Pan/Zoom-Bewegungen in neue Bereiche, schneller Richtungswechsel,
   Refresh, drei Gebietswechsel; alte Datenantworten, Generation, Marker/Layerzahl,
   vollständige `setData`-Rebuilds und Tile-Cache beobachten.
5. Auf gewöhnlichem Android und älterem iPhone dieselben Szenarien; Smart Marking
   öffnen/10 Waypoints/Undo/Offline/Reconnect. Verschobenen RoadIndex-Aufbau messen.
6. Zwei Clients: Status ändern, Offline-Retry, Reconnect, Reload. Canonical revision,
   alle fünf Checkpoints, Tombstones und sichtbare Entityzahlen vergleichen.
7. Ergebnis pro Szenario: median/p95, Trace/HAR, Cachezustand und SHA; nur gleiche
   Settings vergleichen. Persistente Caches müssen Generation/Hash invalidieren,
   keine authentifizierten mutable APIs pauschal HTTP-cachen.

## 7. D1 / Worker / Kosten und Architekturentscheidungen

Offizielle Dokumentation, abgerufen 2026-10-07:

| Dienst | dokumentierte Grenze / Preis |
|---|---|
| D1 Free | 5 Mio rows read und 100k rows written pro Tag; 500MB pro DB, 5GB Account; Reset 00:00 UTC |
| D1 Statement | 50 Queries/Invocation Free, 1.000 Paid; 100 Bindings, 100kB SQL, 2MB row/string, 30s Query/Batch, 6 gleichzeitige Verbindungen |
| D1 Paid | 25 Mrd Reads und 50 Mio Writes/Monat enthalten; danach $0.001/Mio Reads, $1/Mio Writes; Speicher über 5GB $0.75/GB-Monat |
| Worker | 128MB Isolate, auch bei Paid; Free HTTP 10ms CPU / 100k dynamische Requests pro Tag; Paid default 30s bis 5min |
| SQLite DO | default 30s aktive CPU auch pro Alarm, konfigurierbar bis 5min; single-threaded pro Objekt; HTTP-Free-10ms nicht als Alarmgrenze ausgeben |
| Workers Standard | $5 Basis/Monat, 10 Mio Requests und 30 Mio CPU-ms enthalten; Mehrverbrauch $0.30/Mio Requests und $0.02/Mio CPU-ms; DO separat berücksichtigen |

Quellen: [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[Workers Limits](https://developers.cloudflare.com/workers/platform/limits/),
[Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/).
Die DO-Dokumentation nennt unterschiedliche Free-Storage-Angaben zwischen Tabelle
und FAQ; daraus wird kein verifiziertes individuelles DB-Storagebudget abgeleitet.

**Codegrenzen:** V4 produktseitig bis 100k Streets und 100k Houses; 32 Node-Buckets,
2 Link-Zellen je Schritt, 16 Base-Buckets je Entity-Art, 220kB Feed/Base-Chunks.
Diese sind keine garantierte Laufzeit-/RAM-Obergrenze. Große Geometrie, viele
Shards und konzentrierte Buckets können trotz Entitybudget überfordern.
Der neue UNION braucht 40 Bindings, Stage-Envelopes ≤900kB einschließlich escaping;
Batch enthält lease-geschützte Einzelstatements. Indexrange spart Scans, nicht Writes.

### Nachvollziehbares Kostenmodell

Lokaler V4-Runner, eine Area / ein Source-Shard / 20 Roads, keine echten HTTP-User:

| Houses | Alarme/Schritte | SQL Statements gesamt / max Schritt | Tabellenänderungen | geschätzte Indexänderungen | Write-Modell gesamt | zurückgegebene SQL-Rows |
|---:|---:|---:|---:|---:|---:|---:|
| 1.000 | 135 | 2.075 / 23 | 2.281 | 1.905 | 4.186 | 1.826 |
| 20.000 | 135 | 2.171 / 41 | 3.554 | 3.241 | 6.795 | 2.233 |

TEMP-Trigger zählen Tabellen-INSERT/UPDATE/DELETE inklusive Cascades exakt;
Indexkosten werden modelliert. Zurückgegebene Rows sind nicht billed rows read;
zusätzliche Scans/Indexprobes fehlen teils. Keine echten Rechnungseinsparungen
oder genaue Gebiet-8-Kosten aus diesen Zahlen ableiten. Der 130-Shard-Fall ist
wegen Stage-Verteilung, Geometrie und Retry nicht linear aus Hausanzahl schätzbar.

Berechnung mit echten späteren Countern:

```text
Reads/Tag = Summe Job-meta.rows_read
          + Clients × Cold-Bootstraps × Bootstrap-Reads
          + Summe Poll/Checkpoint-Requests × Reads/Request
          + Mutation/Retry-Reads
Writes/Tag = Stage + Publish + Feed/Index + Work-Overlays + Retry/Cleanup
Paid-D1-Mehrkosten = max(0, MonatsReads−25e9)/1e6 × $0.001
                  + max(0, MonatsWrites−50e6)/1e6 × $1
                  + max(0, GB−5) × $0.75
```

Reine Code-Obergrenzen für 8 Stunden sichtbar, null Response-Latenz und dauernd pending:
Sheet 2s→5s: 14.400→5.760 GETs pro Client/Area. Zehn Clients nachher 57.600,
20 Clients 115.200, schon über 100k Worker-Free, ohne Auth/Mutationen/Sync.
Diagnose alt 1s+4s: 36.000 Requests/Client; neu 5s+30s: 6.720, terminal 1.920.
120s-Safety-Checkpoint: 240 Requests/Client/8h, nur sichtbarer Tab, weitere Pulls
abhängig von geänderten Collection-Heads. Das sind Konfiguration/Arithmetik,
keine beobachteten Nutzerzahlen oder gemessenen D1-Einsparungen.

SQL-Rows entsprechen nicht Streets/Houses: 20k Houses können in 91 Base-Chunks
liegen. Bootstrap liest und dekodiert dennoch ganze logische Datenmengen mehrmals.
DB bleibt je Instanz single-threaded; JSON-/Overlay-Arbeit, volle Bootstrap-Payloads,
Suffix-Scans, 50-Query-Schritte und gleichzeitige Clients sind die wesentlichen Grenzen.
Keine pauschale Aussage „ein Haus kostet eine D1-Zeile“.

### Entscheidungen, nicht still umgesetzt

| Entscheidung | sichere nächste Option | Alternative / Risiko |
|---|---|---|
| Große Areale / Budget | begrenzter read-only Counter-Nachweis, anschließend ein freigegebener Lauf; Paid mit Ausgabenlimit erwägen | Free erzwingt harte Account-Tagesbudgetplanung. Paid behebt weder 128MB noch schlechte Vollmaterialisierung. Kein Planwechsel durchgeführt. |
| Cold Bootstrap | Generation+High-Water pinnen, paged Collections prototypen, parallel Team-/Kind-Filter in SQL prüfen | Streaming/Worker-Dekodierung bzw. Viewport-Only-Replica verändern Offline-/Stats-Vertrag. ADR und Resume-/Deletion-Tests nötig. |
| Renderer Updates | Rebuild-Kosten am Gerät messen, vorbereiteten incrementalGeoJson-Pfad separat abnehmen | Blindes updateData aktivieren verletzt derzeitige full-setData-Tests; Vector Tiles ändern Hit-Testing/Status-Overlay. |
| Stage-Löschungen | Owner-Index oder owner-range-Key erst nach Profiling und lokalem Migrationsvergleich | Ein Schemawechsel ist kein harmloser Prefix-Fix. Keine Migration vorbereitet/ausgeführt. |
| Maintainability | konkrete Owner-Module für map sources, prep state und replica visibility | Frameworkwechsel/zusätzliche abstrakte Layer ohne nachgewiesenen Nutzen vermeiden. |
| Release-Security | unbekanntes Inventory muss abbrechen | Key-Rotation braucht separaten Backup-/Re-encryption-Plan, nie Error-Fallback. |

## 8. Sicherheit, Restarbeiten und kleinstes nächstes Gate

Worker erzwingt Campaign/Organization/Team-Rechte; vorhandene Tests prüfen fremde
Campaigns, Credentials, Mutation-Scope, CSRF/Same-Origin und Konflikte. HttpOnly
Session/Remember-Vertrag bleibt. GPS bleibt lokal. Keine Secrets/privaten Campaign-
Daten in neuen Fixtures oder Messartefakten. Ein vollständiger Penetrationstest
wurde nicht durchgeführt. Advisory-Meldungen sind kein eigener Angriffsnachweis.

Nächste sichere Nachweise:

1. Default-CI dieses exakten Kandidaten auf Node 22; Default-Leadershiptest muss
   außerhalb der Sandbox bestehen. Native Vollsuite bleibt lokaler Ersatznachweis.
2. Cloudflare-Dashboard/read-only vorhandene Usage/Rows-Counter und vorhandene
   terminale V4-Diagnose abrufen. Keine erneuten Gebietsläufe zur Quotenausreizung.
3. Nach ausdrücklicher Freigabe für Release und Budget: Migration-/Secret-Pfad des
   Beta-Workflows separat prüfen, exakt freigegebenen SHA promoten. Dieser Audit
   erlaubt keinen Merge/Deploy.
4. Danach Gebiet 8 ein einziges Mal nachweisen: baseStep/baseFailureClass, eindeutige
   Generation, ready, tatsächliche Streets/Houses, reload und zweiter Client.
   Gebiet 7 als Regression. R2/Overpass-Fallback bleibt verboten.
5. Geräte-Messplan oben und authentifizierte Routen-/Responsive-/Accessibility-Matrix
   ausführen, bevor Performance oder allgemeine Website-Reife freigegeben wird.

## 9. Risiken und Rollback

- JSON1-/D1-Batch-Verhalten muss am freigegebenen Cloud-Lauf bestätigt werden;
  SQLite beweist Semantik, nicht Cloud-Limits oder Isolate-Memory.
- Fortschrittszahlen ändern Einheiten korrekt; 5s-Polling kann HTTP-Fallback einige
  Sekunden später aktualisieren. WS-Progress bleibt unverändert verfügbar.
- RoadIndex-Arbeit verlagert sich zum Öffnen von Smart Marking; dieser Moment muss
  auf schwachem Gerät gemessen werden.
- CPU-Benchmarks entfernen keinen vollen GeoJSON-Rebuild oder Bootstrap-Transfer;
  schnelle Desktopwerte können mobile Probleme verdecken.
- Transitive Dependency-Patches brauchen normale CI und spätere Browserabnahme;
  MapLibre-Ausnahme bleibt explizit offen.
- Fail-closed Release stoppt künftig bei Cloudflare-Inventoryfehlern. Das ist
  beabsichtigte Verhaltensänderung; keine automatische Ersatzschlüssel-Rotation.
- Kleine Commitgruppen lassen sich unabhängig revertieren. Keine API-, Schema-,
  Daten- oder Runtime-Migration ist nötig. Der geprüfte Kandidat bleibt Draft.
