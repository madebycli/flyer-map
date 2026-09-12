# StreetEngine, D1-Read-Audit und Smart-Markierung: Masterplan

Status: Analyse abgeschlossen, Runtime-Fixes noch nicht freigegeben. Dieser
Checkpoint ist ein Analyse- und Umsetzungsplan, kein Release.

Stand: 2026-09-12 UTC

## Current State

### GitHub und Branch

- Repository: madebycli/flyer-map
- Branch: fix/street-engine-smart-marking
- Draft PR: #92, offen, Draft, ungemergt
- Base: integration/main-street-runtime auf f4facd6ef354c5ba6de861519b696bce6f46a209
- Exakter Audit- und Runtime-Stand vor diesem Dokumentationscommit:
  3e1dfb409cb63381b9a7154cd3a941252da95263
- Commit dieses Stands: docs: record final compact street action layout
  [deploy-sync-hotfix-staging]
- Elterncommit: a3479f5bd0825f120fa8ae0d5e3d048d54fb6237

Der nachfolgende Audit-Commit ändert nur Dokumentation. Er darf nicht als
neuer Runtime- oder Staging-Nachweis ausgegeben werden, bevor sein eigener
CI-Lauf abgeschlossen ist.

### CI und Admin-Staging

Für den exakten Stand 3e1dfb4 sind verifiziert:

- Normal-CI: Run 34709294852, Job 103594974699, erfolgreich. 869 von 869
  Tests, Typecheck, Dependency-Audit und Production-Build.
- Dependency-Isolation: Run 34709293266, Job 103594969472, erfolgreich.
  MapLibre 5.7.1 und unitbezier 0.0.1 wurden gegen den Commit geprüft.
- Admin-Staging: Run 34709293261, Job 103594969581, erfolgreich. Der Workflow
  hat den exakten Branch-Head geprüft, read-only Schema-Checks ausgeführt,
  staging-only gebaut und deployed sowie Shell-Smokes ausgeführt.
- Staging-URL:
  https://flyer-map-admin-staging.cloudflare-eleven035.workers.dev

Der Admin-Staging-Workflow führt keine D1-Migration aus. Seine ausgewählten
read-only Checks belegen deshalb nicht, dass die vorbereiteten 0022- oder
0023-Tabellen auf der persistenten Staging-Datenbank liegen. Vor einem
authentifizierten Street-Run muss der vorhandene Schema-/Migrationsstand
erneut sicher und read-only bestätigt werden.

Der Cloud-Browser wurde nur bis zum Organizer-Login geprüft. Eine
authentifizierte Street- oder Preparation-Session wurde nicht geraten oder
simuliert. Ein direkter /api/runtime-Versuch wurde durch den Browser als
ERR_BLOCKED_BY_CLIENT gemeldet und ist kein Runtime-Ergebnis.

### Lokale Prüfungen

- Fokuslauf: 50 von 50 relevanten Tests erfolgreich. Enthalten sind
  Street-Budget/Recovery, Area-Preparation, RxDB-Feed und Mutation,
  Smart-Street-Runtime und Map-UI-Verträge.
- Voller lokaler npm-test: 868 von 869 erfolgreich. Der Zwei-Tab-Test
  two RxDB tabs elect one replication leader ... scheiterte beim
  broadcast-channel Node-Adapter an EPERM beim Anlegen eines
  /tmp/pubkey.bc-Sockets. Es gab dabei einen nachträglichen unhandled
  rejection. Das ist eine Sandbox-Einschränkung, aber kein lokaler voller
  PASS.
- Lokales npm run typecheck: vom installierten TypeScript-Prozess mit
  vfs: failed to get executable path und fehlendem /proc/self/exe abgebrochen.
  Kein lokaler Typecheck-PASS wird behauptet.
- Lokales npm run audit:dependencies: erfolgreich.
- Lokales npm run build: erfolgreich. Vite meldet nur die bestehende
  Warnung zu großen Chunks über 500 kB.
- Der exakte Remote-CI-Lauf bleibt für den Code-Stand der maßgebliche
  vollständige Nachweis.

Sicherheitsgrenze: Es wurden kein Production-Merge, kein Production-Deploy,
keine Production-Änderung, keine Remote-D1-Migration, kein Remote-D1-Write,
kein großer Remote-Lasttest und keine Secret-Rotation durchgeführt.

Aktuelle Gates:

- MAP_RENDER_P0 = OPEN
- STREET_ENGINE_LIVE_READY = FALSE
- AUTO_AREA_PREPARATION_ENABLED = false auf dem Mission-Branch

## Executive Summary

Die gemeldeten ungefähr 4,5 Millionen D1-Rows-Read sind durch das Repository
noch nicht einer Ursache zugeordnet. Die stärksten technischen Kandidaten
liegen in unpaged Legacy-/Cold-Bootstrap-Pfaden und wiederholten
Campaign-Snapshots. Die StreetEngine selbst hat einen klaren
Skalierungshotspot beim erneuten Lesen der Edge-Stagingdaten, aber die
Screenshots lokalisieren den aktuellen Abbruch früher, beim ersten
Buildings-Schritt. Das spricht zuerst für Source-Fetch, Antwortvalidierung,
Tile-Fortsetzung oder Buildings-Normalisierung. Es beweist noch keine
konkrete Overpass-Fehlerzeile.

Die lokalen Phase-B-Kandidaten haben bereits einige unnötige Reads reduziert:

- Team-/Campaign-Metadatenmutationen lesen keine 2.000 fremden Houses mehr.
- Preparation-Begin liest den angeforderten Area-Kontext.
- RxDB behält bei deduplizierten Feed-Seiten die physische Seitengröße.
- Preparation-Polling pausiert offline und bei verstecktem Fenster und nutzt
  begrenztes Backoff.

Diese lokalen Ergebnisse sind keine Cloudflare-Billingmessung. Vor weiteren
Runtime-Fixes müssen D1-Metriken und der konkrete Preparation-Job gesichert
werden.

Die Smart-House-Oberfläche ist im aktuellen Haupt-App-Pfad noch nicht
verdrahtet. Smart Street arbeitet mit bereits vorbereiteten
Network-Tasks. Die gewünschte UX wird deshalb als klarer, user-gesteuerter
Flow geplant: Server erzeugt nur überprüfte Basisdaten, der Nutzer wählt
Straßen, Häuser und Status ausdrücklich.

## D1 Read Audit

### Begriffe und Rechenmodell

