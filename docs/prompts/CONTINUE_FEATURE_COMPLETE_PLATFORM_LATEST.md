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

## Zuletzt verifizierter FC5.1-Code-Checkpoint

Vor diesem Living-Docs-Commit:

- Branch `plan-feature-complete-platform`;
- PR #72 `FC0-FC2: Platform, Live Field Groups and Field Sessions`;
- Base `ui-app-launcher-sheet`;
- FC5.1-Code-Head `3a5c46aafa47e866b8441a380f34918eda1f0cee`;
- PR offen, Draft, mergeable, nicht gemerged;
- CI #729 auf exakt diesem FC5.1-Code-Head vollständig grün mit Test, Typecheck, Dependency Audit und Production Build.

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
- Plan 020 Smart House Runtime;
- FC5.1 Collection Access, Areas und Runs mit Collection-only QR, Main/Child Areas, Runs, Mehrgeräte-Join, manueller Release-Logik und Admin force release.

Smart Street/House verwenden App-eigene IDs. OSM bleibt Datenquelle/Provenance. Workbench-/Mock-Daten sind kein normaler Produktweg.

## Read-/Schema-Hardening 2026-08-30

Ein kleiner Read-/Schema-Hardening-Slice wurde auf PR #72 umgesetzt.

Verhalten:

- `Einsätze`, `Aktivität` und `Automationen` unterscheiden jetzt Loading, echten Empty-State, Fehler und vorhandene Daten über `src/collaboration/remoteReadState.ts`;
- ein initialer Schema-, Access- oder Netzwerkfehler mit null geladenen Einträgen darf nicht zusätzlich als „0 Einträge“ oder „noch nichts vorhanden“ erscheinen;
- bereits geladene Daten bleiben bei einem späteren transienten Fehler sichtbar;
- `CommentsContextPanel` behandelt `comments_schema_unavailable` als klaren Migration-0008-Rolloutzustand;
- der Kommentar-Composer bleibt bei einem initial fehlgeschlagenen Read fail-closed und erscheint erst wieder nach einem verwertbaren Read-Zustand;
- kein Backend-Erfolg wird simuliert, keine Migration wird als Diagnose angewendet.

Tests:

- `tests/remoteReadState.test.ts` simuliert Loading, Error, Empty, Data, Refresh mit vorhandenen Daten und transienten Fehler mit vorhandenen Daten;
- `tests/schemaReadHardening.test.ts` simuliert fehlende Migration 0008 mit Fake-D1 und prüft den spezifischen `503 comments_schema_unavailable`-Vertrag;
- derselbe Test schützt die Produktionsverdrahtung der Read-heavy UI-Module;
- vorhandene Tests simulieren bereits fehlende 0006-Spalten für Field Groups, fehlende 0007-Tabellen für Field Sessions und eine SQLite-DB ohne Migration 0009 für Automationen;
- vorhandene Smart-Street-/House-Persistenztests schützen 0004/0005 mit `schema_migration_required` und ohne Revision-Claim.

CI #729 ist auf exakt `3a5c46aafa47e866b8441a380f34918eda1f0cee` mit Test, Typecheck, Dependency Audit und Production Build grün.

Für diesen Slice war keine neue Architekturentscheidung und keine neue Context-Graph-Topologie nötig. Die bestehenden Knoten `plan-smart-house-runtime`, `collaboration`, `data`, `offline-sync`, `security`, `ux` und `quality` decken Preview-/Schema-Gate-Hardening bereits ab.

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

Status: implementiert und auf CI #729 verifiziert. Migration 0010 ist vorbereitet, aber nicht remote angewendet.


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
- 0009 Automation-Konfiguration;
- 0010 Collection Access, Main/Child Areas, Runs, Collector-Sessions und Claim-Historie.

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

Als nächster sicherer Runtime-Slice soll **FC5.2 Pickup Tasks, Sonderadressen, Online-Adresssuche und Kommentare** umgesetzt werden.

Vor dem ersten irreversiblen Persistenz-Commit:
1. Repository/GitHub exakt neu verifizieren.
2. Den aktuellen Provider für OSM-basierte Online-Adresssuche gegen ToS, Rate Limits, Datenschutz, Attribution und Kosten prüfen.
3. Bestehende Collection-only Access-, Sheet-, MapLibre- und M5-Mechanik wiederverwenden.
4. Pickup ohne Distribution House, Pflicht-Koordinaten, Archivierung und getrennte App-ID sicherstellen.
5. Den normalen Flow Search -> Map-Fokus/Marker -> Pickup -> Status/Kommentar implementieren und testen.

Nach Abschluss Living Docs erneut aktualisieren, exakten neuen Head gegen GitHub prüfen und CI nur auf diesem Head als Nachweis verwenden.
