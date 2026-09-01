---
id: status-current
type: status
status: active
last_updated: 2026-09-01
---

# Current Project State

## Baseline

Verteil-Flyer bleibt eine mobile-first normale Website mit React, TypeScript, Vite, MapLibre GL JS 5.7.1, OpenFreeMap Bright, Cloudflare Workers und D1. M4 Access/Session und die resiliente M5 Mutation Queue bleiben die gemeinsame Grundlage. Keine native App, keine installierbare PWA, kein Service Worker, keine Background Sync API und keine kontinuierliche GPS-Historie.

Repository und GitHub sind Source of Truth. Aktiver Entwicklungsbranch ist `plan-feature-complete-platform`, Draft PR #72 läuft gegen `ui-app-launcher-sheet`. Nicht mergen, nicht Ready setzen, keinen neuen Branch/PR erstellen und keine Migration oder manuellen Deploy remote ausführen.

## M5 finaler Schreibvertrag

Der M5-Transition-Slice ist im Code umgesetzt:
- der Campaign-Snapshot bleibt Read Model, UI-Modell, Startup-Cache und Konflikt-/Sicherheitskopie;
- `POST /api/campaigns` ist ausschließlich der atomare Initial-Create mit Revision 0;
- Snapshot-GET und Version-GET bleiben erhalten, der Snapshot-PUT antwortet mit HTTP 410 `legacy_snapshot_write_retired` und schreibt nicht nach D1;
- `replaceCampaignSnapshot`, `putCampaignSnapshot` und automatische Legacy-Recovery sind entfernt;
- normale Campaign-, Team-, Area-, Street-, House-, Collection- und Pickup-Änderungen bleiben auf expliziten M5- oder spezialisierten Mutationen;
- bei leerer Queue bewahrt der Store einen abweichenden lokalen Zustand als Konfliktkopie, zeigt den kanonischen Serverzustand und macht den Konflikt sichtbar.

Die Repository-, HTTP- und statischen Guard-Tests decken den Insert-only-Create, den 410-Vertrag und das Fehlen des alten Snapshot-Write-Pfads ab. Der exakte Runtime-Head und CI-Checkpoint folgen nach Verifikation des korrigierten Branch-Heads.

## Feature-Complete-Linie

Plan 017 bleibt die übergeordnete Delivery-Linie. Abgeschlossen sind Plan 018 House Polygon Renderer, die historischen Smart-Runtimes aus Plan 019/020, Plan 023 Backend-Vorbereitung, Plan 024 normaler Preparation-UI-Flow, FC5.1 Collection Access/Areas/Runs und der vollständige FC5.2-Runtime-Scope. Plan 021 bleibt für FC5.3 sowie die noch offenen realen Geräte-/Touch-Gates aktiv.

Der Basemap-/Smart-Data-/UI-Hardening-Slice aus Plan 022 ist abgeschlossen: CARTO wurde vollständig durch OpenFreeMap Bright ersetzt, Provider-Extrusionen werden entfernt und die Karte bleibt 2D, Hausnummern sind standardmäßig größer aktiv, Smart Street/House sind online-first mit getrennten roads/buildings-Paketen und das vorbereitete Offline-Paket ist ausdrücklich optional. MapLibre Geolocate liefert live/refining Fixes und folgt im offiziellen Active-Lock, ohne GPS-Historie.

Plan 023 ergänzt den Backend-Pfad für serverseitig vorbereitete Distribution Areas: Nach einer erfolgreichen nicht wiederholten `area.create` oder `area.update-geometry` erzeugt ein Worker-Job aus begrenzten OSM-Daten atomar normale Street- und House-Tasks. Plan 024 integriert diesen Pfad in den normalen Area Sheet: fehlende Vorbereitung startet genau einmal, Pending pollt nur bei offenem Sheet, Ready refresht den normalen Snapshot, Failed hat einen autorisierten Retry und fehlendes 0014-Schema hat keinen Retry-Loop. Es gibt keine neue Task-Domain, keine browserseitige automatische OSM-Generierung und kein Massenvorbereiten alter Areas. Die additive Migration 0014 bleibt vorbereitet und nicht remote angewendet; bis zu einem ausdrücklich kontrollierten Rollout schlägt nur dieser neue Pfad fail-closed fehl.

Weiter offen aus FC4/FC5 sind reale Android-Chromium- und iPhone-Safari-Abnahmen, Touch-Dichte und Dense-Mobile-Verhalten. Cloud-Browser ohne WebGL und CI ersetzen diese Hardware-Gates nicht.

## Basemap, automatische Area-Vorbereitung und mobile Area-UI

