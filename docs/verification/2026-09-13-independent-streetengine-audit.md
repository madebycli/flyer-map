# Unabhängiger StreetEngine- und Smart-Marking-Audit, 2026-09-13

## Urteil

Der geprüfte Produktkandidat ist **nicht freigabefähig**. Ein unabhängiger adversarialer Test reproduziert einen P1-Fehler in der persistenten Offline-Intent-Reihenfolge. Zusätzlich ist das 20k-Ziel weiterhin real nicht erreicht, die wiederholten Edge-Rereads in der Linkphase sind erneut messbar, und Geräte-/Staging-/Live-Evidence fehlt. Produktcode wurde in dieser Erstprüfung nicht verändert.

Verbindliche Flags:

- `INDEPENDENT_AUDIT = FAIL`
- `SMART_MARKING_LOCAL = FAIL`
- `SMART_MARKING_DEVICE = BLOCKED`
- `STREET_ENGINE_20K = FAIL`
- `AREA_DELETE_READ_PATH = VERIFIED_FIXED`
- `D1_STATUS = OPEN`
- `D1_ATTRIBUTION_CONFIRMED = FALSE`
- `MAP_RENDER_P0 = OPEN`
- `STREET_ENGINE_LIVE_READY = FALSE`

## Evidence-Freeze und Isolation

- Repository: `madebycli/flyer-map`.
- Draft PR: #92, offen/unmerged.
- PR-Base: `integration/main-street-runtime@f4facd6ef354c5ba6de861519b696bce6f46a209`.
- Aktueller Implementierungsbranch-Head beim Freeze: `9734be5c19ab4307f5c33c0853958c269ac207bd`.
- Tatsächlich geprüfter Produkt-Runtime-SHA: `4c2d01e2a0a873c9c233e525e50f20148c648bda`.
- Zwischen `4c2d01e...` und `9734be5...` liegen nur die Dokumentationscommits `f650160...` und `9734be5...`; es wurde kein späterer Produktcode unbemerkt mitgeprüft.
- Eigene Branch: `audit/independent-streetengine-2026-09-13`.
- Eigener Draft-PR: #94.
- Der lokale Chat-Sandbox-Container konnte GitHub nicht per DNS erreichen. Deshalb liefen Checkout und Tests in frischen GitHub-Actions-Runnern auf der isolierten Audit-Branch. Das ist keine Geräte- oder Staging-Evidence.
- Unabhängige Scale-Umgebung: Node `v22.23.2`, npm `10.9.8`, `ubuntu-latest`.

Master-Context wurde ausschließlich über `project_id: flyer-map`, `source_repo: madebycli/flyer-map`, `context_root: projects/flyer-map/`, `entrypoint: projects/flyer-map/INDEX.md` geladen. Eine zentrale `.ai/CONTEXT.md` existiert am geprüften Repo-Head nicht.

## Unabhängige Befunde

### P1 - Offline-Intent-Reihenfolge kann eine spätere Aktion vor ihrem Vorgänger ausführen

**Datei/Funktion:** `src/data/networkIntentQueue.ts`, `enqueueNetworkIntent`, `queuedNetworkIntents`, `flushNetworkIntents`.

**Ursache:** Die Queue speichert nur `enqueuedAt: Date.now()` und sortiert bei gleichem Zeitstempel anschließend nach dem zufälligen Intent-Key. Der Key ist keine FIFO-Ordnungsinformation. Wandert die Geräteuhr rückwärts, entsteht dasselbe Problem auch ohne identischen Millisekundenwert.

**Minimale Repro:** Commit `5df17de338b74769261b3895b53d84a03185be51`, CI `34763554828`, Job `103740445480`. Zwei Offline-Aktionen erhalten absichtlich denselben Zeitstempel. Die zuerst erzeugte Aktion heißt `z-first-action`, die zweite `a-second-action`. Aktion 2 modelliert eine Folgeaktion, deren `expectedState` die Anwendung von Aktion 1 voraussetzt.

**Erwartet:** Requests `z-first-action`, danach `a-second-action`, Queue leer.

**Beobachtet:** Nur `a-second-action` wird zuerst gesendet, erhält `network_work_changed`, wird blockiert und steht vor dem noch unangetasteten `z-first-action`. `flushNetworkIntents` bricht am blockierten Eintrag ab. Die korrekte Vorgängeraktion läuft dadurch nicht mehr, bis der Nutzer den späteren blockierten Eintrag verwirft.

