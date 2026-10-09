# Auftrag an eine unabhängige KI: StreetEngine und Smart Marking kritisch prüfen

Du bist eine unabhängige prüfende KI für Master. Du hast diese Implementierung nicht geschrieben. Führe die Prüfung in einem frischen Kontext und einem eigenen Checkout durch. Übernimm keine Schlussfolgerung der implementierenden KI ungeprüft. Bestehende Tests, CI und Dokumente sind Hinweise, keine unabhängige Abnahme.

Master hat angeordnet, dass die weitere Test- und Abnahmearbeit von einer anderen KI durchgeführt wird. Deine Aufgabe ist, selbst zu testen und einen belastbaren Befund abzuliefern. Ein weiterer Testplan allein genügt nicht. Verändere während der Erstprüfung keinen Produktcode, um einen Fehler grün zu bekommen. Sichere Fehler zunächst mit einem minimalen unabhängigen Gegenbeispiel. Schreibe klar und sprich den Auftraggeber mit Master an.

## 1. Aktuellen Stand selbst feststellen

Repository: https://github.com/madebycli/flyer-map

Bekannte Orientierung, keine Annahme über den inzwischen aktuellen HEAD:

- Draft PR92: https://github.com/madebycli/flyer-map/pull/92
- Branch: `fix/street-engine-smart-marking`
- Zu prüfender Smart-Marking-Implementierungscommit: `4c2d01e2a0a873c9c233e525e50f20148c648bda`
- Vorheriger Quellqualitätsfix: `3ad3fc755bbdcfa03a1b1110312a0f3ab198af31`
- Vergleichsbasis vor den Masterplan-Fixes: `b126e70899ad5a5c206d8c3ed0fa1fe7b34766fe`
- Dokumentationscheckpoint nach dem Smart-Fix: `f65016076128a3e142c0a6e330321a20fbbd2d49`
- Zuletzt bestätigte PR-Base: `integration/main-street-runtime@f4facd6ef354c5ba6de861519b696bce6f46a209`
- Berichtete Smart-CI: https://github.com/madebycli/flyer-map/actions/runs/34761931839, Job `103736181142`, laut Implementierer 894/894 Tests plus Typecheck, Audit und Build grün. Prüfe SHA, Status und Logs selbst.

Lies zuerst den aktuellen Remote-HEAD, PR-Zustand, Base und den Diff seit dem genannten Implementierungscommit. Friere deine tatsächliche Prüf-SHA ein. Ist der Branch inzwischen verändert, trenne die Prüfung des genannten Kandidaten von späteren Änderungen. Teste nicht unbemerkt einen gemischten Stand. Erzeuge keine neuen Remoteänderungen, bevor du die Ausgangslage gesichert hast.

## 2. Autoritativen Kontext gezielt laden

Lies `madebycli/master-context/REGISTRY.yaml` und bestätige ausschließlich den Eintrag `project_id: flyer-map`, `source_repo: madebycli/flyer-map`, `context_root: projects/flyer-map/`, `entrypoint: projects/flyer-map/INDEX.md`. Keine Geschwisterprojekte laden. Keine Regeln aus einer fehlenden zentralen `.ai/CONTEXT.md` erfinden.

Lies den Projekteinstieg und die dort einschlägigen Primary Nodes. Im Code-Repository zuerst `AGENTS.md`, `docs/status/CURRENT.md`, `docs/context-map.yaml`; danach mindestens:

- `docs/status/STREET_ENGINE_MASTERPLAN_HANDOFF.md`
- `docs/status/STREET_ENGINE_MASTERPLAN_AUDIT.md`
- `docs/status/STREET_ENGINE_D1_AUDIT.md`
- `docs/plans/active/035-street-engine-masterplan.md`
- `docs/plans/active/036-smart-marking-waypoints.md`
- ADR-0027, ADR-0029, ADR-0030 und ADR-0031 im Verzeichnis `docs/decisions/`
- `docs/verification/2026-09-12-street-engine-d1-gate.md`
- `docs/verification/2026-09-13-smart-marking.md`
- Der vollständige ursprüngliche Masterauftrag mit Ergänzung unter `madebycli/master-context/prompts/flyer-map/2026-09-12-astra-streetengine-masterplan-with-smart-marking.md`.

