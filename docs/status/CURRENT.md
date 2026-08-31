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

Plan 017 bleibt die übergeordnete Delivery-Linie. Abgeschlossen sind Plan 018 House Polygon Renderer, Plan 019 Smart Street Runtime, Plan 020 Smart House Runtime und FC5.1 Collection Access, Areas und Runs. Plan 021 bleibt für die noch offenen FC5.2- und FC5.3-Slices aktiv.

Weiter offen aus FC4 sind reale Android-Chromium- und iPhone-Safari-Abnahmen, Touch-Dichte und Dense-Mobile-Verhalten. Cloud-Browser ohne WebGL ersetzt diese Gates nicht.

## FC5.2 aktueller Stand

Checkpoint A Pickup Visibility, Checkpoint B Pickup Composer/Sonderadress-Suche, Checkpoint C permanente Pickup-MapLibre-Darstellung und Checkpoint D persistente Pickup Comments sind technisch implementiert.

Letzter vollständig grüner FC5.2-D-Code-Checkpoint vor diesem Living-Docs-Commit:

```text
Head: 731724faa823aa3c2fa5b159559f513bd94b9b55
CI: #783 success
```

CI #783 ist auf exakt diesem Head grün mit Tests, Typecheck, Dependency Audit und Production Build.

Checkpoint A:
- additive prepared-only Migration `0012_fc5_collection_pickup_visibility.sql` mit `can_view_pickups DEFAULT 1`;
- vier enge Collection-Pickup-Capabilities: View default true, Create/Edit/Assign default false;
- 0011-only bleibt rückwärtskompatibel und interpretiert vorhandene Collector-Sessions als `canViewPickups=true`;
- View=false setzt Write-Rechte serverseitig außer Kraft, filtert Pickups aus dem Collection Snapshot und blockiert Pickup Search/Write;
- Areas/Runs bleiben sichtbar;
- normale Campaign-Admin-/Persistent-Access-Reads bleiben unabhängig;
- Collection Admin UI kann die vier Rechte pro Collector ändern.

Checkpoint B:
- normaler `Sonderadresse hinzufügen`-Composer ist in den Collection-Flow integriert;
- Search läuft serverseitig über Geoapify auf OSM-derived Daten, Provider-Credentials bleiben aus dem Client heraus;
- Worker begrenzt Search auf Collection Main Area und filtert Treffer zusätzlich gegen das echte Polygon;
- Bias-Priorität: einmalig freigegebener Gerätestandort, sonst MapLibre-Kartenmittelpunkt;
- kein `watchPosition`, keine GPS-Historie und keine Pflicht-Location-Permission;
- deterministische Distanzberechnung, Sortierung, Debounce, Abort und Race-Schutz sind vorhanden;
- Search-Treffer fokussieren MapLibre ohne persistente Kameraänderung;
- manuelle Positionskorrektur speichert keine falsche externe Provenance;
- Composer speichert über den bestehenden Snapshot-zu-M5-Pickup-Mutationspfad;
- Geoapify- und OpenStreetMap-Attribution werden aus dem Worker geliefert und sichtbar im Composer gerendert.

Provider-Audit am 2026-08-31 gegen die offiziellen Geoapify-Seiten:
- Geocoding/Autocomplete ist für den verwendeten Flow vorgesehen;
- 1 Geocoding-/Autocomplete-Request entspricht aktuell 1 Credit;
- Free-Plan nennt aktuell 3.000 Credits pro Tag;
- OpenStreetMap-Attribution ist erforderlich;
- im Free-Plan ist zusätzlich Geoapify-Attribution erforderlich;
- Geoapify erlaubt das Speichern von Geocoding-Resultaten unter Beibehaltung der erforderlichen Attribution.

Checkpoint C:
- permanente Pickup-Darstellung nutzt `src/map/pickupRenderer.ts` mit einer festen GeoJSON-Source `vf-collection-pickups` und festen Marker-/Selection-Layern;
- nur bereits autorisierte, serverseitig sichtbare Pickups gelangen in den Collector-Map-Flow;
- Feature-ID und Selection verwenden die app-eigene Pickup-ID;
- Map Properties enthalten nur `pickupId` und `status`, keine Adresse, Beschreibung, Actor-, Provider- oder OSM-Provenance;
- archivierte beziehungsweise ungültig positionierte Pickups werden nicht gerendert;
- Datenupdates und Selection-Updates sind getrennt;
- Browse-Hitbox bleibt MapLibre-basiert, kein DOM-Marker-Fallback;
- Dense-Test deckt 5.000 Pickup-Features bei fester Source-/Layer-Zahl ab;
- CI #771 war wegen eines zu breiten statischen `source`-Regex im Visibility-Test rot; der Test wurde auf die tatsächlich erzeugten GeoJSON-Properties umgestellt, CI #772 war anschließend vollständig grün.

