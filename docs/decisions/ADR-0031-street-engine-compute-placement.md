# ADR-0031: Rechenort und Orchestrierung der StreetEngine

Stand: 2026-09-12. Entscheidung für die nächste Implementierungsphase, keine 20k-/Live-Freigabe. Ergänzt ADR-0027/0029 und ersetzt keine Autorisierungs- oder Persistenzgrenze.

## Ziel und Evidenz

Ein verifiziertes Ergebnis je Area/Generation für alle Clients, bis perspektivisch 20.000 Houses. Normale Feldgeräte müssen die Erzeugung nicht selbst ausführen. [Audit](../status/STREET_ENGINE_MASTERPLAN_AUDIT.md) belegt: Area-Delete-Read-Fix vorhanden; 10k lokal erfolgreich; 20k durch 10k-Grenze blockiert; Edge-Rereads; beschädigte Buildings können falschen Erfolg erzeugen. D1 bleibt kanonisch, Browserdaten bleiben untrusted.

## Vier Varianten

A. Vollständig serverseitige Quelle, Normalisierung, Graph/House-Link, Verifikation und Publish; Client sendet Absicht und beobachtet den Job.

B. Ein normaler Client lädt/berechnet und lädt das Ergebnis hoch. Andere Clients konsumieren die veröffentlichte Generation. Das erfordert nicht Berechnung auf jedem Gerät, ist aber von einem gewöhnlichen Browser als Jobbesitzer abhängig.

C. Hybrid mit serverseitiger Basisverarbeitung; Client wählt/bearbeitet Absicht oder Kandidaten; Server validiert und veröffentlicht. Wenn der Client lediglich eine Area auswählt, ist das funktional A. Als echte zusätzliche Verarbeitungsstufe lohnt C nur bei einer notwendigen menschlichen Qualitätsentscheidung.

D. Ausdrücklich fähiges Admin-/Operatorgerät oder dedizierter Worker berechnet ein versioniertes Artefakt; Server prüft und veröffentlicht. Gewöhnliche iPads/iPhones/Androidgeräte laden nur das Ergebnis. Ein dedizierter Worker ist operativ ein weiterer Rechendienst und kein Beweis für Browser-Zuverlässigkeit.

## Gewichtete Matrix

Bewertung 1 schlecht, 5 gut. Gewichte summieren sich auf 100. Werte sind Architektururteile unter dem aktuellen Stack und fehlender Operator-Infrastruktur, keine Benchmarks. Jede Variante verwendet dieselbe chunkbasierte Persistenz. Deshalb unterscheiden sich D1-Wertungen wenig.

| Kriterium | Gewicht | A Server | B normaler Client | C Hybrid/Interaktion | D Operator |
|---|---:|---:|---:|---:|---:|
| D1-Reads/Writes | 15 | 3 | 3 | 3 | 3 |
| Worker-/DO-CPU, Laufzeit, Speicher, Kosten | 10 | 3 | 4 | 3 | 4 |
| Zeit bis ready | 8 | 3 | 3 | 2 | 4 |
| Zuverlässigkeit, Resume, Recovery | 15 | 5 | 2 | 4 | 4 |
| Datenvolumen, Upload, Sync | 8 | 5 | 2 | 3 | 3 |
| Offline und Reconnect | 6 | 4 | 3 | 3 | 4 |
| Determinismus, Hash, Reproduzierbarkeit | 8 | 5 | 3 | 4 | 5 |
| Sicherheit, Vertrauensgrenze, Manipulation | 10 | 5 | 2 | 4 | 3 |
| Gerätefähigkeit, Akku und Hintergrundbetrieb | 8 | 5 | 1 | 4 | 4 |
| OSM-Lizenz, Providerlast, Cache, Aktualität | 5 | 4 | 2 | 4 | 4 |
| Konvergenz, Rollback, Beobachtung, Betrieb | 7 | 5 | 2 | 3 | 3 |
| Gewichteter Gesamtwert / 5 | 100 | **4,23** | **2,49** | **3,38** | **3,68** |

## Entscheidung

**A beibehalten und gezielt vervollständigen. D als messwertabhängige Ausweichoption vorbereiten, aber derzeit nicht bauen.** Kein neuer Dienst, bezahlter Provider, WASM-/Native-Stack oder regionaler Datenbetrieb für den kleinen Diagnosefix.

On-device senkt D1-Reads nicht automatisch. Dieselben Basis-/Overlay-/Feed-Publishoperationen bleiben bestehen. Wer den Graph statt in D1 nur im Arbeitsspeicher hält, spart Staging-Rereads wegen des Datenflusses, nicht wegen der Hardwarekategorie. Derselbe Vorteil ist mit begrenztem serverseitigem Cache/Partitionierung erreichbar. Ein Upload ergänzt Parts, Integritätsprüfung, Idempotenz, Garbage Collection und möglichen Wiederholungsverkehr. Validiert der Server Topologie und House-Links vollständig erneut, wandert CPU zurück auf den Server.

D wird relevant, wenn echte Worker/DO-Profile nach begrenzter Verarbeitung CPU-/Speichergrenzen überschreiten oder ein regionales Quellartefakt ohnehin auf einem zuverlässigen Operator erzeugt wird. Dann zwei Implementierungen an derselben Fixture vergleichen: vollständiger Serverlauf gegen Operator-Artefakt inklusive Upload, serverseitiger Verifikation und Publish. Zielwert und Entscheidung erst nach Gesamtkosten/Fehlerquote, nicht nur schneller lokaler Graphberechnung. Wird D bei Zeit/CPU und Zuverlässigkeit um zwei Noten besser belegt, nähert sich seine Wertung A; die Matrix muss dann aktualisiert werden.