Unterscheide neue aktuelle Einträge von überholten historischen Abschnitten. Bei Widersprüchen prüfe Code und akzeptierte fachliche Regeln und dokumentiere den Konflikt. Erkläre eine Forderung nicht bloß deshalb für erfüllt, weil die Implementierung ähnlich aussieht.

## 3. Grenzen und Unabhängigkeit

- Nutze einen isolierten lokalen Checkout oder eine eigene Prüfbranch. Keine Änderungen am Implementierungsbranch. Ein Test-/Evidence-Commit auf einer eigenen Branch und eine Draft-PR sind zulässig. Kein Merge oder Force-Push.
- Kein Production-Deploy, keine Remote-D1-Abfrage oder -Mutation, keine Remote-Migration, keine Secret-Änderung und kein bezahlter Anbieter. Keine realen Kampagnendaten oder Zugriffstokens in Artefakten.
- Synthetische lokale Fixtures und Provider-Mocks sind erlaubt. Keine 5k/10k/20k-Live-D1- oder Overpass-Tests. Für neue Staging-Ausführung, reale Quelle und Gerätezugang braucht es einen konkreten autorisierten Testzugang und ein klar benanntes kleines Budget. Falls dies fehlt, erledige alle lokalen Prüfungen und dokumentiere die externe Abnahme als BLOCKED.
- Kein Abholservice-Aufbau, keine Collection Areas/Runs/Rooms/Links, keine neue Collection-Aktionsart. Prüfe die fachliche Trennbarkeit, ohne Distribution-Objekte als Collection-Modell einzuführen.
- Testorakel unabhängig aus den Abnahmeregeln herleiten. Die zu prüfende Produktionsfunktion darf nicht ihre eigenen erwarteten Ergebnisse erzeugen. Mindestens für Intervallarithmetik ein einfaches unabhängiges Referenzmodell verwenden. Eigene Fixtures, Zufallsseeds und Gegenbeispiele dauerhaft sichern.
- Keine Behauptung von Geräte-/WebGL-/Billing-Evidence aus Quelltext, Mock, erfolgreichem HTTP oder grüner CI. Eine unabhängige KI-Prüfung ist ihrerseits kein realer Gerätetest.

## 4. Smart Marking aktiv versuchen zu widerlegen

### Punkte, Routen und Bedienung

Prüfe den echten React-Ablauf und, soweit möglich, einen echten Browser mit MapLibre. Unterscheide erfolgreiche GeoJSON-Zuweisung von tatsächlich sichtbaren Pixeln.

1. Punkt 1 ist sofort sichtbar. Punkt 2 bildet eine Route. Mindestens sechs Punkte bleiben als Start, Zwischenpunkte und Ende unterscheidbar, mit dem manuellen Punktstil und weißem Rand. Ein ungeklärter oder ungültiger Tipp bleibt nachvollziehbar, ohne Speichern zu erlauben.
2. Jeder benachbarte Punkt wird als eigenes Zwischenziel eingehalten. Verwende absichtliche Umwege, Rückläufe, Kurven, Kreuzungen, Kreisverkehr und denselben Straßenabschnitt in beiden Richtungen. Ein globaler kürzester A/B-Weg darf die Zwischenziele nicht ersetzen.
3. Mehrdeutigkeit pro Abschnitt verlangt eine verständliche Entscheidung. Frühere gewählte Abschnitte und alle Punkte bleiben erhalten. Teste Auswahl einer nicht ersten Alternative, folgenden Punkt, Undo und erneute Wahl. Prüfe, ob die alternative Route auf der Karte ausreichend verständlich erkennbar ist.
4. Undo entfernt nur den letzten Punkt beziehungsweise ungeklärten Tipp. Reset verwirft alles. Cancel schließt die Auswahl. Keine Statusänderung durch bloßen Kartentipp, abgebrochene Auswahl oder versehentlichen Doppelklick.
5. Prüfe maximal erlaubte Punkte/Arcs/Bytes, Budgetüberschreitung, fehlende Verbindung, doppelten Punkt, 0-Länge, Area-Wechsel, Rechte-/Scope-Wechsel und aktualisierte Snapshots während einer offenen Auswahl. Fehler müssen die vorherige Arbeit nachvollziehbar erhalten.
6. Prüfe Header, Punktezähler, Touchziele, kompakte/aufgeklappte Ansicht und die schon vorhandenen Area-Zeichen-/Edit-HUDs sowie den Kommentar-Toggle auf Regressionen. Ohne echtes Gerät bleiben die Geräteanforderungen offen.

