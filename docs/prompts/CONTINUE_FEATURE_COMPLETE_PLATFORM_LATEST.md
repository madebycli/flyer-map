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

Letzter vollständig grüner FC5.2-C-Code-Checkpoint vor dem anschließenden Living-Docs-Commit:

```text
Head: 70e72f58b1f48668362228e532f8253e8eeb377f
CI: #772 success
```

CI #772 war auf exakt diesem Head grün mit Tests, Typecheck, Dependency Audit und Production Build. Wenn dieser Prompt auf einem späteren Docs-Head liegt, muss dessen CI vor weiterer Runtime-Arbeit ebenfalls vollständig grün sein.

## Pflichtkontext

Lies zuerst `AGENTS.md`, `docs/status/CURRENT.md` und `docs/context-map.yaml`. Folge für FC5 dem Graph-Knoten `plan-collection-pickup-persistence` zu Plan 021, Roadmap, UX, Data, Offline Sync, Map, Security, Collaboration und Quality. Lade weitere Dateien nur, wenn der aktuelle Slice sie benötigt.

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

## Nächster isolierter FC5.2-Slice

Persistente Pickup Comments.

Normaler Zielpfad:

```text
Pickup auswählen
-> bestehender CommentsContextPanel / Comment API
-> target type pickup-task
-> Worker autorisiert Campaign + Pickup-Existenz + Pickup-View-Scope
-> neue additive Forward Migration
-> bestehende durable Comment-Persistenz und Events
```

Verbindlich:
- Migration 0008 bleibt unverändert historische Comments-Migration;
- Pickup-Target-Unterstützung nur durch neue additive Forward Migration;
- bestehende Comment-Domain wiederverwenden, keine zweite Comment-Tabelle oder zweite UI nur für Collection erfinden, sofern SQLite-Forward-Migration den bestehenden Vertrag sauber erweitern kann;
- Pickup muss existieren, im selben Campaign-Scope liegen und für den Collector sichtbar sein;
- Collector ohne Pickup-View darf weder Pickup-Kommentare lesen noch schreiben;
- normale Campaign-Admin-Autorisierung bleibt authoritative;
- Comment-Text bleibt inert/bounded wie im bestehenden Runtime-Vertrag;
- keine Pickup-Credentials, Actor-Secrets oder Geocoder-Provenance in Comment-Events leaken;
- fehlende neue Migration muss spezifisch fail-closed behandelt werden;
- Assignment, Pickup Stats, Revert und FC5.3 Collection Road Sections nicht in denselben Slice stapeln.

Wenn das bestehende Comments-Schema wegen SQLite-CHECK/FK-Semantik nicht sicher additiv erweitert werden kann, zuerst die kleinste sichere Forward-Migration bestimmen und durch echte In-Memory-SQLite-Migrationstests absichern. Historische Migrationen nicht editieren.

## Globale Grenzen

- MapLibre 5.7.1 bleibt einzige Kartenengine.
- M5 bleibt einzige Mutation Queue.
- App-eigene IDs bleiben authoritative, OSM-/Geocoder-IDs nur Provenance.
- Worker bleibt Authorization Boundary.
- Keine Secrets im Client oder in Map Properties.
- Keine kontinuierliche GPS-Historie.
- Remote D1 bleibt dokumentiert nur 0001 bis 0003 applied.
- 0004 bis 0012 bleiben prepared only.
- Keine Remote-Migration.
- Kein manueller Deploy.
- Kein Merge oder Ready.
- Kein neuer Branch/PR.
