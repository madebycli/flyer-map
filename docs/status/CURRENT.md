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

Checkpoint A, Pickup Visibility Capability, und Checkpoint B, Pickup Composer / Sonderadress-Suche, sind technisch implementiert.

Letzter vollständig grüner FC5.2-B-Code-Checkpoint vor diesem Living-Docs-Commit:

```text
Head: c4b59b3d29967a850f1124188dfe37772f01dc00
CI: #768 success
```

CI #768 war auf exakt diesem Head grün mit Tests, Typecheck, Dependency Audit und Production Build.

Checkpoint A umgesetzt:
- additive vorbereitete Migration `0012_fc5_collection_pickup_visibility.sql` mit `can_view_pickups DEFAULT 1`;
- vier enge Collection-Pickup-Capabilities: View default true, Create/Edit/Assign default false;
- 0011-only bleibt rückwärtskompatibel und interpretiert vorhandene Collector-Sessions als `canViewPickups=true`;
- explizite View-Änderung ohne 0012 scheitert spezifisch mit `pickup_visibility_schema_unavailable`;
- Abschalten von View setzt die drei Write-Rechte atomar auf false;
- Worker prüft View zusätzlich für Pickup-Mutationen und Pickup-Suche;
- Collection Snapshot filtert Pickups serverseitig auf `[]`, wenn ein Collector kein View-Recht besitzt, ohne Areas oder Runs zu verstecken;
- normale Campaign-Admin-/Persistent-Access-Reads bleiben unverändert;
- Collector Access und Admin-Collector-Liste liefern alle vier Capability-Werte ohne Credential-Material;
- Collection Admin UI kann die vier Rechte pro Collector ändern.

Checkpoint B umgesetzt:
- normaler `Sonderadresse hinzufügen`-Composer ist in den Collection-Flow integriert;
- Search läuft über den bestehenden serverseitigen Geoapify-Worker-Pfad, Provider-Credentials bleiben aus dem Client heraus;
- Suche ist auf Collection Main Area begrenzt, Worker filtert Treffer zusätzlich gegen das echte Main-Area-Polygon;
- Bias-Priorität ist einmalig freigegebener Gerätestandort, sonst aktueller MapLibre-Kartenmittelpunkt;
- kein `watchPosition`, keine GPS-Historie und keine Pflicht-Location-Permission;
- deterministische Distanzberechnung, Sortierung und mobile Distanzanzeige sind vorhanden;
- Search nutzt Debounce, Abort alter Requests und Sequence-/Race-Schutz;
- Treffer-Auswahl fokussiert MapLibre ohne persistente Kameraänderung;
- manuelle Positionskorrektur nutzt die aktuelle Kartenmitte und speichert bei manueller Korrektur keine falsche externe Provenance;
- Composer speichert über den bestehenden Snapshot-zu-M5-Pickup-Mutationspfad und führt keine zweite Queue ein;
- Collector Add-Flow ist auf `canViewPickups && canCreatePickups` begrenzt, Worker bleibt authoritative;
- Checkpoint B führt bewusst noch keinen permanenten Pickup-Renderer, Assignment, persistente Pickup Comments, Pickup Stats oder Revert ein.

Noch offen aus FC5.2 / Plan 021:
- permanente Pickup MapLibre Layer und dauerhafte Kartenrepräsentation nach dem Composer;
- Assignment UI / Run- oder Collector-Zuweisung;
- persistente Pickup Comments über eine additive Forward Migration und bestehende Comment-Domain;
- Pickup Stats;
- Actor-Attribution, Highlight und gezieltes compensating Revert;
- reale Mobile-/Touch-Abnahme der Collection- und Pickup-Flows.

Der nächste Runtime-Slice muss wieder isoliert auf dem jeweils aktuellen grünen Head beginnen. Als einfachste sinnvolle Fortsetzung bietet sich die permanente Pickup-Darstellung im normalen MapLibre-/Collection-Read-Flow an. Assignment, Comments, Stats, Revert und FC5.3 dürfen nicht in denselben Renderer-Slice gestapelt werden.

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

1. Exakten aktuellen Branch-Head und CI verifizieren, einschließlich dieses Living-Docs-Commits.
2. Nur bei vollständig grüner CI den nächsten Runtime-Slice beginnen.
3. Permanente Pickup-Darstellung im normalen MapLibre-/Collection-Read-Flow als kleinsten nächsten Slice prüfen und planen.
4. App-eigene Pickup-ID, vorhandene Snapshot-Daten und feste MapLibre-Layer verwenden, keine zweite Kartenengine und keinen zweiten Datenpfad einführen.
5. View-Capability serverseitig beibehalten und keine versteckten Pickup-Daten über Map Properties, Stats oder Nebenpfade leaken.
6. Assignment, persistente Pickup Comments, Stats, Revert und FC5.3 nicht in denselben Renderer-Commit stapeln.
7. Den nächsten Runtime-Slice wieder separat committen und auf exakt diesem Head Tests, Typecheck, Audit und Production Build grün bekommen.