### Exakte Abschnittssemantik

Verbindliches Beispiel, Straßenlänge 100 beliebige Längeneinheiten:

| Zustand | Abschnitte |
|---|---|
| Vorher | 0–10 erledigt; 10–20 offen; 20–40 später |
| Neue Nutzeraktion | 8–25 nicht zustellbar |
| Danach | 0–8 erledigt; 8–25 nicht zustellbar; 25–40 später |

Teste außerdem vollständig enthaltene und umfassende Überlappung, angrenzende Intervalle, mehrere vorhandene Status, umgekehrte Zeichenrichtung, Wiederöffnen, Zusammenführen gleicher Nachbarn, Endpunkte, kurze positive Abschnitte und numerische Toleranzen. Vergleiche zufällige Operationsfolgen mit einem unabhängigen Referenzmodell; bewahre fehlgeschlagene Seeds und minimale Repros auf.

Prüfe folgende Invarianten:

- Nur ausgewählte Positionen erhalten den neuen Status; nicht überlappte Arbeit bleibt identisch.
- Keine überlappenden oder unnötig fragmentierten gespeicherten Coverage-Intervalle.
- Ein Teilstück darf keinen vollständigen Straßenabschluss vortäuschen.
- Prozentwerte beruhen auf tatsächlicher Geometrielänge, nicht Vertexanzahl oder Straßenname.
- Karte, Straßen-Detailanzeige, Area-Anzeige und Statistik verwenden nachvollziehbare Datenstände. Hausfortschritt und Straßenabdeckung dürfen getrennte, klar benannte Bezugsgrößen sein. Prüfe insbesondere Wiederöffnen nach bereits erledigten Häusern und bewahre individuelle Hausausnahmen gemäß fachlichem Vertrag. Melde unklare fachliche Widersprüche, statt sie still zugunsten des Codes auszulegen.

### Persistenz, Offline, Replay und Konkurrenz

Prüfe Client-Queue, API und echte lokale Persistenz gemeinsam, nicht nur reine Hilfsfunktionen:

- Ein Mehrpunkt-Vorgang speichert alle Legs atomar in genau einer Nutzerabsicht. Ein Fehler während Feed-/Snapshot-Persistenz hinterlässt keinen Teilfortschritt.
- Offline markieren, Queue persistieren, Anwendung neu laden, online verbinden: gleiche Zwischenziele, Intervalle und Status.
- Verlorene Erfolgsantwort, Timeout nach Servercommit, erneuter Flush und gleichzeitige identische Requests: genau eine kanonische Anwendung und nachvollziehbare Historie.
- Zwei unterschiedliche Nutzeraktionen auf derselben Straße, einschließlich gleichzeitiger Requests und Statusänderung während offener Auswahl: keine stille Überschreibung fremder Arbeit. Prüfe auch nicht überlappende Änderungen und dokumentiere konservative Konflikte als Bedienungsgrenze.
- Geänderte Generation, geänderte Geometrie innerhalb einer Generation, veränderte Coverage, entfernter Straßenabschnitt, manipuliertes Zwischenziel/Pfad und neue Rechte: erwartetes Blockieren ohne Datenänderung.
- Alte bereits gespeicherte A/B-Intents müssen replayfähig bleiben; alte noch ungespeicherte Intents ohne Zustandsbeleg brauchen eine sichtbare Neuauswahl. Keine stille Queue-Löschung.
- Mehrere Offline-Aktionen nacheinander: Erwartungszustände passen zur sichtbaren Nutzerfolge; ein blockierter Vorgänger wird nicht unbemerkt übersprungen. Auch Verwerfen eines blockierten Eintrags prüfen.
- Optimistische Darstellung darf nicht als bestätigte gemeinsame Arbeit ausgegeben werden. Prüfe Scope-Isolation, Reload und unabhängigen Zweitclient.

## 5. Häuser, Quelle und Preparation

Prüfe den vollständigen Weg von Quelldaten über Kacheln/Cursor, Normalisierung, Adressfilter, Straßenzuordnung, Staging/Publish, Feed und RxDB bis zu Karten-/Listen-/Statistikdaten.