Der final erweiterte Lauf `34763796100` auf Audit-SHA `8f1959614ad117dac26f80a2ed8ab8dbd8a2b307` bestätigt denselben Fehler erneut: 898 Tests, 897 PASS, exakt dieser eine FAIL.

**Auswirkung:** Offline-Folgeaktionen können in falscher Reihenfolge zum Server gelangen, einen künstlichen Konflikt erzeugen und die korrekte Vorgängerarbeit hinter einem blockierten Eintrag festhalten. Das verletzt den Smart-Marking-Vertrag für mehrere Offline-Aktionen und deren optimistische Erwartungszustände.

**Begrenzter Fixvorschlag:** Persistente monotone FIFO-Sequenz pro Scope oder ein auto-increment-basierter Ordnungswert in IndexedDB. `Date.now()` darf höchstens Anzeigezeit sein, nicht die autoritative Reihenfolge. Bestehende Queueeinträge kompatibel migrieren. Regressionen: gleicher Millisekundenwert, rückwärts springende Uhr, Reload, zwei abhängige Aktionen, blockierter Vorgänger/Nachfolger und explizites Verwerfen.

### P1 - 20k-Kapazitätsziel weiterhin nicht erfüllt

Der unabhängige Scale-Run `34763667410` reproduziert das vorhandene Limit. 0, 399, 1k, 5k und 10k Houses werden `ready`. 20k mit zwei Tiles endet bereits in `addresses` mit internem `house_assignment_budget`; öffentlich wird `area_preparation_too_many_features` zurückgegeben. Das ist ein korrektes kontrolliertes Ablehnen, aber **kein bestandener 20k-Kapazitätstest**.

Bei 10k wurden im synthetischen Node-Lauf 119,592,416 Bytes Process-Heap gesampelt, bei der abgelehnten 20k-Fixture 132,387,904 Bytes. Das sind keine Cloudflare-Isolate-Peaks und kein OOM-Beweis. Sie verstärken aber die Pflicht, vor einer Grenzerhöhung Graph, Addressing und Publish getrennt in einer geeigneten Worker-/DO-Umgebung zu profilieren.

**Begrenzter Fixvorschlag:** 10k-Konstante nicht isoliert anheben. Zuerst Link-Rereads begrenzen, Cold-Restart-Verhalten sichern, Phasen-Heap/CPU messen und 20k-Publish/Feed/Sync atomar nachweisen. Erst danach Capability-Grenze ändern.

### P2 - Linkphase liest den vollständigen Edge-Payload weiterhin pro 250-House-Schritt

Der unabhängige 10k-Scale-Run misst `edgeReads=41` und `edgeBytes=527629`: 40 Link-Slices plus Publish. Dieser Befund stimmt mit dem früheren Audit überein und ist jetzt erneut auf der eingefrorenen Runtime ausgeführt. Das ist keine Cloudflare-`rows_read`-Messung, aber der bewusst breite wiederholte Payload-Read ist real.

**Auswirkung:** D1-/Deserialisierungs-/CPU-Arbeit wächst mit der Zahl der Link-Slices, obwohl der Graph unverändert ist. Retry/Crash kann sie zusätzlich wiederholen. Deshalb bleibt `D1_STATUS=OPEN`.

**Begrenzter Fixvorschlag:** Generation-/Hash-gebundener begrenzter Graphcache oder räumliche Edge-Partitionen mit D1 als Cold-Restart-Autorität. Gleiche Fixture vor/nach Fix nach Edge-Bytes, Statements, CPU und Ergebnisgleichheit vergleichen.

### P1 - Renderer-Sicherheitsentscheidung und aktueller Runtime-Stand widersprechen sich

`ADR-0030-maplibre-security-candidate.md` bezeichnet die gepatchte MapLibre-6.9.0-Richtung als akzeptiert und verwirft das Beibehalten der verwundbaren 5.7.1-Linie. Der aktuelle PR-Stand, `AGENTS.md`, `CURRENT.md`, `package.json` und `scripts/audit-dependencies.mjs` verwenden dagegen bewusst MapLibre 5.7.1 und erlauben GHSA-jrc7-96c5-q579 als explizite Ausnahme. `docs/context-map.yaml` bezeichnet ADR-0030 zugleich als `candidate`. Ein supersedierender ADR wurde in den für diesen Auftrag geladenen Entscheidungen nicht gefunden.

