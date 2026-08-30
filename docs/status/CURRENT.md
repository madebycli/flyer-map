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

Checkpoint A, Pickup Visibility Capability, ist technisch implementiert. Letzter vollständig grüner A-Code-Checkpoint vor diesem Living-Docs-Commit:

```text
Head: a8ae9a33dd478df459b450f4d0f25519302e9ae0
CI: #765 success
```

CI #765 war auf exakt diesem Head grün mit Tests, Typecheck, Dependency Audit und Production Build.

Umgesetzt:
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

Noch nicht als FC5.2-Produktflow abgeschlossen:
- Pickup Composer / Sonderadresse im normalen Admin- und Collector-Flow;
- Proximity-Sortierung und Distanzanzeige;
- Map-Center-Bias ohne Location-Permission und optionaler One-shot Location-Bias;
- Auswahl eines Search-Treffers mit Map-Fokus und temporärem Marker;
- manuelle Positionskorrektur im Composer;
- permanente Pickup MapLibre Layer;
- Assignment UI;
- persistente Pickup Comments;
- Pickup Stats und Revert/Attribution-Folgearbeit.

Der nächste erlaubte Slice ist Checkpoint B aus Plan 021: Pickup Composer und Sonderadress-Suche. Vor B muss der jeweils aktuelle Branch-Head gegen GitHub geprüft werden. Wenn ein Living-Docs-Commit den Head verschiebt, dessen CI muss ebenfalls vollständig grün sein.

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

1. Exakten aktuellen Branch-Head und CI verifizieren.
2. Nur bei vollständig grüner CI Checkpoint B beginnen.
3. Bestehenden Geoapify-Worker-Search weiterverwenden und keinen zweiten Providerpfad bauen.
4. Composer um Map-Center-Bias, optionalen One-shot Location-Bias, deterministische Distanzsortierung/-anzeige, Search-States, Map-Fokus und manuelle Positionskorrektur erweitern.
5. Checkpoint B separat committen und auf exakt diesem Head wieder Tests, Typecheck, Audit und Production Build grün bekommen.
6. Permanente Pickup MapLibre Layer, Assignment, Pickup Comments, Stats und FC5.3 nicht in denselben Composer-Commit stapeln.