- Adresslose Gebäude, Garagen, Schuppen, Scheunen und Nebengebäude ohne verwertbare Hausadresse ergeben keine Hausaufgabe und zählen nirgends mit. Ein verwertbar adressiertes Nebengebäude ist separat von einem adresslosen Polygon zu bewerten. Eine reine Quellgeometrie ist keine Hausidentität.
- Direkte Gebäudeadresse, zugeordnete Address-Nodes, Boundary-Nodes, mehrere Adressen in einem Gebäude, bare Hausnummer, ungültige/fehlende Hausnummer, identische Kachel-Duplikate und widersprüchliche IDs prüfen. Konflikte dürfen nicht still durch die letzte Quelle entschieden werden. Prüfe die Grenzen der vorhandenen Direct-address-Priorität.
- Fehlerfälle am Buildings cursor0: null Nodes, fehlende Geometrie, offene Ringe, ungültige Koordinaten, gemischt gute/schlechte Buildings, ausschließlich beschädigte Buildings und echte leere Antwort.
- Providerfälle: HTTP429/5xx, HTML200, leere/abgeschnittene Response, JSON-remark, Bytebudget, Timeout/Abbruch, Retry/Fallback und Cache. Sichere Diagnose muss Phase, Cursor, Versuch und Fehlerkategorie erkennen lassen; Qualitätsverlust braucht Zähler und begrenzte Details. Keine Raw-Secrets oder unbegrenzte Responses.
- Keine partielle Generation veröffentlichen; alte gültige Generation während Fehler/Crash erhalten. Wiederholung, Leaseablauf, doppelter Start und neue Generation auf alte Arbeit prüfen.
- Behaupte keine exakte Ursache des gemeldeten realen Buildings-Abbruchs ohne passenden sanitisierten Job, Deployment-SHA und Zeitbeleg. Code-Repros beweisen eine Fehlerklasse, nicht die Identität des Livevorfalls.

## 6. D1-Gate und Skalierung mit klaren Grenzen

Verifiziere zunächst kurz den Prepared-Area-Delete-Pfad: kein vollständiger Campaign-House-/Task-Snapshot vor dem kompakten Delete. Prüfe vorbereitete und Legacy-Areas, Tombstones, Feed, Offline-Reconnect und Mehrclient-Konvergenz. Wenn die Invariante hält, kein erneutes großes Delete-Refactoring.

Der Implementierer berichtet einen separat offenen Link-Pfad mit wiederholtem Vollgraph-Read pro 250-House-Schritt. Verifiziere oder widerlege diesen Befund lokal. Unterscheide Statements, zurückgegebene Rows, geschätzte Reads, Bytes, CPU und Writes. Ohne Cloudflare-Metriken keine billable-rows-Behauptung und keine Zuordnung der gemeldeten etwa 4,5M Reads.

Führe reproduzierbare synthetische Größenprüfungen für 0, 399, 1k, 5k, 10k und 20k mit mehreren Straßen/Tiles durch, soweit die lokale Umgebung dies erlaubt. Nutze `scripts/street-masterplan-audit.ts` als Ausgangspunkt, prüfe dessen Messmodell und ergänze eigene Gegenfälle. Der bisherige Bericht sagt: 20k scheitert am aktuellen 10k-Limit. Ein erwartetes Ablehnen ist kein bestandener 20k-Kapazitätstest. Keine Konstante anheben, um die Abnahme künstlich zu bestehen.

Beurteile die Architekturentscheidung ADR-0031 kritisch anhand der gemessenen Grenzen. Client-/Operator-Compute spart nicht automatisch D1-Reads; Upload, Verifikation, Recompute, Akku/RAM und kalter Neustart gehören in den Vergleich. Keine neue Computeplattform bauen.

## 7. Standard-Gates und externe Evidence

Führe auf deiner eingefrorenen SHA mit dokumentierter Node-/Paketversion die regulären Tests, Projekt-Typecheck, Dependency Audit und Production Build aus. Erhalte Lockfile und gepinnte Rendererabhängigkeiten. Prüfe zusätzliche eigene Regressionen im isolierten Testbranch.

Bekannte Hinweise, die du selbst prüfen musst:

- Die Implementierer-Sandbox blockierte den RxDB-Zweitabtest mit Unix-Socket-EPERM und den nativen TypeScript7-Start wegen fehlendem `/proc/self/exe`.
- Ein TypeScript5.9.3-Gegencheck wurde dort grün berichtet; das ersetzt nicht still den Projekt-Typecheck.
- Der Dependency Audit enthält eine ausdrückliche bestehende Ausnahme für MapLibre5.7.1 / GHSA-jrc7-96c5-q579. Nicht als „keine Advisories“ berichten.
- Es gibt keine nachgewiesene neue Staging-/echte Geräte-/Live-Job-Abnahme dieses Smart-Commits.

Ändere keine Sicherheitseinstellungen, um Sandbox-Grenzen zu umgehen. Nutze reguläre CI oder eine autorisierte andere Testumgebung. Fehlende Umgebung ist BLOCKED, nicht PASS. Wenn bereits autorisiertes Staging vorhanden ist, ordne `/api/runtime`, Worker-Version und Testdaten der genauen SHA zu; ein beliebiger alter Preview-Link zählt nicht.

## 8. Verbindliche Ergebnisse

Sichere auf deiner eigenen Prüfbranch kleine nachvollziehbare Test-/Evidence-Commits. Nach jedem Commit Remote-HEAD und betroffene Dateien zurücklesen. Produktcode bleibt während der Erstprüfung unverändert. Berichte den exakten geprüften Produkt-SHA separat vom Testbranch-SHA.

Erstelle mindestens:

1. `docs/verification/2026-09-13-independent-streetengine-audit.md`: eigener Evidence-Freeze, Vorgehen, Testbefunde, Grenzen, Reproduktion und Urteil.
2. `docs/verification/2026-09-13-independent-streetengine-results.json`: strukturierte Ergebnisse mit Fall-ID, Kategorie, PASS/FAIL/BLOCKED, getesteter SHA, Umgebung, Befehl/Testname, beobachtetem und erwartetem Ergebnis sowie Artefaktverweis. Keine erfundenen Messwerte.
3. Eigene Regressionen/Fixtures einschließlich minimaler Repros für gefundene Fehler und Zufallsseeds.
4. Ein kurzes unabhängiges Handoff im registrierten `master-context/projects/flyer-map/`-Bereich, mit Links auf Prüfbranch/PR und Bericht. Füge keine unbelegte Produktionsfreigabe in den Projektstatus ein.

Jeder Fehlerbefund braucht Priorität P0/P1/P2, konkrete Auswirkung, Datei/Funktion, minimale Repro, erwartetes versus beobachtetes Verhalten und einen begrenzten Fixvorschlag. Trenne einen Produktfehler von einem Testproblem, einer Umgebungsgrenze und einer noch offenen Produktentscheidung.

Abschluss an Master: zuerst die unabhängigen Befunde, dann bestandene Prüfungen und offene Abnahme. Verwende mindestens diese Flags:

- `INDEPENDENT_AUDIT = PASS | FAIL | BLOCKED` für den ausdrücklich benannten Prüfumfang.
- `SMART_MARKING_LOCAL = PASS | FAIL | BLOCKED`
- `SMART_MARKING_DEVICE = PASS | FAIL | BLOCKED`
- `STREET_ENGINE_20K = PASS | FAIL | BLOCKED`
- `AREA_DELETE_READ_PATH = VERIFIED_FIXED | OPEN | UNVERIFIED`
- `D1_STATUS = VERIFIED_FIXED | OPEN | UNVERIFIED | NOT_RELEVANT`
- `D1_ATTRIBUTION_CONFIRMED = TRUE | FALSE`
- `MAP_RENDER_P0 = CLOSED | OPEN`
- `STREET_ENGINE_LIVE_READY = TRUE | FALSE`

LIVE_READY darf erst TRUE sein, wenn ein realer erfolgreicher Job, Reload, unabhängiger Zweitclient, sichtbar korrekte Area-/Street-/House-Geometrie und relevante Sync-/Delete-Flows auf exakt zugeordnetem Runtime-Stand nachgewiesen sind. Lokale PASS-Ergebnisse dürfen neben externen BLOCKED-Gates stehen. Benenne abschließend den nächsten kleinsten notwendigen Schritt.
