# Continue Feature Complete Platform

Du arbeitest weiter am GitHub-Projekt `madebycli/flyer-map`.

Repository und GitHub sind die einzige Source of Truth. Prüfe vor jeder Änderung den aktuellen Branch, PR #72, exakten Head und CI. Verlasse dich nicht auf diesen Prompt, wenn GitHub inzwischen weiter ist.

## Aktiver Stack

```text
Branch: plan-feature-complete-platform
PR: #72
Base: ui-app-launcher-sheet
Draft: true
Merge: verboten
Ready: verboten
Remote Migration: verboten
Manueller Deploy: verboten
Neuer Branch/PR: verboten
```

Letzter vollständig grüner FC5.2-D-Code-Checkpoint vor den anschließenden Living-Docs-Commits:

```text
Head: 731724faa823aa3c2fa5b159559f513bd94b9b55
CI: #783 success
```

CI #783 war auf exakt diesem Head grün mit Tests, Typecheck, Dependency Audit und Production Build. Wenn dieser Prompt auf einem späteren Docs-Head liegt, muss dessen CI vor weiterer Runtime-Arbeit ebenfalls vollständig grün sein.

## Pflichtkontext

Lies zuerst `AGENTS.md`, `docs/status/CURRENT.md` und `docs/context-map.yaml`. Folge für FC5 dem Graph-Knoten `plan-collection-pickup-persistence` zu Plan 021, Roadmap, UX, Data, Offline Sync, Map, Security, Collaboration, Live Teams, Access/Session, Smart Task identity, Offline Map, Field Session Events und Quality. Lade weitere Dateien nur, wenn der aktuelle Slice sie benötigt.

Der bestehende Context Graph reicht für Checkpoint D bereits aus. `collaboration` lädt explizit für Pickup Comments. Keine neue Graph-Kante oder parallele FC5-Topologie nur für diesen Checkpoint hinzufügen.

## FC5.2 Checkpoint A: Pickup Visibility

Umgesetzt:
- `canViewPickups=true`, Create/Edit/Assign default false;
- additive prepared-only Migration 0012, 0011 wurde nicht historisch umgeschrieben;
- View=false filtert Pickup-Daten serverseitig und blockiert Search/Write;
- Areas/Runs bleiben sichtbar;
- Admin kann die vier engen Pickup-Rechte pro Collector verwalten;
- keine generische Permission-Runtime.

## FC5.2 Checkpoint B: Composer / Sonderadress-Suche

Umgesetzt:

```text
Sonderadresse hinzufügen
-> Search Sheet
-> Worker-basierter Geoapify Search auf OSM-derived Daten
-> Main-Area-/Distanzfilter
-> Treffer auswählen
-> MapLibre-Fokus
-> Titel / Adresse / Beschreibung / Pflichtposition
-> bestehender M5-Pickup-Mutationspfad
```

Verbindlich:
- API-Key ausschließlich serverseitig;
- Search nur bei autorisiertem Admin beziehungsweise Collection Collector mit View+Create;
- Main Area wird serverseitig geprüft und Ergebnisse zusätzlich gegen das Polygon gefiltert;
- einmalige Device Location darf Ranking unterstützen, sonst Map Center;
- kein `watchPosition`, keine GPS-Historie;
- Debounce, Abort und Race-Schutz;
- manuelle Positionskorrektur entfernt externe Provenance;
- sichtbare `Powered by Geoapify`- und `© OpenStreetMap contributors`-Attribution.

Provider-Audit 2026-08-31 gegen offizielle Geoapify-Dokumentation:
- Geocoding/Autocomplete wird in Credits abgerechnet, aktuell 1 Credit pro Request;
- Free-Plan nennt aktuell 3.000 Credits pro Tag;
- OSM-Attribution ist Pflicht;
- Geoapify-Attribution ist im Free-Plan Pflicht;
- Speichern von Geocoding-Ergebnissen ist zulässig, wenn erforderliche Attribution erhalten bleibt.

## FC5.2 Checkpoint C: permanenter Pickup-Renderer

Umgesetzt und auf CI #772 grün:
- feste GeoJSON-Source `vf-collection-pickups`;
- feste Marker- und Selection-Layer;
- app-eigene Pickup-ID als Feature- und Selection-Identität;
- nur serverseitig sichtbare Pickups gelangen in den Collector-Map-Flow;
- Map Properties nur `pickupId` und `status`;
- keine Adresse, Beschreibung, Actor-, Provider-, Credential- oder OSM-Provenance in Map Properties;
- archivierte/ungültig positionierte Pickups werden nicht gerendert;
- Daten- und Selection-Updates getrennt;
- MapLibre-Hitbox statt DOM-Marker;
- Dense-Test mit 5.000 Pickups bei konstanter Source-/Layer-Zahl.

CI #771 war ausschließlich wegen einer falschen statischen Test-Assertion rot, die das legitime Wort `source` im Renderer verboten hatte. Der Test prüft jetzt die tatsächlich erzeugten GeoJSON-Properties; CI #772 ist vollständig grün.

## FC5.2 Checkpoint D: persistente Pickup Comments

Umgesetzt und auf CI #783 grün.

Normaler Pfad:

```text
Pickup auswählen
-> bestehender CommentsContextPanel
-> target type pickup-task
-> bestehende Comment API
-> Worker prüft Campaign + Pickup-Existenz + Pickup-View-Scope
-> durable Comments + minimierte Domain Events
```

Schema/Persistenz:
- historische Migrationen 0007 und 0008 bleiben unverändert;
- neue prepared-only Forward Migration `0013_fc5_pickup_comments.sql` erweitert die bestehenden CHECK-Verträge um `pickup-task` und Actor `collection-collector`;
- SQLite kann die betroffenen CHECK-Constraints nicht in place erweitern, deshalb werden `comments` und `domain_events` strukturidentisch neu aufgebaut und vorhandene Zeilen 1:1 kopiert;
- die 0007-Trigger `trg_field_group_close_history` und `trg_field_group_expiry_history` schreiben in `domain_events`; 0013 entfernt nur diese beiden Trigger vor dem `domain_events`-Rebuild und stellt ihr bestehendes Verhalten danach identisch wieder her;
- andere Field-Group-Trigger bleiben unberührt;
- keine zweite Comment-Tabelle oder Collection-spezifische Comment-Persistenz.

Authorization:
- Pickup muss existieren und zur Route-Campaign gehören;
- Collection Collector benötigt Pickup View für Reads und Writes;
- `can_view_pickups=false` blockiert Comments auch dann, wenn andere Pickup-Write-Flags manipuliert wären;
- normale Campaign-Admin-Autorisierung bleibt authoritative;
- Collector wird als `collection-collector` Actor persistiert;
- Collector darf Pickup-Kommentare erstellen, aber nicht selbst moderieren;
- fehlende 0013 liefert spezifisch `503 pickup_comments_schema_unavailable`.

Privacy/Event-Grenzen:
- Comment-Text bleibt bounded und inert wie im bestehenden Runtime-Vertrag;
- keine Pickup-Credentials, Actor-Secrets oder Geoapify-/OSM-Provenance in Comment-Events;
- bestehende Comment-Event-Deduplizierung und Edit/Delete-Konfliktlogik bleiben erhalten.

Tests:
- 0008 ohne 0013 simuliert den spezifischen Schema-Gate-Fehler;
- echte In-Memory-SQLite-Migration prüft Bestandsdatenübernahme;
- Field-Group-Close-/Expiry-Trigger bleiben nach 0013 funktionsfähig;
- sichtbarer Collector kann durable Pickup-Kommentare erstellen/lesen;
- `view=false` blockiert Reads und Writes;
- fehlende Pickup-Targets fail-closed;
- Collector-Moderation bleibt verboten, Admin-Zugriff erlaubt;
- CI #782 fand den realen Trigger/Rebuild-Fehler;
- CI #783 ist nach dem gezielten Trigger-Fix vollständig grün.

## Nächster isolierter FC5.2-Slice

Pickup Assignment UI / Run- und Collector-Zuweisung.

Normaler Zielpfad:

```text
Pickup auswählen
-> Zuweisen
-> Collection Run und/oder erlaubten Collector-Kontext auswählen
-> bestehender collection.pickup.assign Mutationsvertrag
-> M5 Queue
-> Worker Authorization + Scope-Validierung
-> Snapshot/Map/List aktualisieren
```

Verbindlich:
- vorhandenen serverseitigen Pickup-Assign-Vertrag wiederverwenden, keinen zweiten Assignment-Backendpfad bauen;
- `can_assign_pickups` bleibt Collection-Collector-Capability und default false;
- normale Campaign-Admin-Autorisierung bleibt authoritative;
- Zuweisung muss Campaign-, Pickup-, Run-/Collector-Existenz und Collection-Scope serverseitig validieren;
- keine Distribution-Team-Zuweisung in Collection hinein erfinden;
- app-eigene IDs bleiben authoritative;
- UI darf keine Berechtigung vortäuschen, wenn der Worker ablehnt;
- Offline/Retry/Conflict muss über den bestehenden M5-Vertrag laufen;
- Assignment UI muss mobile-first in das bestehende Sheet-System passen;
- keine Pickup Stats, Collection Road Sections, Attribution/Highlight, compensating Revert oder FC5.3 in denselben Slice stapeln.

## Danach: FC5.3 separat

Plan 021 ordnet anschließend separat ein:
- eigene Collection Road Sections mit `open`, `driven`, `later`, `unavailable`;
- Fortschritt je Area/Run/Campaign;
- getrennte Pickup- und Road-Nenner;
- Actor Attribution und Highlight;
- gezieltes compensating Revert mit Revision-/Konfliktprüfung;
- reale Mobile-/Touch-Abnahme bleibt zusätzlich offen.

## Globale Grenzen

- MapLibre 5.7.1 bleibt einzige Kartenengine.
- M5 bleibt einzige Mutation Queue.
- App-eigene IDs bleiben authoritative, OSM-/Geocoder-IDs nur Provenance.
- Worker bleibt Authorization Boundary.
- Keine Secrets im Client oder in Map Properties.
- Keine kontinuierliche GPS-Historie.
- Remote D1 bleibt dokumentiert nur 0001 bis 0003 applied.
- 0004 bis 0013 bleiben prepared only.
- Migrationen 0007/0008 nicht historisch verändern.
- Keine Remote-Migration.
- Kein manueller Deploy.
- Kein Merge oder Ready.
- Kein neuer Branch/PR.
