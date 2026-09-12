# PLAN: StreetEngine verlässlich bis 20.000 Houses

Stand 2026-09-12. Status: aktiv, Audit abgeschlossen, begrenzter Qualitätsfix als nächster Schritt. Keine Live-Freigabe.

## Ziel

Eine serverautoritativ erzeugte, vollständig verifizierte Generation pro Area für alle Clients, mit Fehlerdiagnose, Pause/Resume, Arbeitserhalt und nachgewiesener Skalierung. 20.000 Houses sind ein Abnahmeziel; der Freeze-Stand lehnt mehr als 10.000 ab.

## Anforderungen

- Website auf vorhandenen React/TypeScript/Vite/MapLibre-5.7.1-/RxDB-/Cloudflare-Worker-/DO-/D1-Verträgen. Keine neuen Dienste oder Paid-Upgrades.
- Gemeinsamer Area-Zeichen-/Edit-HUD, Undo/Cancel/Confirm, sichtbares Freigegeben und n/max, Bestätigen nur bei gültiger Geometrie. Vorhandene Implementierung nicht neu schreiben; tatsächliches Mobil-/Resize-Verhalten prüfen.
- Ein Kommentarbutton öffnet und schließt. Mindestgröße, Startposition, Snap, kompakter Zustand und Body-Scroll zusammen abnehmen.
- Fortschritt/Fehler müssen Phase, Cursor und klaren Grund zeigen. Beschädigte Quellen dürfen keinen stillen Leer-Erfolg erzeugen; begrenzte Qualitätsdaten dürfen keine Tokens/Rohantworten offenlegen.
- Shared-Publish atomar, keine doppelten IDs, keine stale Generation, stabile House-Parents. Nutzerstatus, manuelle Straßen/Häuser, Markierungen und Kommentare erhalten.
- Kein 20k-Live-D1-/Overpass-Test ohne Budget. Keine Merge-/Production-/Remote-Migrations-/Secret-Aktion.

## Architektur

[ADR-0031](../../decisions/ADR-0031-street-engine-compute-placement.md): Server-first, serverseitige Erzeugung und Publish. Ein Operator ist eine bedingte Alternative nach CPU-/Speicherevidence, keine zusätzliche jetzt zu bauende Plattform. [Audit](../../status/STREET_ENGINE_MASTERPLAN_AUDIT.md), [D1-Gate](../../verification/2026-09-12-street-engine-d1-gate.md), ADR-0027/0029 und registrierte flyer-map Primary Nodes sind die gezielten Quellen.

## Dateistruktur

| Bereich | Bestehende/geplante Dateien |
|---|---|
| Quellqualität und Fehler | `worker/streetNetwork/preparation.ts`, ggf. kleines `sourceDiagnostics.ts`, `sourceCache.ts` |
| Öffentlicher Status | `worker/areaTaskPreparation.ts`, `src/data/campaignApi.ts`, `src/map/useNetworkWorkspace.tsx` |
| Orchestrierung | `worker/areaTaskPreparationApi.ts`, `worker/streetNetwork/runner.ts`, `worker/campaignSyncDurableObject.ts` |
| Räumliche Arbeit/Publish | `worker/streetNetwork/geometry.ts`, `addresses.ts`, `baseStorage.ts`, `chunkPersistence.ts` |
| Sync/Map | `worker/rxdbSync.ts`, `rxdbChangeFeed.ts`, `src/data/rxdbMissionSync.ts`, `generationVisibility.ts`, `src/map/incrementalGeoJson.ts` |
| Regressionen | `tests/streetSourceQuality.test.ts`, bestehende Street-/D1-/Recovery-/Race-/Sync-/UI-Tests |
| Reproduzierbare Messung | `scripts/street-masterplan-audit.ts`, `docs/verification/2026-09-12-street-engine-baseline.json` |
| Dokumentation | dieses PLAN, ADR-0031, `STREET_ENGINE_MASTERPLAN_AUDIT.md`, `CURRENT.md`, `docs/context-map.yaml`; passende Master-Context-Nodes und `prompts/flyer-map/` |

## Umsetzungsschritte und Abnahme

### P0: Evidence-Freeze und D1-Gate, erledigt im Audit

Aktuellen PR92-Head und Base prüfen, Route/Registry verifizieren, Checkpoint auf GitHub zurücklesen. 38 vorhandene fokussierte Tests grün, exakte Baseline-CI grün. Prepared-Delete-Read-Pfad ist lokal behoben; D1 bleibt nur für reproduzierte Link-Rereads offen. Keine neue systemweite D1-Neuarchitektur.

### P1: Quellenqualität und Diagnose, unmittelbar umsetzbar

Zwei rote Regressionen liegen vor. Normalisierung unterscheidet fehlende/null Nodes, ungültige Koordinaten, offene Ringe und ungültige Polygone. Einzelne Ausfälle mit Zähler, Tile, begrenzter ID-/Grundliste und sichtbarem Qualitätsverlust erlauben; sobald eine Buildingantwort Objekte liefert, aber kein einziges vertrauenswürdig ist, bleibt die Generation fehlgeschlagen und unveröffentlicht. Eine nach erfolgreichem, geprüftem Quelllauf echte leere Antwort wird als leer gekennzeichnet.

