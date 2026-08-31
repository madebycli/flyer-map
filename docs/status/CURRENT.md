---
id: status-current
type: status
status: active
last_updated: 2026-08-31
---

# Current Project State

## Baseline

Verteil-Flyer bleibt eine mobile-first normale Website mit React, TypeScript, Vite, MapLibre GL JS 5.7.1, Cloudflare Workers und D1. M4 Access/Session und die resiliente M5 Mutation Queue bleiben die gemeinsame Grundlage. Keine native App, keine installierbare PWA, kein Service Worker, keine Background Sync API und keine kontinuierliche GPS-Historie.

Repository und GitHub sind Source of Truth. Aktiver Entwicklungsbranch ist `plan-feature-complete-platform`, Draft PR #72 läuft gegen `ui-app-launcher-sheet`. Nicht mergen, nicht Ready setzen, keinen neuen Branch/PR erstellen und keine Migration oder manuellen Deploy remote ausführen.

## Feature-Complete-Linie

Plan 017 bleibt die übergeordnete Delivery-Linie. Abgeschlossen sind Plan 018 House Polygon Renderer, Plan 019 Smart Street Runtime, Plan 020 Smart House Runtime, FC5.1 Collection Access/Areas/Runs und der vollständige FC5.2-Runtime-Scope. Plan 021 bleibt für FC5.3 sowie die noch offenen realen Geräte-/Touch-Gates aktiv.

Weiter offen aus FC4/FC5 sind reale Android-Chromium- und iPhone-Safari-Abnahmen, Touch-Dichte und Dense-Mobile-Verhalten. Cloud-Browser ohne WebGL und CI ersetzen diese Hardware-Gates nicht.

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

Bekannte fehlende Schemas müssen spezifisch fail-closed behandelt werden. Keine Migration wird als Diagnosewerkzeug remote angewendet.

## Context Graph

`docs/context-map.yaml` benötigt für FC5.2 keine neue Topologie. Der vorhandene Knoten `plan-collection-pickup-persistence` routet bereits zu Roadmap, UX, Data, Offline Sync, Map, Security, Collaboration, Live Teams und Quality. Der Lifecycle-Abschluss führt keine neue Architekturdomäne ein.

## Noch offen / Immediate next

1. Living-Docs-Head nach den Abschlussdokumenten auf exakt seinem SHA durch CI verifizieren.
2. PR #72 offen, Draft, mergeable und unmerged halten.
3. Reale Android-Chromium-/iPhone-Safari-Abnahme für FC4/FC5 als offenes Hardware-Gate führen, solange sie nicht tatsächlich durchgeführt wurde.
4. Nächster neuer Runtime-Scope ist FC5.3: First-Class Collection Road Sections.
5. Danach getrennte Collection/Pickup Stats, Actor Attribution/Highlight und compensating Revert serverautorisiert umsetzen.
6. Migrationen 0007/0008 nicht historisch verändern, keine Remote-Migration anwenden, keinen manuellen Deploy ausführen.
7. Kein Merge oder Ready-for-Review ohne expliziten Auftrag.
