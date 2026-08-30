# Prompt: Continue Feature Complete Platform

Dieser Living Handoff gehört zur Plan-017-Linie. Repository, aktueller Branch-Head, PR und CI bleiben Source of Truth.

## Start für einen neuen Chat

```text
Du arbeitest weiter am GitHub-Projekt `madebycli/flyer-map`.

Lies zuerst vollständig:
1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`

Nutze danach den Context-Graph. Für den aktuellen Stand folge `prompt-latest-feature-complete` zu Plan 017, den abgeschlossenen FC4-Slices 018, 019 und 020 sowie dem aktiven Plan 021.

Für FC5 Collection/Pickup lade `plan-collection-pickup-persistence` und die dort verknüpften Data-, Offline-Sync-, Map-, Security-, Collaboration-, Live-Teams-, OSM- und Quality-Knoten.

Prüfe vor jeder Änderung den lokalen Working Tree und vergleiche ihn mit dem aktuellen Remote-Branch. Nichts blind resetten, verwerfen oder überschreiben.

Verifiziere danach Branch `plan-feature-complete-platform`, PR #72, Base/Head/Draft/Mergeability, den exakten aktuellen Head und CI auf genau diesem Head gegen GitHub.

Keine Migration remote anwenden, nicht explizit deployen, nicht mergen, PR #72 nicht Ready setzen und keinen neuen Branch oder PR erstellen.
```

## Zuletzt verifizierter Ausgangsstand

Vor diesem Planner-Update:

- Branch `plan-feature-complete-platform`;
- PR #72 `FC0-FC2: Platform, Live Field Groups and Field Sessions`;
- Base `ui-app-launcher-sheet`;
- Head `af417ff8ebb92d0e8b471feb1861089fc4795f13`;
- PR offen, Draft, mergeable, nicht gemerged;
- CI #713 auf exakt diesem Head vollständig grün.

Nach jedem neuen Dokumentations-/Runtime-Commit GitHub erneut prüfen. Ein älterer grüner CI-Lauf zählt nicht für einen neueren Head.

## Implementierter Feature-Stand

Umgesetzt:

- FC0 PlatformShell/App-Bridge, aktiver Teamkontext und Team-/Einsatz-Modul;
- Live Field Groups;
- durable Field Sessions;
- Comments;
- bounded Activity;
- serverseitige Stats;
- deterministische/idempotente Automation;
- redundante Launcher-Kachel `Karte` entfernt, X und Outside-Tap schließen weiter;
- Plan 018 House Polygon Renderer;
- Plan 019 Smart Street Runtime;
- Plan 020 Smart House Runtime.

Smart Street/House verwenden App-eigene IDs. OSM bleibt Datenquelle/Provenance. Workbench-/Mock-Daten sind kein normaler Produktweg.

## FC4 offene Acceptance

- `HOUSE_MIN_ZOOM = 15` bleibt Ausgangswert;
- reale Android-Chromium-Prüfung offen;
- reale iPhone-Safari-Prüfung offen;
- Touch-Dichte offen;
- Dense-Mobile-Verhalten offen;
- Cloud-Browser ohne WebGL ersetzt keine MapLibre-/Geräteabnahme.

## FC5 Architekturentscheidung

Plan 021: `docs/plans/active/021-collection-pickup-persistence.md`.

Master hat **Ansatz A: First-Class Collection/Pickup** festgelegt.

Ansatz B, Collection-State auf Distribution Tasks, ist verworfen.

Verbindlich:

- Collection und Distribution sind getrennte fachliche Datenwelten unter derselben Campaign/Aktion;
- eigene Collection Main Area;
- eigene innere Collection Areas, unabhängig von Distribution Areas;
- eigene Collection Runs/Fahrten;
- eigene Collection Road Sections;
- eigene Pickup Tasks;
- Distribution-Delete verändert Collection nicht;
- Collection-Archive/-Änderung verändert Distribution nicht;
- nur Campaign/Aktion-Delete darf beides gemeinsam entfernen;
- aus House/OSM übernommene Pickups kopieren Adresse/Geometrie als eigenen Snapshot;
- OSM IDs sind keine Collection-Primärschlüssel.

### Collection Access / QR

- freiwillige Helfer benötigen keinen vorher angelegten normalen Account;
- Campaign-spezifischer Collection-QR öffnet nur den Collection-Bereich;
- jedes Gerät erhält eine eigene temporäre, revocable Collector-Identität, z. B. `Nutzer 1`;
- kein Distribution-/Admin-/Organizations-Zugriff aus diesem QR;
- Admin/Operator kann einzelnen Collector-Zugang widerrufen;
- Worker bleibt authoritative Authorization Boundary.

### Collection Runs

- Helfer übernehmen je nach Fahrzeug/Kapazität eine oder mehrere Collection Areas;
- andere sehen claimed/in-progress und Fortschritt;
- weitere Geräte können über `Beitreten` derselben Fahrt beitreten;
- mehrere Geräte dürfen Fortschritt derselben Fahrt eintragen;
- kein automatisches Timeout;
- manueller `Verlassen`-/`Freigeben`-/`Abbrechen`-Flow;
- Admin/Operator kann zwangsweise freigeben/neu zuordnen.

### Main Area / Untergebiete

- Collection-Hauptgebiet als leichte graue Fläche;
- innere Areas mit eigener Farbe darüber, ohne sichtbare Grau-Farbmischung;
- Restfläche innerhalb des Hauptgebiets bleibt als unzugewiesen grau erkennbar;
- Areas dürfen größer/kleiner und völlig anders als Distribution Areas sein.

### Collection Road Sections

Eigene Statuswerte:

- `open` / Offen;
- `driven` / Abgefahren;
- `later` / Später;
- `unavailable` / Nicht befahrbar.

Nie als Status auf Distribution Streets speichern.

### Pickup / Sonderadresse

- Pickup kann ohne Distribution House existieren;
- Kartenposition ist Pflicht;
- Titel + Adresse + Beschreibung;
- bestehende Pickup-Statuswerte `open`, `collected`, `unavailable`, `needs-follow-up`;
- Comments auf Pickup-Kontext;
- Einzel-Pickups höchstens archivieren, nicht hart löschen;
- spätere Positions-/Adressänderung erlaubt, aber nachvollziehbar protokolliert.

### OSM Online-Adresssuche

Gewünschter Flow:

`Plus -> Search Sheet -> OSM-basierte Online-Suche -> Ergebnis auswählen -> Karte fokussiert + Marker -> Sonderadresse hinzufügen -> Titel/Adresse/Beschreibung -> speichern`

Rahmen:

- bestehendes Sheet-/Bottom-Sheet-Design wiederverwenden;
- auf Mobile Bottom Sheet, Desktop darf kompakter/zentriert sein;
- Resultate mit Entfernung;
- bevorzugt Search hart auf Collection-Hauptgebiet begrenzen;
- wenn Provider nur BBox/Proximity kann, Ergebnis zusätzlich gegen Hauptgebiet prüfen;
- einmalige Device Location darf Distanz-Ranking unterstützen;
- ohne Permission Map Center verwenden;
- keine GPS-Historie;
- manueller Karten-Tap/-Korrektur bleibt möglich;
- Provider vor Implementierung auf aktuelle ToS, Rate Limits, Datenschutz, Attribution und Kosten prüfen;
- öffentlichen Nominatim-Dienst nicht ungeprüft für Live-Autocomplete fest verdrahten.

### Sonderadressen und Rechte

Default für temporäre Collection-Helfer:

- sehen: `true`;
- erstellen: `false`;
- bearbeiten: `false`;
- zuweisen: `false`.

Admin/Operator kann diese Collection-spezifischen Rechte erweitern, ohne die spätere generische Permission-Runtime vorzuziehen.

### Actor Attribution / Admin Revert

Jede authoritative Collection-Änderung braucht einen Actor.

Admin/Operator soll:

- Beiträge eines Collectors highlighten/filtern;
- gezielt einzelne Änderungen auswählen;
- ausgewählte Änderungen über serverseitige compensating mutations zurücksetzen;
- Collector-Zugang widerrufen.

Kein lineares Undo und kein direktes Löschen der Audit-Historie.

## Empfohlene FC5-Slices

### FC5.1 Collection Access, Areas und Runs

Echter Produktflow:

`QR -> Collector -> offene Areas -> eine/mehrere übernehmen -> Run -> Beitreten -> Fortschritt -> manueller Leave/Release/Admin force release`

Keine Foundation-only UI. Persistenz, Worker-Auth, M5, Retry/Offline, Error States und Tests gehören dazu.

### FC5.2 Pickup Tasks, Sonderadressen, Suche, Kommentare

Echter Produktflow:

`Plus -> OSM Search -> Marker/Fokus -> Sonderadresse -> M5 -> Worker/D1 -> Karte/Liste -> Pickup Status/Kommentar`

### FC5.3 Road Sections, Stats, Attribution/Revert

Eigene Roads, getrennte Nenner, Collector Attribution, Highlight und gezieltes Revert.

## D1 / Rollout

Remote D1 bleibt dokumentiert nur 0001 bis 0003.

Vorbereitet, aber nicht remote angewendet:

- 0004 Smart Street provenance;
- 0005 House Tasks;
- 0006 Field Groups/Credentials/Memberships;
- 0007 Field Sessions/Domain Events;
- 0008 Comments;
- 0009 Automation-Konfiguration.

Vor neuen Collection-Migrationen zuerst das aktuelle Migrationsverzeichnis prüfen. Nichts remote anwenden.

## Sicherheits-/Kosten-Grenzen

- gleicher Worker;
- gleiche D1;
- gleiche M5 IndexedDB Queue;
- gleiche MapLibre Engine;
- keine zweite Datenbank/Queue/Map Engine;
- keine PWA/Service Worker/Background Sync;
- keine kontinuierliche GPS-Historie;
- keine neue allgemeine Identity-/Permission-Runtime;
- keine Secrets/Tokens in Client-Map-Properties oder Domain Events;
- temporäre Collection Credentials high entropy + revocable;
- OSM-Geocoder möglichst ohne neue Client-Dependency und mit kalkulierbaren niedrigen Kosten;
- externe Provider nur nach aktueller Policy-Prüfung.

## Nicht tun

- nichts mergen;
- PR #72 nicht Ready for Review setzen;
- keine Migration remote anwenden;
- keinen manuellen `wrangler deploy`;
- keinen neuen Branch oder PR;
- keinen Collection-State in Distribution Tasks einbauen;
- kein automatisches Area-Timeout;
- keine GPS-Routenhistorie;
- keine Preview-/Mock-Daten als Produktfeature;
- kein AI-/LLM-Routing.

## Nächster Auftrag

Als nächster sicherer Runtime-Slice soll **FC5.1 Collection Access, Areas und Runs** umgesetzt werden.

Vor dem ersten irreversiblen Persistenz-Commit:
1. Repository/GitHub exakt neu verifizieren.
2. Aktuellen Migrationsstand prüfen.
3. Bestehende Access-/Session-/Live-Field-Group-Mechanik vollständig lesen und wiederverwenden.
4. Falls noch kein akzeptierter ADR für First-Class Collection Access/Areas/Runs existiert, diesen dokumentieren, bevor das Schema festgeschrieben wird.
5. Dann den kompletten normalen FC5.1-Flow implementieren und testen.

Nach Abschluss Living Docs und Context Graph erneut aktualisieren, exakten neuen Head gegen GitHub prüfen und CI nur auf diesem Head als Nachweis verwenden.