Cloudflare-Rows-Read ist nicht gleichbedeutend mit JSON-Entitäten,
zurückgegebenen Resultsets oder Bytes. Für die Attribution gilt:

  RowsReadPerDay = Summe aus allen von allen Queries gelesenen Datenbankzeilen

Die wichtigsten Skalierungsvariablen sind:

- L: passende Legacy-Street- und House-Zeilen
- B: physische Base- und Overlay-Chunk-Zeilen
- F: physische Change-Feed-Zeilen
- A: Areas im Campaign-Scope
- E: physische Edge-Stagingzeilen
- M: Collection-Member-Zeilen
- N: gleichzeitig aktive Clients

Ein lokaler returnedRows-Wert ist höchstens ein Hinweis auf eine mögliche
Amplifikation. EXPLAIN QUERY PLAN zeigt Zugriffswege und Sortierungen, aber
nicht die Cloudflare-Tagesabrechnung.

### Quantitative Erklärung für die Größenordnung 4,5 Millionen

Die folgende Matrix zeigt nur mögliche Größenordnungen:

| Hypothese | Rechnung | Aussage |
| --- | ---: | --- |
| Alter Team-Rename-Pfad | 2.000 Legacy-Houses x 3 volle Reads x 750 Änderungen = 4.500.000 House-Zeilen | Die lokale historische Reproduktion zeigt diese Form der Amplifikation. 750 echte Änderungen sind nicht belegt. |
| Cold-Bootstrap | 10.000 logische Entitäten x 450 vollständige Bootstraps = 4.500.000 logische Entitäts-Reads | Chunk-Storage liest physische Chunk-Zeilen, nicht zwingend 10.000 D1-Zeilen. Live-Größen fehlen. |
| Preparation-Statuspolling | 43.200 x A x N Requests pro Tag bei 2 Sekunden | 4 Areas und 1 Client ergeben 172.800 Requests. Bei 40 zurückgegebenen Hilfszeilen wären das 6,9 Millionen returned rows, nicht automatisch billable rows. |
| Link-Phase | ungefähr E x ceil(H / 250) erneute Edge-Zeilen | Mit 10.000 Häusern und 41 lokalen Edge-SELECTs wurde dieses Wiederlesen gemessen. Der Test hatte nur 2 Edge-Zeilen je Select. |

Die 4,5-Millionen-Zahl kann somit rechnerisch entstehen, ist aber ohne
Zeitfenster, Datenbankzuordnung, Query-Metrik und Clientzahl nicht attribuiert.
Master meldete ungefähr 91 Prozent eines Kontingents von ungefähr 5 Millionen
pro Tag. Diese Kontingent- und Prozentangabe stammt aus dem Nutzerbericht und
wurde nicht unabhängig aus Cloudflare abgelesen.

### Lokale Budgetmatrix

Das aktuelle scripts/street-d1-budget.ts arbeitet mit dem lokalen
Budget-Adapter. Die Werte sind logische Schätzungen und keine Cloudflare-
Rows-Read-Werte:

| Szenario | Größe | Read-Schätzung | geschätzte Writes |
| --- | ---: | ---: | ---: |
| Preparation | 400 | 149 | 1.284 |
| Preparation | 1.000 | 159 | 13.242 |
| Preparation | 5.000 | 245 | 65.318 |
| Preparation | 10.000 | 352 | 130.412 |
| House-Status | 400 bis 10.000 | 118 | 4 bis 9 |
| Smart-Mark | 400 | 462 | 65 |
| Smart-Mark | 1.000 | 1.062 | 309 |
| Smart-Mark | 5.000 | 5.062 | 1.509 |
| Smart-Mark | 10.000 | 10.062 | 3.009 |
| Delete | 400 | 474 | 1.272 |
| Delete | 1.000 | 1.074 | 13.233 |
| Delete | 5.000 | 5.074 | 65.277 |
| Delete | 10.000 | 10.074 | 130.331 |

Der Adapter zählt Statements und zurückgegebene Zeilen sowie erkannte
Full-Table-Scans. Indexprobes, verschachtelte Subqueries und JSON-Arbeit sind
nicht vollständig enthalten. Der Worker-Query-Budget-Wrapper zählt ebenfalls
Statements, nicht Rows-Read. Wird eine Datenbank mehrfach gewrappt, kann der
erste Wrapper den späteren queryBudget-Wert behalten. Das ist ein
Instrumentation-Risiko, keine Billingmessung.

### EXPLAIN QUERY PLAN, lokale Vollmigration

Die folgenden Pläne wurden mit der aktuellen vollständigen lokalen Migration
und leerem repräsentativem Schema erzeugt:

| Query | lokaler Plan | Konsequenz |
| --- | --- | --- |
| tasks nach Campaign, ORDER BY created_at,id | Indexsuche über idx_tasks_campaign_area_preparation_generation, danach TEMP B-TREE für ORDER BY | Filter ist indexiert, die gewünschte Reihenfolge aber nicht. |
| house_tasks nach Campaign, ORDER BY created_at,id | Indexsuche über idx_house_tasks_campaign, danach TEMP B-TREE für ORDER BY | Unpaged Snapshot bleibt größenabhängig und sortiert zusätzlich. |
| pending Area im Runner, ORDER BY updated_at,area_id | idx_area_task_preparations_campaign_status, danach TEMP B-TREE für ORDER BY | Der Runner findet eine Campaign, sortiert aber alle passenden Pending-Zeilen. |
| campaign_sync_changes mit Campaign, Collection und Seq-Bereich | idx_campaign_sync_changes_campaign_collection_seq | Der inkrementelle Feed-Hauptzugriff hat den erwarteten Range-Index. |
| Base-Read für ein houseId | street_base_entity_lookup nur auf campaign_id, danach Area-Join | Der OR-Ausdruck Street oder House-Bucket verhindert eine vollständig gezielte House-Lesemenge. Danach wird JSON im Worker gefiltert. |
| Base-Read für einen Area-Scope | Primärschlüssel von street_base_areas und street_base_chunks | Area-Read ist gezielter als der houseId-Sonderpfad. |
| Generation-Manifest | correlated scalar subquery, Indexpunkte auf Vorbereitung/Base-Area/Area | Jeder Pull aggregiert Ready-Manifeste erneut über den Campaign-Scope. |
| Collection-Members nach Campaign | SCAN collection_run_members und TEMP B-TREE für ORDER BY | Konkreter systemweiter Scan außerhalb der StreetEngine. Der Index führt auf run_id, nicht campaign_id. |
| Source-Cache-Lookup nach cache_key | Primärschlüssel-Suche | Hit ist gezielt. |
| Source-Cache-Pruning nach cached_at | SCAN street_source_tiles und TEMP B-TREE für ORDER BY | Jeder Cache-Miss kann Metadaten vollständig prüfen und sortieren. |
| Edge-Staging je Link-Schritt | Primärschlüssel-Range auf Campaign, Area, Generation, kind | Einzelquery ist indexiert, aber dieselbe Edge-Menge wird pro 250er-House-Slice erneut gelesen. |