## Ablauf und Zuständigkeit

1. Client erzeugt eine lokale Area-Absicht. Offline darf diese als Entwurf/Mutation warten; kein unbestätigter globaler Jobstart.
2. Server autorisiert Campaign/Area/Team und validiert Polygon/Revision. Gleicher Hash plus laufende Generation liefert denselben Job. Keine beliebigen URLs oder Overpass-Queries aus dem Browser.
3. Server erstellt/beansprucht Generation und Quellezeit und plant DO-Alarm. Client erhält Job-ID/Generation, Status und sichere Diagnoseversion.
4. DO lädt sequenzielle begrenzte Quellen oder passende Cacheversion, persistiert vollständige Schritte, validiert Graph/Buildings und erzeugt Chunks. Fortschritt über vorhandene Invalidation; sparsamer Statusfallback.
5. Geplante Pause setzt einen dauerhaften Wunsch unter Generation-Guard. Aktive Arbeit beendet höchstens den sicheren laufenden Checkpoint; danach kein weiterer Fetch. Eine sofortige Fetch-Unterbrechung braucht explicit Abort plus erneute Eigentümerprüfung. Aktuell fehlt diese API.
6. Resume autorisiert erneut, übernimmt dieselbe Generation nur bei gleichem Area-Hash und kompatibler Engine-/Cacheversion, setzt ausdrücklich nur den Retryzyklus zurück. Nichttransiente Qualitätsfehler brauchen neue Daten/Codeentscheidung, keine Endlosschleife.
7. Verifikation prüft vollständiges Manifest, Chunkhashes, eindeutige IDs, Parents/Area-Zugehörigkeit, Qualitätsstatus und erwartete Mengen. Publish aktualisiert Manifest, Overlay und Feed unter einem Revision-/Generationen-Guard. Alle Clients konsumieren dieselbe Version.
8. RxDB übernimmt Änderungen; GenerationVisibility zeigt erst die vollständige neue Kombination. Reload/Zweitclient/Offline-Delete müssen dieselbe Sicht ergeben.

Bei D bleibt **server-first** die sichere Standardorchestrierung: Server vergibt an einen angemeldeten Operator ein begrenztes Jobticket mit Area-Hash, Source-Snapshot, Engineversion, Grenzen und Ablaufzeit. Operator rechnet in Web Worker oder dediziertem Prozess und lädt nummerierte gehashte Parts resumierbar hoch. Server vertraut dem Hash nur als Integritätsnachweis, nicht als Beweis korrekter Topologie; er prüft die Daten fachlich oder akzeptiert ausschließlich einen gesondert vertrauenswürdigen Builddienst. Ein Web-Worker ist keine Sicherheitsgrenze.

**Client-first** ist sinnvoll für einen Offlineentwurf oder ein vorhandenes öffentliches Regionalartefakt. Vor Shared-Publish muss der Server den Scope und die Generation vergeben bzw. bestätigen. Unautorisierte Voll-Uploads sind keine Alternative zum Jobticket. Für A/C gibt es keinen Geometrieupload aus normalem Rechnen, nur die Nutzerabsicht.

## Geräte, Lizenz und Kosten

Safari/iOS/Android benötigen eigene reale RAM-, Akku-, Storage-, Worker-/WASM- und Hintergrundtests. Kein Background-Sync/PWA/Service-Worker wird eingeführt; ADR-0006 bleibt. Für D nur explizit als fähig getestete, verfügbare Operatoren einsetzen, Feldgeräte niemals still zum Runner machen.

Öffentliche Overpass-Instanzen betreiben Lastbegrenzung und können Requests ablehnen. Ein zentraler Cache, sequenzielle Anfragen und begrenzte Retries bleiben nötig, auch wenn ein Operator rechnet. Betreiberregeln sind je Provider zu prüfen; Regeln einer Instanz sind keine Zusage für die aktuell konfigurierten Hosts. [Overpass-Betriebsmodell](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)

OSM-Attribution und ODbL gelten auch für abgeleitete/versionierte Daten. Datenlizenz und Softwarelizenz unterscheiden; keine Quellen-/Lizenzmetadaten beim Upload entfernen. [OSM Copyright](https://www.openstreetmap.org/copyright)

D1-Free nennt 5 Mio Reads und 100.000 Writes pro Tag; echte Kosten aus `meta.rows_read`, `meta.rows_written`, Storage und passendem Zeitraum, nicht aus Housezahl. Kontoplan/CPU nicht unterstellen. [D1-Preismodell](https://developers.cloudflare.com/d1/platform/pricing/)

## Rollback

Diagnose-/Qualitätsänderungen brauchen keine Migration. Vorheriger funktionaler Reader bleibt kompatibel, aber Rücknahme würde den belegten falschen Leer-Erfolg wieder zulassen. Keine stille Rücknahme dieser Invariante. Für späteren 20k-/Operator-Pivot additive Job-/Manifestversionen; alte sichtbare Generation bis vollständigem Publish behalten, nie einen inkompatiblen Legacyreader auf chunk-only Daten ausrollen.