**Auswirkung:** Ein grüner Dependency-Audit darf nicht als advisory-frei oder als Erfüllung von ADR-0030 ausgegeben werden. Vor Live-Freigabe fehlt eine widerspruchsfreie akzeptierte Rendererentscheidung.

**Begrenzter Fixvorschlag:** Entweder einen neuen ADR schreiben, der die temporäre 5.7.1-Isolation, Risiko, Release-Sperre und Exit-Kriterien ausdrücklich supersedierend festlegt, oder den gepatchten Renderer nach echter Browser-/Geräteabnahme wiederherstellen. Keine stille Ausnahme als Dauerzustand.

## Bestandene unabhängige Prüfungen

### Standard-Gates auf unverändertem Produktcode

Audit-Checkpoint `b0b03833be7bac710456134296ec13f75a7e0073` fügte nur das unabhängige Intervall-Orakel hinzu. CI `34763412593`, Job `103740063861` war vollständig grün: Test, Projekt-Typecheck, Dependency Audit und Production Build. Die Runtime blieb `4c2d01e...`.

Die vom Implementierer genannte CI `34761931839`, Job `103736181142`, wurde zusätzlich auf GitHub verifiziert: `head_sha` ist exakt `4c2d01e...`, alle vier Schritte Test, Typecheck, Dependency Audit und Production Build sind erfolgreich. Der Connector erlaubte keinen Roh-Logabruf dieses Jobs, deshalb wird die dort dokumentierte Testanzahl nicht als eigene Logmessung ausgegeben.

Der Dependency Audit ist nur mit der expliziten MapLibre-5.7.1-Ausnahme grün. Es gibt keine Aussage `zero advisories`.

### Abschnittssemantik mit unabhängigem Referenzmodell

`tests/independentStreetEngineAudit.test.ts` vergleicht `setCoverage` nach jeder von 2.000 deterministischen Zufallsoperationen mit einem unabhängigen 100-Zellen-Referenzmodell. Seed: `0x5eed2026`. Statuswerte: `open`, `completed`, `later`, `not-deliverable`; Vorwärts- und Rückwärtsrichtung werden gemischt. Der Test ist grün. Damit wurden Überlappung, Wiederöffnen, Nachbarschaft, Richtung und Erhalt unberührter Positionen nicht nur gegen Produktionslogik selbst gespiegelt.

Die frisch ausgeführte bestehende Suite bestätigt zusätzlich das verbindliche 8-25-Beispiel, sechs Waypoints, Detour/Backtracking, per-Leg-Mehrdeutigkeit, Undo, manipulierte Anker, Maximalgrenzen, veraltete Zustände und widersprüchliche Address-Node-IDs. Diese vorhandenen Tests sind Regressions-Evidence, aber nicht alle ein unabhängig entwickeltes Orakel.

### Prepared- und Legacy-Area-Delete

Eigene Gegenprobe auf `8f195961...`: Ziel-Area mit drei Houses, zweite völlig fremde Area mit 2.000 Houses.

- Prepared Delete: 21 Statements, 58 returned rows, 8 snapshot rows, keine erkannten Full-Scans. Fremde 2.000 Houses bleiben erhalten.
- Legacy Delete: 27 Statements, 61 returned rows, 11 snapshot rows, keine erkannten Full-Scans. Die drei benötigten Ziel-Houses werden für Tombstones berücksichtigt, die fremden 2.000 Houses bleiben erhalten.

Das beweist lokal die entscheidende Invariante gegen einen vollständigen Campaign-House-Snapshot vor dem Delete. Es beweist keine Cloudflare-Billingzahl. `AREA_DELETE_READ_PATH=VERIFIED_FIXED`.

### Quelle und Buildings cursor 0, synthetisch

Der isolierte Scale-Workflow führt zusätzlich Quellgegenfälle aus:

- Nur ein beschädigtes offenes Building: Generation schlägt mit `osm_normalization_no_trustworthy_buildings` fehl, Quality zählt `open_ring`.
- Null-Nodes: kontrollierter Normalisierungsfehler, Quality zählt `invalid_coordinate`, keine TypeError-Klassifikation als Transportfehler.
- Echte leere Building-Antwort: `ready`, 0 Houses, `emptyBuildingTiles=1`.

Damit sind die früheren Fehlerklassen lokal sauber unterschieden. Die Identität des real gemeldeten Buildings-cursor-0-Vorfalls bleibt **UNVERIFIED**, weil sanitisiertes Jobobjekt, exakter Deployment-SHA und Fehlerzeit nicht vorliegen.