### Systemweite Read-Matrix

| Trigger | Aktueller Zugriff | Risiko und Bewertung |
| --- | --- | --- |
| RxDB Cold-Startup | Campaign-, Team- und Area-Punkte; unpaged Legacy-Tasks/Houses; vorbereitete Chunks werden campaignweit gelesen und später gefiltert | Hoher Kandidat für O(L+B) je Cold-Bootstrap. Kein Bootstrap-Limit in bootstrapDocuments. |
| Incremental Pull | Feed-Range mit LIMIT 100 als physische Seite; danach Manifest- und Revision-Query | Hauptfeed ist begrenzt. Manifest und Revision fallen zusätzlich bei jedem Pull an. |
| RxDB Push | Pro Push-Zeile Snapshot laden, Mutation anwenden, danach Snapshot erneut laden; Konfliktpfad lädt ebenfalls | Batch 20 bedeutet mehrere D1-Roundtrips. StreetTask nutzt einen breiten Task-Pfad. HouseTask kann trotz houseId breit lesen. |
| Preparation-Status GET | Area und Vorbereitungspunkt, bei pending zusätzlich Job/Progress; GET kann Runner schedulen | Point-Read ist klein, Side Effect und Frequenz müssen gemessen werden. |
| Preparation POST | Access, Area, State, Lease und Begin; keine Client-Geometrie | Nach den lokalen Projektionen kein voller fremder House-Snapshot beim Begin. |
| Workspace-Polling | Alle erlaubten Areas sequenziell; initial und pending ungefähr alle 2 Sekunden, mit Backoff/Pause | Bei vielen Areas und Clients hohe Requestanzahl. Pending muss nach terminalem Status stoppen. |
| DO-Runner-Alarm | Pending-Auswahl, Job/Area/State, genau eine Phase pro Invocation, höchstens 50 Statements | Statement-Limit ist kein Rows-Read-Limit. ORDER BY sortiert Pending-Zeilen. |
| Buildings- und Roads-Staging | Pro Tile ein Source-Fetch plus Staging-Insert; Graph und Adressen laden vorherige Staging-Mengen | D1-Staging ist bounded pro Schritt, aber Graph/Adresse/Publish lesen Area-Mengen vollständig in den Worker. |
| Link-Phase | Ziel-Chunk für 250 Häuser und danach alle Edge-Stagingzeilen | O(E x H/250), klarer Perf-/Read-Hotspot. |
| Publish | Area-Snapshot, alle Edges, alle Houses, Reconciliation, Manual-Parent-Read, persistenter Publish | Einmal pro Generation, aber O(Area-Bestand). Muss gegen große Areas und Wiederholungen gemessen werden. |
| Network Intent | Local Queue alle 5 Sekunden; Server liest Area-Snapshot vor Replay-Prüfung | Replay ist write-idempotent, aber nicht read-free. Empty Queue erzeugt keinen Remote-Call. |
| Statusmutationen | Base-Overlay reduziert Writes, aber Snapshot und Validierung bleiben | User-Aktion kann bei Retry/Conflict mehrfach lesen. |
| Collection-Startup | Full Campaign-Load, danach Collection-Filter; Collection-Member-Query ist unpaged | Hoher Fremdpfad, konkreter fehlender Campaign-Index. |
| Statistics/Progress | Aggregates und danach voller Snapshot für primären Fortschritt | O(L+B+E) bei View-Öffnung oder Refresh, aber kein gefundener 2-Sekunden-Timer. |
| History/Activity | Zeit-/Campaign-Filter, DISTINCT/LIMIT und JSON-Expansion | Returned-LIMIT begrenzt nicht zwingend alle geprüften/sortierten Events. |
| Comments | Kontextseitige Seite limit 20; Team-Summary mit Sortierung und LIMIT 300 | UI-getrieben, kein autonomer Street-Loop gefunden. |
| Groups, Rooms, Auth | Meist PK-/Scope-Zugriffe; Listen und korrelierte Count-Abfragen unpaged | Account-/Room-Größe und Retryverkehr unbekannt. |
| Pickup | Campaign-Snapshot kann alle Pickups lesen und erst danach filtern | Separater Scope, nicht als Street-Ursache bewiesen. |

### Szenarienvergleich

| Szenario | Code-/Lokalevidence | Aktuelle Aussage |
| --- | --- | --- |
| Idle ohne Preparation | Checkpoint 4 Statements, 10 returned rows, kein Task-Snapshot; leerer Intent-Queue-Path ohne Remote-Call | Kein Beleg für einen permanenten Full-Snapshot-Loop. |
| Ein Preparation-Start | Lokaler Begin liest den Area-Kontext; der aktuelle Pipeline-Test verarbeitet 10k lokal in 46 Alarmen, höchstens 45 Queries je Alarm | Source, Cloudflare-Latenz und Rows-Read live unbekannt. |
| Wiederholter Start | Gleiche Generation wird lokal beibehalten; konkurrierende Fetch-Unterdrückung ist getestet | Lease-Ablauf und reale Klick-/Retryzahl fehlen. |
| Reconnect/Reload | Feed-Cursor-Regression und lokale RxDB-Konvergenz sind getestet | Gerätedatenverlust, Auth-Retry und wiederholter Cold-Bootstrap fehlen. |
| Mehrere Clients | N Clients multiplizieren Polls, Cold-Bootstraps und Retries; unabhängige Geräte teilen keinen RxDB-Leader | N und Aufenthaltsdauer im betroffenen Zeitfenster fehlen. |

## D1 Remediation

Diese Punkte sind die geplante Reihenfolge, nicht bereits ausgeführte
Änderungen:

1. Bestehende D1-Metrik sichern: Datenbank, Zeitfenster, Rows-Read-Kurve,
   Querystatistik, Queryanzahl und Version korrelieren. Keine neue
   COUNT-Abfrage und kein Lasttest gegen die betroffene Datenbank.
2. Für autorisierte kleine Diagnosen nur Query-Fingerprint, Route, Phase,
   Scope-Größe, Laufzeit und vorhandene meta.rows_read erfassen. Nie Cookies,
   Tokens, vollständige Bindings oder Rohgeometrie loggen.