Checkpoint D:
- Pickup-Kommentare verwenden die bestehende durable Comment-Domain und den bestehenden `CommentsContextPanel`;
- persistenter Target-Typ ist `pickup-task`, keine zweite Collection-Comment-Tabelle und keine zweite Comment-UI;
- neue Forward Migration `0013_fc5_pickup_comments.sql` erweitert die SQLite-CHECK-Grenzen für `pickup-task` und Actor `collection-collector`, ohne historische Migration 0007 oder 0008 zu verändern;
- 0013 baut `comments` und `domain_events` strukturidentisch neu auf, kopiert Bestandsdaten und stellt die 0007 Field-Group-Close-/Expiry-Trigger nach dem `domain_events`-Rebuild wieder her;
- Worker autorisiert Campaign, Pickup-Existenz und Collection-Pickup-View serverseitig;
- Collector mit `can_view_pickups=false` darf Pickup-Kommentare weder lesen noch schreiben, auch wenn andere Write-Flags manipuliert wären;
- Collection Collector wird als eigener Comment-/Event-Actor `collection-collector` persistiert;
- Collector darf Pickup-Kommentare erstellen, aber nicht selbst moderieren; normale Campaign-Admin-Autorisierung bleibt authoritative;
- fehlende 0013 wird spezifisch als `503 pickup_comments_schema_unavailable` behandelt;
- Comment-Text bleibt im bestehenden bounded/inert Vertrag;
- Comment-Events enthalten keine Pickup-Credentials, Actor-Secrets oder Geocoder-/OSM-Provenance;
- echte In-Memory-SQLite-Tests decken 0008-ohne-0013, Datenübernahme, Trigger-Funktion, Collector-Actor, View=false, fehlende Targets und Moderationsgrenzen ab;
- CI #782 deckte einen realen SQLite-Rebuild-Fehler auf, weil bestehende 0007-Trigger während des `domain_events`-Rebuilds auf die temporär fehlende Tabelle zeigten; 0013 entfernt nur die beiden betroffenen Trigger vor dem Rebuild und stellt sie danach identisch wieder her;
- CI #783 ist nach diesem Fix vollständig grün.

Noch offen aus FC5.2 / Plan 021:
- echte Assignment UI für Pickup-Zuweisung an Collection Run beziehungsweise einen oder mehrere Collector-Kontexte;
- reale Mobile-/Touch-Abnahme der Collection- und Pickup-Flows.

FC5.3 bleibt separat:
- eigene Collection Road Sections;
- Collection/Pickup Stats mit getrennten Nennern;
- Actor-Attribution und Highlight;
- gezieltes compensating Revert mit Konfliktprüfung.

Nächster empfohlener isolierter Runtime-Slice: Pickup Assignment UI / Run- und Collector-Zuweisung. Der vorhandene serverseitige Assign-Mutationsvertrag und `can_assign_pickups` sollen verwendet werden. Stats, Road Sections, Highlight/Revert und FC5.3 dürfen nicht in denselben Slice gestapelt werden.

## Collection / Pickup Architekturgrenzen

Collection bleibt fachlich von Distribution getrennt. Distribution-Delete verändert Collection nicht und umgekehrt. Nur Campaign-Delete darf beide Bereiche gemeinsam entfernen. Pickup IDs sind app-eigene IDs, OSM/Geocoder-Daten sind nur Datenquelle beziehungsweise Provenance.

Worker bleibt authoritative Authorization Boundary. UI-Sichtbarkeit ist keine Sicherheitsgrenze. MapLibre bleibt einzige Kartenengine. M5 bleibt einzige Mutation Queue. Keine generische Permission-Runtime nur für FC5 einführen.

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

`docs/context-map.yaml` benötigt für diesen Checkpoint keine neue Topologie. Der vorhandene FC5-Knoten `plan-collection-pickup-persistence` routet bereits zu Collaboration, Data, Security, Offline Sync, Map und Quality; `collaboration` lädt explizit für Pickup Comments. Keine unnötige Graph-Duplikation hinzufügen.

## Immediate next

1. Exakten aktuellen Branch-Head und CI einschließlich dieses Living-Docs-Commits verifizieren.
2. Nur bei vollständig grüner CI den nächsten Runtime-Slice beginnen.
3. Pickup Assignment UI als isolierten FC5.2-Slice auf dem bestehenden serverseitigen Assign-Vertrag und `can_assign_pickups` aufbauen.
4. Zuweisungen serverseitig gegen Campaign, Pickup, Run/Collector-Scope und Capability validieren; keine UI-only-Berechtigung.
5. Migrationen 0008/0013 nicht historisch verändern und keine Remote-Migration anwenden.
6. Collection Road Sections, Stats, Attribution/Highlight, Revert und FC5.3 separat halten.
7. Den Assignment-Slice wieder mit Tests, Typecheck, Audit und Production Build auf exakt einem Head grün abschließen.
