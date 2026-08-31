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

Plan 017 bleibt die übergeordnete Delivery-Linie. Abgeschlossen sind Plan 018 House Polygon Renderer, Plan 019 Smart Street Runtime, Plan 020 Smart House Runtime und FC5.1 Collection Access, Areas und Runs. Plan 021 bleibt für FC5.2 und FC5.3 aktiv.

Weiter offen aus FC4 sind reale Android-Chromium- und iPhone-Safari-Abnahmen, Touch-Dichte und Dense-Mobile-Verhalten. Cloud-Browser ohne WebGL ersetzt diese Gates nicht.

## FC5.2 aktueller Stand

Checkpoint A Pickup Visibility, Checkpoint B Pickup Composer/Sonderadress-Suche und Checkpoint C permanente Pickup-MapLibre-Darstellung sind technisch implementiert.

Letzter vollständig grüner FC5.2-C-Code-Checkpoint vor diesem Living-Docs-Commit:

```text
Head: 70e72f58b1f48668362228e532f8253e8eeb377f
CI: #772 success
```

CI #772 ist auf exakt diesem Head grün mit Tests, Typecheck, Dependency Audit und Production Build.

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
- permanente Pickup-Darstellung nutzt `src/map/pickupRenderer.ts` mit einer festen GeoJSON-Source `vf-collection-pickups` und zwei festen Marker-/Selection-Layern;
- nur bereits autorisierte, serverseitig sichtbare Pickups gelangen in den Collector-Map-Flow;
- Feature-ID und Selection verwenden die app-eigene Pickup-ID;
- Map Properties enthalten nur `pickupId` und `status`, keine Adresse, Beschreibung, Actor-, Provider- oder OSM-Provenance;
- archivierte beziehungsweise ungültig positionierte Pickups werden nicht gerendert;
- Datenupdates und Selection-Updates sind getrennt;
- Browse-Hitbox bleibt MapLibre-basiert, kein DOM-Marker-Fallback;
- Dense-Test deckt 5.000 Pickup-Features bei fester Source-/Layer-Zahl ab;
- CI #771 war wegen eines zu breiten statischen `source`-Regex im Visibility-Test rot; der Test wurde auf die tatsächlich erzeugten GeoJSON-Properties umgestellt, CI #772 ist vollständig grün.

Noch offen aus FC5.2 / Plan 021:
- persistente Pickup Comments über eine additive Forward Migration und bestehende Comment-Domain;
- Assignment UI / Run- oder Collector-Zuweisung;
- Pickup Stats;
- Actor-Attribution, Highlight und gezieltes compensating Revert;
- reale Mobile-/Touch-Abnahme der Collection- und Pickup-Flows.

Nächster empfohlener isolierter Runtime-Slice: persistente Pickup Comments. Migration 0008 bleibt historisch unverändert; Pickup-Target-Support muss über eine neue additive Forward Migration plus Worker-Autorisierung erfolgen. Assignment, Stats, Revert und FC5.3 dürfen nicht in denselben Comment-Slice gestapelt werden.

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
- 0012 Pickup Visibility Capability.

Bekannte fehlende Schemas müssen spezifisch fail-closed behandelt werden. Keine Migration wird als Diagnosewerkzeug remote angewendet.

## Immediate next

1. Exakten aktuellen Branch-Head und CI einschließlich dieses Living-Docs-Commits verifizieren.
2. Nur bei vollständig grüner CI den nächsten Runtime-Slice beginnen.
3. Persistente Pickup Comments über eine neue additive Forward Migration und die bestehende Comment-Domain umsetzen.
4. Pickup-Target serverseitig gegen Campaign/Pickup-Existenz und Pickup-View-Scope autorisieren; keine UI-only-Berechtigung.
5. Migration 0008 nicht verändern und keine Remote-Migration anwenden.
6. Assignment, Pickup Stats, Revert und FC5.3 separat halten.
7. Den Comment-Slice wieder mit Tests, Typecheck, Audit und Production Build auf exakt einem Head grün abschließen.