### Skalierung, reproduzierbare synthetische Ergebnisse

Rohdaten: `docs/verification/2026-09-13-independent-streetengine-scale.jsonl`, Workflow `34763667410`.

| Houses | Ergebnis | Steps | max Statements | returned Rows | geschätzte Reads | Writes | Source Bytes | Edge Reads | Edge Bytes | gesampelter Heap |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | ready | 6 | 27 | 58 | 68 | 67 | 3,185 | 2 | 25,738 | 24,382,904 |
| 399 | ready | 7 | 27 | 66 | 78 | 136 | 108,609 | 3 | 38,607 | 29,529,664 |
| 1,000 | ready | 9 | 27 | 76 | 88 | 152 | 266,664 | 5 | 64,345 | 44,514,656 |
| 5,000 | ready | 25 | 33 | 163 | 181 | 315 | 1,326,524 | 21 | 270,249 | 81,627,080 |
| 10,000 | ready | 45 | 40 | 270 | 294 | 534 | 2,651,604 | 41 | 527,629 | 119,592,416 |
| 20,000 | FAIL `house_assignment_budget` | 6 | 20 | 33 | 109 | 90 | 5,313,268 | 0 | 0 | 132,387,904 |

Statements, returned rows, geschätzte Reads, Bytes, CPU und Writes bleiben getrennt. Diese Werte sind SQLite-/Node-Evidence, keine Cloudflare-Billing-Evidence.

## Architektururteil zu ADR-0031

Die neue Evidence widerlegt die server-first-Entscheidung nicht. Im Gegenteil: Der offene Kostenpfad entsteht durch den Datenfluss des unveränderten Graphen, nicht dadurch, dass der Server an sich der falsche Rechenort wäre. On-device würde D1-Publish/Verifikation nicht automatisch eliminieren und zusätzlich Upload, untrusted Input, Akku/RAM und Resume-Probleme einführen. ADR-0031 bleibt für den nächsten Fix der sinnvollere Weg: server-first, begrenzter Graphcache/Partitionierung, Operator nur nach echtem Gesamtbenchmark.

Die neue Heap-Evidence ist aber ein Warnsignal: 10k liegt im Node-Sample bereits hoch. Ein Operator-/Hybrid-Pivot darf erst nach echten Worker-/DO-Profilen gegen denselben Fixturevertrag neu bewertet werden.

## BLOCKED, nicht bestanden

- Kein echtes iPad/iPhone/Android, kein echter WebGL-/MapLibre-Pixelnachweis. Sichtbare Punkte, weißer Rand, Touchziele, Resize/minimale Sheetgröße und HUD-Regressionen bleiben Geräteabnahme. `SMART_MARKING_DEVICE=BLOCKED`, `MAP_RENDER_P0=OPEN`.
- Kein neues Staging-Deployment dieses Smart-Commits, keine exakte `/api/runtime`-Zuordnung zu einer aktuellen Testausführung, kein real erfolgreicher Preparation-Job auf dieser Runtime.
- Kein sanitisiertes reales Buildings-cursor-0-Jobobjekt mit Deployment-SHA und Zeitbeleg.
- Keine Cloudflare-`meta.rows_read`-/Analytics-Evidence für die gemeldeten ungefähr 4,5 Mio. `D1_ATTRIBUTION_CONFIRMED=FALSE`.
- Kein echter Zweitclient-/Reload-/Offline-Reconnect-/Delete-Nachweis auf Staging für `4c2d01e...`.

Deshalb bleibt `STREET_ENGINE_LIVE_READY=FALSE`, selbst wenn der Queue-P1 lokal behoben würde.

## Nächster kleinster notwendiger Schritt

Zuerst **nur den FIFO-P1 in `networkIntentQueue.ts` beheben** und den unabhängigen roten Repro unverändert grün machen. Danach normale CI vollständig grün abwarten. Nicht gleichzeitig 20k, Renderer oder Collection umbauen.

Erst danach ist der nächste StreetEngine-Schritt P3: Edge-Rereads reduzieren und denselben 0/399/1k/5k/10k/20k-Workflow erneut ausführen. Die 20k-Grenze erst anheben, wenn der vollständige 20k-Run inklusive Publish/Sync/Heap besteht.

Für LIVE_READY bleibt anschließend separat die kleine exakt SHA-zugeordnete Staging-/Geräteabnahme nötig.