3. Unpaged Bootstrap- und Full-Snapshot-Pfade explizit paginieren oder auf
   Area-/Collection-Scope reduzieren. Ein gesunder Pull darf nicht auf
   readPreparedEntities für die gesamte Campaign zurückfallen.
4. Projektionen konsequent halten: Metadatenmutationen dürfen keine fremden
   Tasks/Houses validieren; Subject-/Destructive-Operationen behalten die
   notwendige kanonische Prüfung.
5. Hauszielpfad gezielt machen: Area plus House-Bucket beziehungsweise ein
   dedizierter Entity-Index darf nicht durch den Street-OR-Ausdruck zur
   Campaign-weiten Chunk-Auswahl werden.
6. Generation-Manifest und Revision nicht bei jedem Collection-Pull über
   den gesamten Ready-Scope neu aggregieren, sofern ein atomarer und
   monotonischer Ersatz die Generationensichtbarkeit bewahrt.
7. Additive Kandidatenindizes lokal mit realistischen Kardinalitäten prüfen:
   tasks(campaign_id,created_at,id),
   house_tasks(campaign_id,created_at,id),
   area_task_preparations(campaign_id,status,updated_at,area_id),
   collection_run_members(campaign_id,joined_at,id). Source-Cache-Pruning
   erhält entweder einen passenden Metadatenindex oder eine separat
   begrenzte Cache-Metadatenstruktur. Erst nach Review und Staging-Schema-
   Nachweis darf daraus eine Migration werden.
8. Nach jeder Änderung gleiche Matrix aus leerem Campaign, 400, 1.000, 5.000
   und 10.000 Entitäten sowie One-Client-, Reload- und Zwei-Client-Szenarien
   wiederholen.

## StreetEngine Root Cause

### Neue Nutzer-Evidence aus den Screenshots

Der sichtbare Abbruch ist laut Master immer an derselben Stelle:

- Fortschritt: 40 Prozent
- Phase: Gebäude laden
- Straßen-Tiles: 9 von 9
- Gebäude-Tiles: 0 von 9
- Gebäude: 0 von 0
- Danach: Vorbereitung fehlgeschlagen. Erneut versuchen setzt den
  gespeicherten Job fort.

Die 40 Prozent sind mit der aktuellen preparationProgress-Funktion
vereinbar: Straßen-Tiles und Graph-Phase sind abgeschlossen, die erste
Buildings-Tile ist noch nicht abgeschlossen. Das ist eine Code-basierte
Einordnung des Screenshots, keine serverseitige Fehlerausgabe.

Damit ist der erste Diagnosepunkt enger als ein allgemeiner StreetEngine-
Fehler:

1. buildings-Overpass-Request und Failover,
2. Response-Body/Stream und Größenlimit,
3. JSON-/remark-/elements-Validierung,
4. erste Building-/Address-Node-Normalisierung,
5. Schreiben des ersten Buildings-Staging-Chunks,
6. Job-Cursor und Progress-Checkpoint bei Buildings-Cursor 0.

Der genaue error_code, attempts-Wert, HTTP-Status, Upstream und
metrics_json.lastError liegen aus dem Screenshot nicht vor. Die öffentliche
Meldung area_preparation_osm_failed ist dafür zu grob.

### Bewiesen oder lokal reproduziert

- Der Source-Code baut für Buildings eine kombinierte Overpass-Abfrage für
  building-Ways und addr:housenumber-Nodes.
- Pro Tile gelten 18 Sekunden Fetch-Timeout, 4 MB maximale Response,
  30.000 Features je Tile und 16 MB aggregierte Bytes.
- Fehlende/ungültige JSON-Struktur, remark, offene Building-Geometrie und
  weitere Normalisierungsfehler brechen den aktuellen Schritt ab.
- Transiente 429-, 5xx-, Timeout- und Transportfehler haben begrenzten
  Retry-/Failover-Code. Nicht-transiente Antwortfehler werden nicht erneut
  versucht.
- Der Fehler wird in street_network_jobs.error_code und
  metrics_json.lastError mit Phase, Cursor, Code und Versuch gespeichert.
- Edge-Staging wird bei jedem 250er-Link-Slice erneut komplett gelesen.
- Pending-Runner-Auswahl sortiert per TEMP B-TREE.
- AUTO_AREA_PREPARATION_ENABLED ist false, aber mutationHandler kann bei
  vorhandener Base-Storage-Migration weiterhin automatische
  Preparation-Metadaten erzeugen und schedulen. Die direkte alte
  waitUntil-Ausführung ist separat flaggeschützt. Diese Aktivierungs-
  inkonsistenz muss vor einem Rollout geklärt, aber hier nicht ungefragt
  verändert werden.
- beginAreaTaskPreparation behandelt einen gleichen pending-Hash vor dem
  frischen Pending-No-op-Zweig. API-Guards und Leases reduzieren das Risiko,
  aber direkte Caller und Race-Fenster müssen separat abgesichert werden.

### Noch unbekannt

- Exakte Upstream-Antwort und HTTP-Status des gezeigten Fehlers.
- Ob der Fehler vor oder nach dem ersten Staging-Insert entsteht.
- Ob der Fehler nur auf einer persistenten D1 ohne 0022/0023 liegt.
- Ob ein Overpass-Provider die kombinierte Buildings-Abfrage anders behandelt.
- Ob Cloudflare CPU, Subrequest, Response- oder D1-Budget die sichtbare
  Abbruchstelle auslöst.
- Jeder Zusammenhang mit dem gemeldeten 4,5-Millionen-Rows-Read-Verbrauch.

## StreetEngine Performance und Skalierung

Der wichtigste bestätigte Rechenhotspot der laufenden Generation ist:

  Edge-Stagingzeilen x Anzahl der 250er-Building-Slices

Ein lokaler Trace auf der aktuellen Pipeline ergab:

| Synthetic Houses | Edge-SELECTs | Rückgaben bei 2 Edge-Zeilen je SELECT |
| ---: | ---: | ---: |
| 1.000 | 5 | 10 |
| 5.000 | 21 | 42 |
| 10.000 | 41 | 82 |

Das Fixture ist klein bei den Edges und beweist keine 4,5 Millionen Rows.
Es beweist den wiederholten Zugriffspfad. Bei großen Edge-Mengen wächst er
mit den Häusern, obwohl die Topologie unverändert ist.

Weitere Skalierungspunkte:

- Graph lädt alle Road-Stagingdaten eines Runs.
- Adressphase lädt alle Building- und Address-Stagingdaten.
- Publish lädt Area-Snapshot, Edges und Houses erneut.
- JSTS polygonIntersects wird für jedes feste Grid-Tile ausgeführt.
- Base-Chunks sind nach JSON-Größe begrenzt, aber nicht automatisch nach
  semantischer Entity-Anzahl gezielt lesbar.
- Overpass wird pro Tile seriell angesprochen. Das schützt den Provider,
  verlängert aber große Areas.

Die 10k lokale Budgetpipeline blieb im Worker-Statement-Limit und verbrauchte
46 Alarm-Invocations. Das ist ein lokaler Mock-/SQLite-Lauf, kein Beweis für
Cloudflare-Laufzeit oder reale Upstream-Stabilität.

## StreetEngine Remediation

### Priorität 0: Fehler sichtbar machen, ohne Geheimnisse zu leaken

- Einen bestehenden betroffenen Job aus dem vorhandenen Staging-Dashboard
  oder einer ausdrücklich erlaubten, indexierten Campaign-/Area-Abfrage
  lesen.
- Mindestens Phase, Cursor, attempts, error_code, lease_until und
  metrics_json.lastError korrelieren.
- Authorized Admin-Diagnose darf einen sicheren Fehlercode und die Phase
  zeigen. Upstream-URL, Query, Cookie und Rohpayload bleiben verborgen.
- Erst danach entscheiden, ob der Fehler im Fetch, Parse, Normalize, Staging
  oder D1-Schema liegt.

### Priorität 1: Preparation zuverlässig und idempotent machen

- Start unter einem atomaren Generation-/Lease-Guard deduplizieren.
- Fresh-pending und gleiche Generation müssen für alle Caller denselben
  No-op-/Resume-Vertrag liefern.
- Alarm-Scheduling muss idempotent bleiben und darf GET nicht als unbounded
  Wake-up-Schleife nutzen.
- Fehler nach Phase und Retryklasse unterscheiden. metrics.retries darf
  nicht jeden terminalen Fehler als Overpass-Retry erscheinen lassen.
- Buildings-Cursor 0, Antwortgröße, Parsezeit, Normalisierungszeit und
  Staging-Insert als sichere Metrik erfassen.

### Priorität 2: Staging-Leseamplifikation entfernen

- Edge-Menge einmalig in bounded, cursorlesbare Partitionen materialisieren
  oder eine vergleichbare stabile Edge-Indexierung nutzen.
- Link-Schritte dürfen nicht für jeden 250er-House-Slice alle Edge-Chunks
  neu lesen.
- Graph-, Address- und Publish-Phasen auf feste, sichtbare Read-Budgets
  prüfen.
- Base-Storage, manuelle Parent-Links und atomaren Publish beibehalten.

### Priorität 3: Upstream-Sicherheit

- Mit dem konkreten Buildings-Fehler testen: 2xx-HTML, JSON-remark,
  leerer Body, abgebrochener Stream, 429, 503, Timeout, übergroßer Body,
  ungültige Building-Geometrie und gültige leere Antwort.
- Eine gültige leere Buildings-Antwort muss von Transport-/Parse-Fehlern
  unterscheidbar sein.
- Keine Erhöhung von Feature-, Byte-, Tile- oder Timeout-Limits ohne Messung.
- Keine zusätzliche Providerlast als Diagnose einsetzen.

## Sync und Persistence

### Aktueller Vertrag

- D1 ist die kanonische Autorität für Daten, Revision, Berechtigung und
  Mutation.
- RxDB hält fünf getrennte Collections: Campaign, Team, Area, StreetTask und
  HouseTask.
- Der Campaign-Durable-Object sendet nur kleine monotonic invalidation hints.
- Pulls nutzen Cursor und physische Feed-Seiten. Der aktuelle
  Deduplizierungsfix verhindert ein vorzeitiges Ende bei wiederholten
  Änderungen desselben Dokuments.
- Safety-Checkpoint des sichtbaren Clients läuft aktuell alle 120 Sekunden.
  Reconnect-Backoff liegt zwischen 2 und 30 Sekunden.
- User-Mutationen bleiben normale Mutation-/Overlay-Pfade. Base-Preparation
  darf User-Label, Status, Coverage und manuelle Parent-Beziehungen nicht
  überschreiben.

### Sync-Risiken, die im Plan bleiben

- Cold-Bootstrap ist für alle Collections unpaged.
- Street- und House-Bootstrap lesen bei Base-Storage beide vorbereiteten
  Entity-Kategorien campaignweit und filtern teils erst im Worker.
- Jeder inkrementelle Pull aggregiert Generation-State und Revision erneut.
- Push kann je Zeile Snapshot vor und nach der Mutation laden.
- Replay-Prüfung beim Network Intent kommt nach dem Area-Snapshot.
- Zwei unabhängige Geräte haben keinen gemeinsamen RxDB-Leader. Ein einzelner
  Browser-Leader schützt nicht vor Mehrclient-Reads.

### Pflichtregressionen

- 0, 400, 1.000, 5.000 und 10.000 Legacy- und Base-Entitäten.
- Ein Team-Rename, ein Area-Rename, ein Street-Status und ein House-Status.
- One start, identischer repeat, parallel start, Job-Resume und stale
  Generation.
- Reload während pending, ready und failed.
- Offline-Mutation, Reconnect, verlorene HTTP-Antwort und zweiter Client.
- Keine Resurrection, keine falschen Konflikte, keine fremden Team-Scopes.

## Smart Marking und Gebiets-UX

### Aktueller Smart-Mark-Befund

- Smart Street beginnt über useNetworkWorkspace und arbeitet nur mit
  vorbereiteten Street-Network-Tasks.
- Die MapLibre-Quellen und festen Candidate-/Preview-Layer für smart-street
  und smart-house existieren.
- Die Haupt-App nutzt aktuell nur smart-street.
- SmartHouseSelectionPanel und zugehörige Candidate-/Task-Module sind im
  Haupt-App-Pfad nicht importiert. Es gibt dort keine Auswahl-, Review- oder
  Save-Verkabelung für Smart Houses.
- smartSelectedSourceIds ist im aktuellen Workspace immer leer.
- Der Street-Panel-Flow enthält Punktwahl, Ambiguitätsauswahl,
  Routenvorschau und vier Statusaktionen. Das ist korrekt user-directed,
  aber noch schrittlastig.