HTTP-/Transport-/Timeout-/JSON-/remark-/Normalisierungsfehler getrennt erfassen. Metadaten begrenzen: Status, sichere Endpointkennung, Content-Type/Length, Bytes bis Abbruch, Dauer, Antworttyp, Abortzustand, Versuch, Phase/Cursor. Keine Raw-HTML-/remark-Texte mit möglichen Geheimnissen persistieren; remark-Grund kategorisieren. Fehleranzeige zeigt verständlichen Grund und bei Bedarf sicheren Diagnosecode. Erfolg mit übersprungenen Buildings sichtbar markieren. Cacheversion anheben, damit vorangegangene still unvollständige Cacheeinträge nicht erneut genutzt werden.

Tests: beide roten Fälle werden grün, gemischtes gutes/schlechtes Tile, echtes leeres Tile, null Payload/Elements, HTTP429/5xx, HTML200, leere/abgeschnittene Response, remark, Bytebudget, Timeout, Fallback mit sicherer Metadatenpersistenz, Cachewiederholung, keine Secrets. Danach Gesamtsuite, Typecheck, Audit, Build und exakte CI. Keine D1-Migration.

### P2: Pause/Resume und Retryzyklus

Aktuell existiert nur Fehlerfortsetzung; echtes Pausieren fehlt. Additiver, serverseitiger `paused`-/Pausewunsch-Vertrag mit Scope, Generation, Engineversion und Idempotenz. Vor Umsetzung bestehende Status-CHECK-Constraints prüfen und neue Migration nur vorbereiten. Pause während jeder Phase, Timeout nach Pause, Crash vor/nach Checkpoint, mehrfaches Resume und A/B/C-Generation testen. Ein frischer manueller Retry darf das Retrybudget eines erschöpften Jobs kontrolliert erneuern; mehrfaches Starten darf nicht laufende Leases zurücksetzen. Keine UI-Pause behaupten, die nur Polling stoppt.

Abnahme: Client schließen lässt unpausierten Job weiterlaufen; Pausieren verhindert folgende Arbeitsschritte; Neustart/Resume übernimmt denselben Cursor und erhält alte sichtbare Generation. Schema-/Konfigurationsfehler terminal diagnostizieren, kein Retry-Sturm.

### P3: 20k-Rechen-/Persistenzgrenzen

Zuerst den gemessenen Link-Graph-Reread beheben: begrenzter Generation-/Hash-Cache oder räumliche Edge-Partitionen gegen gleichen Cold-Restart-Lauf vergleichen. Ziel ist weniger Readbytes/Graphaufbau ohne falsche Zuordnungen und ohne D1 als Autorität abzulösen. Cacheverlust darf ausschließlich Laufzeit verschlechtern, nicht Ergebnis oder Resume.

Graph, Address-Normalisierung und Publish getrennt nach Heap/CPU/Bytes profilen. Komplexe Polygone, viele Straßen, überlappende Tiles und 20k mit mindestens zwei echten Fixture-Tiles. D1-Publishstatementzahl, JSON-Rowgrenzen, Feedbytes und atomare Sichtbarkeit müssen vor Grenzerhöhung bestehen. 10k-Limit erst dann als gemeinsame serverseitige Capability anheben. Keine alleinige Änderung einer Konstante.

Abnahme: 0/399/1k/5k/10k/20k bei warm/kalt; Quelle leer versus kaputt; keine Duplikate/Parents außerhalb Area; Default-Limits kontrolliert und verständlich; keine übergroßen Batches. Wenn Worker-/DO-Limits trotz begrenzter Verarbeitung überschritten werden, ADR-0031 D mit realem Operator-Benchmark einschließlich Uploadverifikation neu bewerten.

### P4: Datenintegrität und Sync

Reprepare nach Status/Label/Kommentar/manueller Geometrie, Expand/Shrink/Reexpand, widersprüchliche Address-Node-Duplikate und Relation-Quellen testen. Für entfernte bearbeitete Objekte explizites Archiv-/Wiederherstellungsmodell festlegen; Overlay allein enthält keine vollständige historische Geometrie.

Prüfen: Publish-Fehler vor/in/nach Batch, verlorene Antwort, gleicher Intent, Revisionrace; komplette Generation in RxDB bei unterschiedlichen Collection-Ankunftszeiten; Reload während Zwischenstand; prepared und Legacy Area löschen; kompakte Feedpages mit vielen Versionen derselben ID, Tombstones zuerst, Offline-Edit nach Delete, zweiter unabhängiger Client. Bei UI-Freigabe muss die Geometrie tatsächlich auf der Karte erscheinen, nicht nur in LocalStorage vorhanden sein.