- OpenFreeMap Bright wird als externer Style ohne API-Key/Secret geladen;
- `vf-basemap-housenumbers` verwendet den verifizierten Bright-Vertrag `openmaptiles` / `housenumber` mit Noto Sans ab Zoom 16 und zoom-skalierter größerer Beschriftung;
- Provider-`fill-extrusion`-Layer werden vor der App-Installation entfernt; Kartenpitch bleibt 0;
- normale Offline-/Area-/House-/Street-/Collection-Layer liegen unter Bright-Labels;
- Selection, Session Highlight, Pickup und Smart-Layer bleiben oberhalb der Basemap-Labels;
- App Sources/Layers werden einmal auf `style.load` installiert, Datenänderungen laufen weiter über getrennte `setData()`-/Filter-Syncs;
- der normale Area Sheet zeigt serverseitige Vorbereitung statt browserseitiger Smart-Auswahl: GET, einmaliges POST bei `missing`, Pending-Polling im offenen Sheet und genau ein Snapshot-Refresh bei `ready`;
- die bisherigen Smart-Street-/Smart-House-Buttons und per-Device OSM-Paket-Fetches haben keinen normalen Produkt-Einstieg mehr;
- Settings bietet keinen normalen Offline-Karten-Download mehr; M5-Mutation-Queue und lokaler Snapshot-Cache bleiben bestehen;
- der manuelle Fallback heißt `Straße manuell hinzufügen` und bleibt verfügbar;
- erledigte Street-/House-Features verwenden die reine um 25 Prozent abgedunkelte Teamfarbe bei hoher Opazität;
- Comment-Schema-, 401- und 403-Fehler zeigen keinen Retry, Netzwerk- und temporäre 5xx-Fehler schon;
- mobile Area-/Task-Sheets scrollen vertikal, blockieren horizontalen Overflow nicht und lassen lange Aktionen umbrechen.

Die automatische Suite schützt den neuen Layer-/Datenvertrag einschließlich Pickup-Renderer. Eine echte WebGL-/Android-/iPhone-Sichtprüfung wurde in diesem Slice nicht behauptet.

## Map-/Smart-Data-Hardening-Checkpoint

```text
Runtime-Head: 619cf690859ff21a4a8599f7762f38b0e27a013d
CI: #816 success
```

Der Bright-/Live-Follow-/Smart-Data-Fix ist auf diesem exakten Runtime-Head mit Tests, Typecheck, Dependency Audit und Production Build grün verifiziert. Der automatisierte Workers-Build-Check ist ebenfalls erfolgreich. Eine echte WebGL-/Android-/iPhone-Abnahme bleibt offen.

## FC5.2 verifizierter Runtime-Checkpoint

```text
Head: f9967033048cf03f2839cd41924cc1bd524a69c5
CI: #807 success
```

CI #807 ist auf exakt diesem Runtime-Code-Head grün mit Tests, Typecheck, Dependency Audit und Production Build.

FC5.2 umfasst jetzt als normale Produktwege:

### A. Pickup Visibility / Capabilities
- `canViewPickups=true` rückwärtskompatibel;
- Create/Edit/Assign default false;
- View=false filtert Pickups serverseitig und blockiert Pickup Search/Write;
- Collection Areas/Runs bleiben sichtbar;
- Admin verwaltet View/Create/Edit/Assign je Collector;
- keine generische Permission-Runtime.

### B. Sonderadress-Suche / Composer
- echter `Sonderadresse hinzufügen`-Composer für berechtigte Collector und Admin;
- Geoapify Address Autocomplete auf OSM-derived Daten ausschließlich hinter dem Worker;
- Provider-Credential bleibt serverseitig;
- Main-Area-Bounds plus authoritative Polygon-Filter;
- Bias durch einmaligen Gerätestandort oder MapLibre-Kartenmitte;
- Distanz, Debounce, Abort, Race-Schutz, Rate Limit und Timeout;
- sichtbare Geoapify-/OpenStreetMap-Attribution;
- Search-Treffer fokussieren MapLibre, manuelle Positionskorrektur bleibt möglich;
- keine kontinuierliche GPS-Historie.

### C. Permanenter Pickup-Renderer
- feste GeoJSON-Source `vf-collection-pickups` und feste Marker-/Selection-Layer;
- app-eigene Pickup-ID als Feature-/Selection-Identität;
- Map Properties nur `pickupId` und `status`;
- keine Adresse, Beschreibung, Actor-, Credential-, Provider- oder OSM-Provenance im Renderer;
- archivierte oder ungültig positionierte Pickups werden nicht gerendert;
- keine per-feature DOM Marker;
- Dense-Test mit 5.000 Pickups bei fester Source-/Layer-Zahl.

### D. Durable Pickup Comments
- bestehende Comment-Domain und `CommentsContextPanel` mit Target `pickup-task`;
- Forward Migration 0013 erweitert Comment/Event-CHECK-Verträge additiv;
- historische 0007/0008 bleiben unverändert;
- Bestandsdaten und betroffene Field-Group-Trigger werden beim SQLite-Rebuild erhalten;
- Worker prüft Campaign, Pickup-Existenz und Pickup-View authoritative;
- Collector Actor wird als `collection-collector` persistiert;
- Collector darf Pickup Comments erstellen, aber nicht selbst moderieren;
- fehlende 0013 fail-closed als `pickup_comments_schema_unavailable`.