- Manual Street bleibt der manuelle Fallback. Der Server darf daraus keine
  Smart-Mark-Intent oder Nutzerfortschritt ableiten.

### Neuer visueller Vertrag für Gebiet zeichnen und Gebiet editieren

Die neue Referenz ist der kompakte Street-Mode-Header:

- dunkles, kompaktes Field-HUD am bestehenden Standardort,
- Handle oben,
- Titel/Kicker links,
- drei runde Header-Aktionen rechts,
- kein breiter zusätzlicher Close-Button,
- Bestätigen deaktiviert, bis die Geometrie gültig ist.

Dieser Vertrag wird für beide Gebietsmodi verbindlich:

| Modus | Zurück | Abbrechen | Bestätigen |
| --- | --- | --- | --- |
| Gebiet zeichnen | letzten Eckpunkt entfernen | gesamte neue Geometrie verwerfen | Gebiet speichern, nur bei gültiger Geometrie |
| Gebiet editieren | letzte Vertex-Verschiebung aus einem Edit-Stack zurücknehmen | alle Änderungen dieser Session verwerfen | neue Geometrie speichern, nur bei gültiger Geometrie |

Zusätzliche Pflichtanzeigen:

- sichtbarer Approved-Status: Approved/Freigegeben nur bei speicherbarer
  Geometrie, sonst Nicht approved/Ungültig oder Noch nicht ausreichend,
- aktuelle Punktzahl und explizites Maximum, zum Beispiel 7 / 50 Eckpunkte.
- Der aktuelle Code hat noch kein maximales Polygon-Punktlimit. Der Wert
  50 ist ein initialer Produktvorschlag und muss vor Umsetzung als
  AREA_MAX_VERTICES reviewt und in Client- sowie Servervalidierung
  identisch durchgesetzt werden. Ein stillschweigendes Limit ist nicht
  akzeptabel.
- Die Anzeige muss auch bei eingeklapptem Header den Approved-Status und n /
  max erkennen lassen. Der Body darf die ausführliche Begründung zeigen.
- Ungültige Selbstüberschneidung, zu kleine Fläche, Kartenbereich und
  Punktlimit müssen einzeln verständlich benannt werden.

Der Zeichenmodus besitzt aktuell eine Rückgängig-Aktion nur im Body und
startet eingeklappt. Der Editiermodus hat aktuell keine Header-Aktionen und
keinen Edit-Undo-Stack. Beide Lücken erklären die Screenshots und werden
unter einem gemeinsamen Geometry-Header-Contract geschlossen.

### Field-HUD-Größe, Position und Kommentar-Toggle

Der bestehende FieldBottomSheet-Vertrag hat drei Snaps: compact 34 Prozent,
expanded 62 Prozent und full 88 Prozent der Viewport-Höhe. Er liegt am
unteren Rand und auf Desktop links mit dem bestehenden Edge-Gap. Dieser
Vertrag wird nicht durch einen neuen Sheet-Typ dupliziert.

Für Gebiet zeichnen, Gebiet editieren und die Kommentaransicht werden
folgende Layoutregeln festgelegt:

- Standardöffnung am bestehenden unteren Field-HUD-Ort.
- Standardzustand ist der kompakte, eingeklappte Header wie in der
  Street-Referenz. Erst bei Bedarf wird der Body geöffnet.
- Eingeklappt darf die alte globale min-height 12rem nicht künstlich
  Raum reservieren. Die Mindesthöhe muss Header, Handle und die drei
  Aktionen vollständig aufnehmen.
- Ausgeklappt erhält der Body die kleinste ausreichende Höhe für Status,
  Punktzähler, Erklärung und Aktionen. Kein leerer Vollbildbereich.
- User-Drag, Keyboard-Snaps, Safe-Area und Body-Scroll bleiben erhalten.
- Desktop-, schmale Mobile- und kurze Viewport-Größen müssen separat visuell
  geprüft werden. Die Änderung darf die 44-Pixel-Ziele nicht verkleinern.

Der Kommentarbutton wird semantisch und visuell zu einem stabilen Toggle:

- Ein Klick auf das Kommentar-Icon öffnet den Kommentarbereich.
- Ein zweiter Klick auf denselben Button schließt ihn wieder.
- Der Button bleibt derselbe Kontext-Button und zeigt seinen Zustand über
  aria-expanded und eine kompakte aktive Darstellung.
- Der sichtbare Text Kommentare schließen als breite zweite Schaltfläche
  entfällt. Der Toggle darf nicht beim Öffnen zu einer separaten Close-Aktion
  umgebaut werden.
- Der Kommentarzähler bleibt am Toggle. Laden, Fehler, Offline und
  Schreibberechtigung bleiben im geöffneten Body sichtbar.
- Der erste geöffnete Zustand, Standard-Snap, minimale Höhe, Breite,
  horizontale Anordnung und Position werden gemeinsam mit dem Field-HUD
  festgelegt. Kein nachträglicher Spezial-CSS-Patch nur für Kommentare.

Technischer Befund: CommentsContextPanel besitzt bereits einen Boolean
expanded-State und schaltet beim Klick um. Die aktuelle Darstellung ändert
aber den Buttontext in Kommentare schließen und macht ihn im geöffneten
Zustand breit. Die gewünschte Änderung ist daher vor allem ein stabiler
Toggle-/Layoutvertrag, keine neue Kommentar-API.

### Vereinfachter Smart-Mark-Flow

Nach erfolgreicher, sichtbarer serverseitiger Preparation:

1. Area-Sheet zeigt einen einzigen primären Einstieg: Straßen markieren.
2. Map zeigt Startpunkt und Endpunkt. Bei genau einer Route erscheint die
   Vorschau direkt. Bei mehreren gleich guten Routen muss der Nutzer eine
   Route wählen.
3. Eine eindeutige Bestätigungsaktion übernimmt nur die vom Nutzer gewählte
   Route.
4. Danach zeigt ein klarer Statusbereich die vier bestehenden
   Statusentscheidungen. Kein Statuswechsel ohne Nutzeraktion.
5. Optional öffnet der Nutzer danach Häuser hinzufügen. Kandidaten werden
   gezählt, angezeigt und einzeln oder über eine explizite begrenzte
   Sammelauswahl bestätigt.
6. Erst bestätigte Häuser gehen als normale, user-directed
   house.create-batch-Mutation in den bestehenden Sync-Pfad.
7. Abbrechen, Zurück und Offline-Vormerken dürfen keinen erfundenen
   Fortschritt erzeugen.