### P5: Kleine Liveabnahme nach grüner CI

Kein Deploy als Ersatz für Diagnose. Zuerst den bestehenden fehlgeschlagenen Job und `/api/runtime`-Beleg zuordnen. Ein vorhandener Status-GET kann Arbeit planen; nicht unbewusst als billige Read-only-Probe aufrufen. Danach nur eine klar benannte kleine Test-Area und ausdrücklich passendes Budget, keine Last-Fixtures. Stagingcommit, CI und Worker-Version exakt zuordnen. Erst nach realem ready, Reload, Zweitclient, sichtbaren Area/Street/House-Geometrien, Offline-Reconnect und Delete-Konvergenz kann LIVE_READY neu bewertet werden.

## Mess-/Testplan

| Achse | Pflichtfälle | Messgrößen und Grenze |
|---|---|---|
| Größe | 0,399,1k,5k,10k,20k | Queries/Statements, returned rows, Schätzreads, logische/geschätzte Writes getrennt; keine Billingsimulation |
| Quelle | warm/kalt, zwei Tiles+, mehrere Straßen, Rate-limit, Timeout, HTML, remark, truncation, beschädigte Nodes | Requestanzahl inkl. Fehlversuche, Bytes, Timing, Cache-Hits, Qualitätszähler |
| Rechnen | pro Phase isolierter Prozess, komplexe Polygone | Node-/Worker-/DO-CPU getrennt, Heap/RSS soweit verfügbar, höchster einzelner Schritt |
| Persistenz | Chunklimit, Batchfehler, Leaseablauf, A/B/C, Reprepare | atomarer Publish, unveränderte alte Sicht, keine stale Stagingwrites |
| Sync/Delete | 20k vorbereitete und alte Areas, stale Offline-Edit, verlorene Antwort | Feedbytes/physische Seiten, Checkpointfortschritt, keine Wiederauferstehung |
| Geräte | echtes iPad Safari, iPhone, Android | sichtbare Geometrie, Touch/Resize/Undo, RAM/Akku/Reload/Reconnect, Zweitclient |

Bestehende vollständige DO-Budgetfixture muss weiterhin <=50 Statements pro Alarm bestehen; bevorzugtes Ziel mit Reserve <=40 erst als Ziel deklarieren, aktuelle 45 nicht als Fehler umdeuten. Sinkende Statementzahl allein reicht nicht: auch gesamte Bytes/Reads/CPU/Alarmanzahl ausweisen. 20k-Zielwerte für Laufzeit und akzeptable Qualitätsverluste sind noch nicht produktseitig festgelegt.

## Risiken und Rollback

P1 ist additiv in JSON-Metriken und benötigt keine Migration; neuer Cache-Namespace erzeugt anfangs Cachemisses. Nicht großflächig vorbefüllen. Qualitätsblock kann zuvor scheinbar erfolgreiche Areas korrekt stoppen, deshalb Ursache und betroffene IDs sichtbar machen. Ein unverändert bereits ready gespeicherter Altjob wird durch neue Codeversion nicht automatisch repariert; Versionierungs-/Invalidierungsentscheidung folgt vor Livefreigabe.

Spätere Pause-/Manifest-/Archivänderungen brauchen additive Migration, kompatible Leser und deaktivierbare Starts. Kein Löschen bestehender Tabellen als Rollback. Bekannte gute Generation beibehalten; alte Quelle/Hashes für reproduzierbare Wiederaufnahme aufbewahren. Keine Datenmigration remote in diesem Audit.

## Offene Fragen / UNKLAR:

- Exakte Livefehlerursache: sanitierter Job, Fehlerzeit, Quellantwort und Deployment fehlen.
- Cloudflare-Tarif, aktive Limits, billable Rows und Zuordnung der 4,5M fehlen.
- Akzeptable ready-Latenz, minimale Geräteklasse und zulässiger Qualitätsverlust sind noch zu definieren.
- Pause sofort abbrechen oder am sicheren Phasencheckpoint? Empfehlung: sicherer Checkpoint, UI sagt dies klar.
- Vollständigkeit von OSM-Relationen und House-Archiv/Kommentarerhalt benötigt konkrete Produktentscheidung und Regression.
- Reale Geräte, echte aktuelle MapLibre-Geometrie und unabhängiger Zweitclient sind nicht nachgewiesen.
- Kein Operatorgerät oder dedizierter Builddienst ist als verfügbar/fähig bestätigt.

## Stop-Regel und Status

P1 nach Beleg umsetzen; bei fehlender Liveursache keine Provider-/Timeout-/Graph-Umschreibung auf Verdacht. P2-P5 bleiben konkrete Folgephasen. `STREET_ENGINE_LIVE_READY=FALSE`, `D1_ATTRIBUTION_CONFIRMED=FALSE`, `MAP_RENDER_P0=OPEN`. Alle Checkpoints in GitHub sichern und zurücklesen; relevante Master-Context-Nodes nach tatsächlichen Ergebnissen aktualisieren.