### E. Pickup Assignment
- Admin und Collector verwenden denselben `PickupAssignmentEditor`;
- bestehender `collection.pickup.set-assignment`-Mutationsvertrag und dieselbe M5-Queue;
- Collector benötigt Pickup View + `can_assign_pickups`;
- nur aktive Runs beziehungsweise aktive/nicht widerrufene Collector-Kontexte;
- Worker validiert Referenzen authoritative und stale Revisionen konfliktieren ohne Teilzustand.

### F. Edit, Soft-Archive, Archivprüfung und vollständiger Admin-Flow
- berechtigte Collector können Titel, Adresse, Beschreibung und Kartenposition aktiver Pickups bearbeiten;
- Save ohne fachliche Änderung erzeugt keine künstliche Mutation;
- Update/Status/Archive bleiben unter `can_edit_pickups` und dem bestehenden M5-Diff;
- Collector-optimistic Writes setzen den tatsächlichen `collection-collector` Actor;
- einzelne Pickups werden niemals hart gelöscht, sondern über `collection.pickup.archive` soft archiviert;
- archivierte Pickups verschwinden aus aktivem Map-/Listen-Work, bleiben jedoch über die Archivprüfung inklusive Comments kontrollierbar;
- `CollectionAdminPickupWorkspace` gibt Admin denselben realen Geoapify/Search-/MapLibre-/Composer-Pfad für Create, Status, Comments, Edit und Archive;
- bestehender Admin-Assignment-Editor bleibt für Run-/Collector-Zuweisung zuständig;
- Admin- und Collector-Writes laufen weiter über `onSnapshotChange`/`commitSnapshot` und damit über die gleiche M5-Queue;
- Regression `tests/pickupLifecycleUi.test.ts` deckt Lifecycle, Admin-Produktgraph und Archive/Update-Vertrag ab.

## Collection / Pickup Architekturgrenzen

Collection bleibt fachlich von Distribution getrennt. Distribution-Delete verändert Collection nicht und Collection-Archive/Edit verändert Distribution nicht. Nur Campaign-Delete darf beide Bereiche gemeinsam entfernen.

Pickup IDs sind app-eigene IDs. OSM-/Geoapify-Daten sind nur Datenquelle beziehungsweise Provenance. Worker bleibt authoritative Authorization Boundary. UI-Sichtbarkeit ist keine Sicherheitsgrenze. MapLibre bleibt einzige Kartenengine. M5 bleibt einzige Mutation Queue. Keine zweite Datenbank, Queue, Map-Engine oder generische Permission-Runtime nur für FC5.

## Migration State

Dokumentierter Remote-D1-Stand bleibt ausschließlich Migration 0001 bis 0003.

Prepared only und nicht remote angewendet:
- 0004 Smart Street provenance;
- 0005 House Tasks;
- 0006 Field Groups;
- 0007 Field Sessions / Domain Events;
- 0008 Comments;
- 0009 Automationen;
- 0010 Collection Access / Areas / Runs;
- 0011 Collection Pickups / Create-Edit-Assign Capabilities;
- 0012 Pickup Visibility Capability;
- 0013 Pickup Comments Forward Migration.
- 0014 automatische Area-Task-Vorbereitung.

Bekannte fehlende Schemas müssen spezifisch fail-closed behandelt werden. Keine Migration wird als Diagnosewerkzeug remote angewendet.

## Context Graph / Living Docs

`docs/context-map.yaml` routet den abgeschlossenen Basemap-/Smart-Data-/UI-Slice über Plan 022 zu Map, Offline Map, Smart Street/House, UX, Collaboration und Quality. Plan 023 und der abgeschlossene UI-Follow-up Plan 024 routen automatische Area-Vorbereitung zu Data, Offline Sync, Map, Security, Quality und ADR-0021. Die FC5-Topologie routet den abgeschlossenen FC5.2-Lifecycle weiterhin ausdrücklich zu FC5.3. Kein Slice führt eine zweite Persistenz-, Queue-, Karten- oder Berechtigungsdomäne ein.

## Noch offen / Next

1. Reale Android-Chromium-/iPhone-Safari-Abnahme für FC4/FC5 bleibt ein offenes Hardware-Gate, solange sie nicht tatsächlich durchgeführt wurde.
2. Nach einem ausdrücklich kontrollierten Migration-0014-Rollout kann ein separater Scope die Behandlung älterer editierbarer Distribution Areas entscheiden. Der normale automatische Area-Sheet-Status ist bereits umgesetzt.
3. Nächster neuer Runtime-Scope ist FC5.3: First-Class Collection Road Sections.
4. Danach getrennte Collection/Pickup Stats, Actor Attribution/Highlight und compensating Revert serverautorisiert umsetzen.
5. Vor jeder neuen Runtime-Änderung exakten GitHub-Head, PR #72 und CI erneut verifizieren.
6. Migrationen 0007/0008 nicht historisch verändern, keine Remote-Migration anwenden, keinen manuellen Deploy ausführen.
7. Kein Merge oder Ready-for-Review ohne expliziten Auftrag.