Serverseitige Preparation erzeugt nur Basisgeometrie, Topologie,
Adressierbarkeit, Generation und physische Base-Daten. Smart Marking erzeugt
keine Nutzerabsicht, keine Coverage und keinen erledigt-Status.

## Architecture Boundaries

| Verantwortlicher Teil | Darf tun | Darf nicht tun |
| --- | --- | --- |
| StreetEngine Worker/DO | OSM bounded laden, Roads/Buildings normalisieren, Topologie und Adressierbarkeit bestimmen, Generation atomar publizieren | User-Progress, Street-Auswahl oder House-Auswahl erfinden |
| D1 | kanonische Area-, Base-, Overlay-, Task-, House-, Feed- und Revision-Daten halten | Client-Local-State als Autorität akzeptieren |
| RxDB | lokale Materialisierung, Offline-Queue und konvergente Pulls/Pushes | Berechtigung oder Base-Identität selbst bestimmen |
| Smart Marking UI | Route/Häuser prüfen, auswählen, bestätigen und Status explizit setzen | OSM-Weg allein als Nutzeraktion behandeln |
| MapLibre | feste Quellen und Layer darstellen, hit-testen und Vorschau zeigen | pro House eigene Layer oder React-Geometrie pro Frame verwenden |
| OSM/Source-Cache | öffentliche Provenienz und wiederverwendbaren Source-Tile-Input liefern | Nutzeridentität oder Progress repräsentieren |

Immutable Base-Chunks, mutable Work-Overlays, Manual-Parent-Erhalt,
Revision-Guards und atomarer Feed-Publish bleiben erhalten.

## Test Plan

### Lokale Kosten- und Querytests

- Query-Fingerprints pro Route, Phase und Scope zählen.
- EXPLAIN mit realistischen Zeilenmengen wiederholen, nicht nur leerem Schema.
- returned rows, estimated scanned rows, Indexprobes, JSON-Expansion und
  Cloudflare meta.rows_read getrennt ausweisen.
- Tests für jede Kandidatenmigration vor jeder Remote-Freigabe.
- Prüfen, dass status GET weder einen unbounded Scheduler-Loop noch einen
  Task-/House-Snapshot auslöst.

### StreetEngine

- Buildings-Cursor 0 mit gültiger leerer Antwort.
- Buildings-Cursor 0 mit 429, 503, Timeout, HTML, JSON-remark, leerem Body,
  abgebrochenem Stream, übergroßer Antwort und ungültigem Way.
- Provider-Failover nur bei erlaubten transienten Codes.
- Resume nach transientem Fehler, terminaler Fehler nach begrenzten Attempts.
- Geometrieänderung während Fetch darf keine alte Generation publizieren.
- 0/400/1.000/5.000/10.000 Houses und 256-Tile-Grenze.
- Edge-Read-Anzahl muss unabhängig von der Zahl der 250er House-Slices
  werden.

### Sync und UX

- Zwei echte getrennte In-Memory-RxDB-Clients mit Offline/Online, Reload,
  verlorenem Response und gleicher Mutation.
- Separater Zwei-Tab-Test in einer Umgebung, die den
  broadcast-channel-Adapter erlaubt. Den aktuellen lokalen EPERM nicht
  als Produkt-PASS verbuchen.
- Area-Draw: 0, 1, 2, gültige 3, über Maximum, Selbstüberschneidung,
  Zurück, Abbrechen, Bestätigen.
- Area-Edit: mehrere Vertex-Moves, Zurück je Schritt, Abbrechen komplett,
  gültiges Speichern, stale Revision.
- Kommentar-Toggle: öffnen, schließen, erneutes öffnen, Fehler, Offline,
  Zähler, Keyboard und schmale Viewports. Kein Textbutton
  Kommentare schließen.
- MapLibre-Fixed-Layer, Candidate-Hit-Test, Smart-House-Kandidaten und
  normaler Browse-Modus dürfen sich nicht gegenseitig sichtbar machen.

## Real Device Plan

Nur nach Freigabe und nur auf dem ausdrücklich autorisierten Admin-Staging:

1. Exakten Commit und vorhandenen persistenten D1-Schema-/Migrationsstand
   read-only bestätigen.
2. Auf iPad Safari authentifizieren, eine kleine Area auswählen und die
   Vorbereitung einmal auslösen.
3. Safe Network-Evidence sichern: POST/GET-Status, JSON ohne Cookies oder
   Authorization, HTTP-Dauer, errorCode, phase, cursor und sichtbaren
   Fortschritt.
4. Buildings-Cursor 0 gezielt beobachten. Bei Abbruch keine neue Serie von
   Starts auslösen. Einen vorhandenen Job nur nach seinen gespeicherten
   Fehlerdaten und bestehendem Resume-Vertrag fortsetzen.
5. Nach Ready sichtbare Area-, Street- und House-Geometrie prüfen, nicht nur
   querySourceFeatures().
6. Kommentar-Toggle, Gebiets-Zeichen- und Gebiets-Edit-Header bei normaler,
   kurzer und gedrehter Viewport-Höhe prüfen.
7. Einen zweiten unabhängigen Client für Pull, Statusänderung, Reload und
   Offline-Reconnect verwenden.
8. Dasselbe begrenzte Szenario auf iPhone Safari und Android Chrome
   wiederholen, sofern Geräte verfügbar sind.

Erwartete Seed-Diagnose darf nur als Vergleich dienen: appliedAreas = 4,
appliedStreets = 343, appliedHouses = 1233. Null oder fehlende queued-Werte
sind kein Beweis für sichtbare Map-Geometrie.

## D1 Read Budget

Die folgenden Regeln sind Freigabegates, keine Behauptung des aktuellen
Stands:

| Pfad | Muss vor Release gelten |
| --- | --- |
| Preparation-Status GET | Nur Area/State/gezielter Job; keine House-/Task-/Base-Campaign-Ladung; terminale States stoppen Polling; GET erzeugt keinen wiederholten Scheduler-Wake-up ohne Guard. |
| Preparation-POST/Begin | Ein Area-Kontext, idempotente Generation und Lease; kein voller fremder Snapshot. |
| Incremental Pull | Eine physische Feed-Seite plus fixer Head-/Revision-/Generation-Overhead; kein voller Bootstrap. |
| Cold-Bootstrap | Jede Collection explizit paginiert oder mit einem begründeten Scope-Limit; kein unpaged Campaign-Read im normalen Client. |
| Metadata-Push | Keine unrelated Task-/House-Rows. |
| Subject-Push | Nur erforderliche Area-/Entity-/Authorization-Reads; keine doppelte Snapshot-Ladung ohne Begründung. |
| Network Intent | Replay-Schlüssel vor schwerem Area-Snapshot prüfen, wenn der Autorisierungsvertrag das erlaubt. |
| Runner | Höchstens 50 Statements je Invocation plus separat gemessener Rows-Read; Edge-Reads nicht O(E x H/250). |
| Source-Cache | Hit gezielt; Pruning begrenzt und mit passendem Zugriffspfad. |
| Collection/History/Stats | Scope, Sortierung und JSON-Expansion mit realer Kardinalität gemessen. |

