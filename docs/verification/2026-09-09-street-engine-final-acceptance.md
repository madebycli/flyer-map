# Street Engine: finale technische Abnahme

Stand: 2026-09-09 (UTC)

## Beweiskette

- Repository: `madebycli/flyer-map`
- PR: [#92](https://github.com/madebycli/flyer-map/pull/92), Draft, offen, nicht gemergt
- Branch: `fix/street-engine-smart-marking`
- Base: `integration/main-street-runtime@f4facd6ef354c5ba6de861519b696bce6f46a209`
- Bewerteter Implementierungs-Head: `ad306e075c09d42a6853807f570b543f982ac0c8`
- Exakter CI-Run: [34395703912](https://github.com/madebycli/flyer-map/actions/runs/34395703912)
- CI-Resultat auf diesem Head: 830/830 Tests, Typecheck PASS, Dependency Audit 0 Vulnerabilities, Production Build PASS

Der Bericht wird als Dokumentations-Checkpoint committed. Der Bewertungs-Head oben bezeichnet den Runtime-Stand, auf dem die technische Evidenz erhoben wurde; ein späterer reiner Dokumentations-Commit ändert keine Runtime-Datei und erhält die Beweiskette.

## Follow-up-Gate-Versuch (2026-09-09T20:19Z)

- Der tatsächliche PR-Head wurde vor dem Versuch live geprüft: `de59b3d14a26ce47139c299a4d5413a936a50f7f`. Es gab keine Runtime-Änderung.
- Die vorhandenen Staging-Origins `flyer-map-staging.cloudflare-eleven035.workers.dev` und `flyer-map-admin-staging.cloudflare-eleven035.workers.dev` liefern beide denselben Organizer-Login (`/login`) mit Benutzername, Passwort und `Weiter`. Die sichere Browser-Anmeldung endete als `user_took_over`; der Nutzer meldete anschließend, dass der Login abgewiesen wird. Eine Domain-/Credential-Zuordnung ist damit nicht bewiesen, und es entstand keine authentifizierte Produktseite. Es gab weder iPhone-Safari/WebKit noch Android-Chromium-Gerätesevidence und keinen MapLibre-/Overpass-Smoke. G2, G7 und G10 bleiben deshalb BLOCKED.
- Der ausschließlich lesende Versuch `wrangler d1 list --json` konnte wegen fehlender Netzwerkfreigabe nicht gestartet werden (Approval vor Ausführung abgebrochen). Es gab keinen D1-Request, keine Migration und keinen Write. G4 und G6 bleiben deshalb BLOCKED.
- Kein reproduzierbarer Runtime-Fehler, kein Fix und keine neue Regression.

## Gate-Matrix

| Gate | Ergebnis | Nachweis / fehlende Voraussetzung |
|---|---|---|
| G0 Exact Head | PASS (Runtime-Head) | PR-Head `ad306e0…` und CI-Run `34395703912` identisch; der neue Test hebt die Suite von 829 auf 830. |
| G1 Unit/Type/Audit/Build | PASS | CI: 830/830, Typecheck, Audit `0`, Build grün. Lokal: 830 Tests, 827 PASS plus drei bekannte Sandbox-`/tmp`-Fehler (siehe unten). |
| G2 MapLibre Mobile | BLOCKED | Kein erreichbarer authentifizierter Staging-Build und kein echtes iOS-/Android-Gerät/WebGL-Log. Lokaler Browserzugriff war durch `ERR_BLOCKED_BY_CLIENT` blockiert. |
| G3 Zwei unabhängige Clients | PASS (lokale Isolation) | Zwei getrennte RxDB-Memory-Storages/Checkpoints: gegenseitige Statusänderungen, Offline-Area-Delete, stale Child-Write nach Reconnect; beide Clients sehen Delete, Server bleibt ohne Area/Kinder, Foreign-Key-Check sauber. Stale Push wurde als `house_position_server_owned` verworfen, ohne Resurrection. |
| G4 History Read | BLOCKED (final) | Lokales 500/5.000/25.000-Profil und EXPLAIN vorhanden, aber kein echtes Staging-D1-Profil und keine vollständige Session-/Task-/UI-Matrix mit 20 Läufen je Pfad. |
| G5 Working Geometry / Cold Recovery | PASS (lokaler Recovery-Vertrag) | Nach Preparation, House-Status, Smart-Marking-Coverage und manueller House-Parent-Erstellung lief ein frischer D1-Repository-Read ohne Hot-Cache/Overpass-Re-fetch. Hash vor/nach Read identisch; 1 Street, 4 Houses, Coverage 1 Segment, manueller Parent und `later`-Status erhalten. |
| G6 D1 Metadata / EXPLAIN | BLOCKED | Binding ist statisch bekannt (`DB`/`flyer-map-db`; Staging-Workflow erwartet `flyer-map-staging-db`), aber read-only Cloudflare-Abfrage wurde mangels erlaubter Cloudflare-Netzwerkfreigabe nicht ausgeführt. Keine Migration angewendet. |
| G7 Live Overpass / Staging E2E | BLOCKED | Nur lokale/stubbed Overpass-Antworten; keine authentifizierte Staging-URL, kein Cold/Warm/Reload/Failure-Recovery-Nachweis gegen echten Provider. |
| G8 Generation Safety | PASS (lokal/CI) | A/B/C delayed/stale completion und Legacy-Parent-Migration fokussiert grün; Generation Visibility blockiert partielle gemischte Generationen. |
| G9 Area Delete Sync | PASS (lokal/CI) | 100 Streets/1.000 Houses mit zwei Replikas ohne Child-Push-Sturm; zusätzlicher stale-offline-Clienttest grün. Parent-only Delete entfernt Area, Base/Overlay/Preparation und alle sichtbaren Kinder; keine FK-Fehler/Resurrection. |
| G10 Product Regression | BLOCKED (real browser) | Lokale Domain-/Sync-/Smart-Marking-/Manual-Parent-Regressionen grün; echter Login/MapLibre/Touch/Reload-Smoke fehlt wegen Browser-/Staging-Blockade. |
| G11 No forbidden action | PASS | Kein Merge, Production-Deploy, Production-Migration `0023`, Secret-Änderung oder bezahlter Provider. Cloudflare-Read-only-Versuch wurde vor Ausführung blockiert. |

Ein BLOCKED-Gate bedeutet nach dem Abnahmevertrag: **10/10 = NO** und `STREET_ENGINE_LIVE_READY = FALSE`.

## D1-/Runtime-Budget

Alle Werte sind lokale SQLite-/Budget-Estimates, keine Cloudflare-Billingwerte.

| Operation | Korpus | Statements / Queries | Writes | Zusatz |
|---|---:|---:|---:|---|
| Preparation | 10.000 Houses | 46 Alarm-Aufrufe; max. 45 Queries je Alarm | 532 geschätzt | bounded Chunks/Overpass-Tiles |
| Canonical Area Delete | 10.000 Houses | 35 Delete-Queries | 323 geschätzt | Parent-only, keine Child-Mutationskaskade |
| History-enabled House Mark | 500 Houses | 24 Queries | 50 geschätzt | 501 lesbare Event-Identitäten; Regression-Limit 100 eingehalten |
| RxDB pull | normaler Batch | 100 Dokumente pro Pull-Batch | n/a | `PULL_BATCH_SIZE = 100`; kein Cloudflare-Lauf |
| History first page | 500 / 5.000 / 25.000 Events | 7 Queries inkl. Schema-Probes | n/a | 30-row page; lokales Profil unten |

## History-Read-Profil (lokal)

Fünf Warmups und danach 20 Warm-Runs je Korpus, `Activity` erste Seite (`limit=30`). Response-Bytes umfassen die 30 projizierten Items, nicht den internen JSON-Expand.

| Korpus | Batch-Zeilen | Query-Count | Payload | p50 | p95 |
|---:|---:|---:|---:|---:|---:|
| 500 | 10 | 7 | 12.546 B | 3,65 ms | 4,96 ms |
| 5.000 | 100 | 7 | 12.608 B | 28,23 ms | 32,33 ms |
| 25.000 | 500 | 7 | 12.671 B | 131,75 ms | 142,37 ms |

Lokales `EXPLAIN QUERY PLAN` bestätigt für Campaign-History den Campaign-Index auf `street_network_history`, `json_each` pro Batch und einen temporären B-Tree für die globale Zeit/ID-Sortierung. Der Field-Session-Pfad verwendet `street_history_session(field_session_id, occurred_at)` vor `json_each`. Das ist kein Beweis für Cloudflare-D1 und ersetzt die ausstehende Staging-Messung nicht.

## Cold-Recovery-Klassifikation

| Zustand | Klasse | Autoritative Quelle nach Cold Start | Ergebnis |
|---|---|---|---|
| Prepared Street geometry | A | `street_base_chunks` + veröffentlichte Generation | Hash-/Semantik stabil |
| Prepared Houses | A | Base-Chunks, Overlay-Merge | 4 sichtbare Houses stabil |
| Coverage segments | A | Work-Overlay / Street-Network-State | 1 Segment erhalten |
| Status/Labels | A | Work-Overlay bzw. kanonische Row | House-Status `later` erhalten |
| Manual House parent | A | `street_manual_house_parents` + House-Row | Parent-ID erhalten |
| Unconfirmed Point 1/2 | C | flüchtiger UI-Entwurf | Verlust erlaubt; kein Resume-Vertrag behauptet |
| Active generation | A | `street_base_areas` / Preparation-Metadaten | Ready-Generation stabil |
| Source timestamp | A | Preparation-/Source-Cache-Metadaten | nicht erneut aus Overpass benötigt |

Der lokale Hashvergleich ergab identische Werte vor/nach dem frischen Repository-Read (`stable=true`). Ein echter Worker-/DO-Neustart auf Staging bleibt Teil von G7 und ist nicht als erledigt markiert.

## Bekannte lokale Sandbox-Abweichungen

Die direkte lokale Suite zählt 830 Tests, davon 827 PASS. Drei Tests benötigen im verwalteten Runner ein vorhandenes `/tmp`-Verzeichnis und scheitern dort mit `ENOENT`: Durable Mutation Queue, Offline Map Repository und RxDB-Tabs-Leader-Handover. Der exakte GitHub-CI-Run `34395703912` läuft dagegen vollständig 830/830 grün.

## Schlussurteil

`STREET_ENGINE_LIVE_READY = FALSE`  
`10/10 = NO`

Die lokale Implementierung und die CI-Beweiskette sind stabil. Für eine echte 10/10 fehlen weiterhin G2 (reale Mobile-Browser), G4 (vollständiges History-Profil auf Staging-D1), G6 (reale D1-Metadaten/Pläne) und G7 (authentifizierter Live-Overpass-/Staging-Datenweg); G10 bleibt deshalb ebenfalls als realer Produkt-Smoke offen.