Für die gemeldete ungefähr 5-Millionen-Tagesgrenze wird kein neues Feature
aktiviert, solange die vorhandene Tageskurve und der zusätzliche Read-Bedarf
nicht zusammenpassen. Kein Paid-Upgrade ist die Remediation.

## Implementation Order

1. Bestehende Metrics- und Job-Evidence sichern, ohne neue Remote-Last.
2. Buildings-Cursor-0-Fehler reproduzierbar machen und öffentlich sowie
   intern sauber klassifizieren.
3. Read-Instrumentation und lokale EXPLAIN-/Kardinalitätstests ergänzen.
4. Bootstrap, Full-Snapshot, House-Zielpfad, Manifest und
   Collection-Member-Reads evidence-basiert begrenzen.
5. Preparation-Start, Lease, Retry und Runner-Progress idempotent machen.
6. Edge-Staging und große Graph-/Address-/Publish-Reads skalierbar machen.
7. Sync-/Two-Client- und Real-Device-Gates schließen.
8. Gemeinsamen Geometry-Header für Area-Draw und Area-Edit bauen:
   Zurück, Abbrechen, Bestätigen, Validierungsstatus, n/max und gemeinsame
   Snaps.
9. Kommentarbutton als stabilen Toggle mit gemeinsamem Layoutvertrag
   abschließen.
10. Smart Street vereinfachen und Smart House end-to-end verdrahten,
    weiterhin ausdrücklich user-directed.
11. Erst danach additive Migrationen, CI, Staging-Deploy und Geräteabnahme
    auf einem exact-head durchführen.

## Risks

- Ein nicht repräsentativer SQLite-Plan kann D1-Row-Reads unterschätzen.
- Ein lokaler Retry-Test kann Overpass-Limits und Cloudflare-Laufzeit nicht
  abbilden.
- Base-Storage kann auf Staging fehlen, obwohl Code und CI grün sind.
- Eine zu aggressive Index- oder Pagingänderung kann Scope, Tombstones,
  Generationen oder Manual-Parent-Erhalt beschädigen.
- Ein UI-Toggle darf Kommentar-Ladezustand nicht mit Kommentar-Persistenz
  verwechseln.
- Ein Area-Undo darf keinen bereits kanonisch gespeicherten Stand
  zurückschreiben, bevor der Nutzer bestätigt.
- Ein Smart-House-Bulk-Button darf keine Kandidaten stillschweigend als
  Nutzerfortschritt markieren.

## Rollback

- Analysephase: nur Dokumentationscommit zurücknehmen, keine Datenänderung.
- Runtime-Rollout: Feature-Flag für automatische Preparation und Smart
  Marking geschlossen halten, bis CI/Staging/Device-Gates grün sind.
- Additive D1-Migrationen nie durch destruktives Zurücksetzen rückrollen.
  Bei Fehlern Anwendungsversion zurückrollen und neue Indizes ungenutzt
  lassen, sofern sie additiv und kompatibel sind.
- Base-Chunks und Overlays nicht löschen, um einen UI-Fehler zu kaschieren.
- Bei Kommentar-/Geometry-Regression auf den vorherigen Field-HUD-Vertrag
  zurück, ohne kanonische Kommentare oder Area-Geometrien zu verändern.

## Definition of Done

- Aktueller Branch, PR-Head, Base, CI und Staging sind erneut exakt belegt.
- Die konkrete Buildings-Cursor-0-Fehlerklasse ist mit Jobdaten oder
  reproduzierbarem Minimaltest erklärt.
- 4,5 Millionen Rows-Read sind entweder einer realen Queryfamilie
  zugeordnet oder ausdrücklich als unbekannt stehen gelassen.
- D1 rows_read, returned rows, scanned rows, Requests, CPU und Bytes sind
  getrennt dokumentiert.
- Keine unpaged Routine-Reads bleiben ohne bewusstes Budget.
- Preparation ist idempotent, resumable, lease-geschützt und publiziert
  atomar.
- Edge-Read-Amplifikation ist entfernt oder mit einem nachweisbaren Budget
  begrenzt.
- D1 bleibt kanonisch, RxDB konvergiert bei zwei Clients und User-Work wird
  nicht durch Base-Reconciliation überschrieben.
- Area-Draw und Area-Edit besitzen denselben kompakten Header mit Zurück,
  Abbrechen, Bestätigen, Validierungsanzeige und sichtbarem n/max.
- Kommentar ist ein echter Toggle. Ein separater Kommentare schließen-
  Button existiert nicht. Standardposition, Standard-Snap und Mindestgröße
  sind auf den drei Zielviewportklassen geprüft.
- Smart Street und Smart House erfinden keinen Nutzerfortschritt. Houses
  werden nur nach expliziter Nutzerprüfung gespeichert.
- Normal-CI, Typecheck, Dependency-Audit, Build, Staging und echte Geräte-
  abnahme sind jeweils mit exaktem Commit dokumentiert.
- MAP_RENDER_P0 und STREET_ENGINE_LIVE_READY werden erst nach realer
  sichtbarer Geräte-Evidence geschlossen.

## Offene Evidence von Master

Falls verfügbar, reichen für den nächsten Diagnoseblock:

- F12 Network: Preparation-POST und letzter GET mit Status, JSON,
  timestamp, Dauer, errorCode, phase, cursor und progress. Keine Cookies,
  Authorization, Tokens oder unredacted HAR.
- /api/runtime-JSON aus einer vorhandenen autorisierten Network-Antwort.
- Bestehende Cloudflare-D1-Metrik für das betroffene Zeitfenster mit
  Rows-Read-Kurve und Querystatistik.
- Eine gezielte, indexierte interne Jobprojektion mit phase, cursor,
  attempts, error_code, lease_until und metrics_json.lastError.

Bis diese Daten vorliegen bleiben Live-Attribution und
STREET_ENGINE_LIVE_READY offen. Dieser Masterplan enthält keine ausgeführten
Runtime-Fixes.
