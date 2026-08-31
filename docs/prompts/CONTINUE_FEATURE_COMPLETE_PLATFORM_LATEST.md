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

Letzter vollständig grüner FC5.2-B-Code-Checkpoint vor dem anschließenden Living-Docs-Commit:

```text
Head: c4b59b3d29967a850f1124188dfe37772f01dc00
CI: #768 success
```

CI #768 war auf exakt diesem Head grün mit Tests, Typecheck, Dependency Audit und Production Build.

Wenn dieser Prompt selbst auf einem späteren Docs-Head liegt, muss dessen CI vor weiterer Runtime-Arbeit ebenfalls vollständig grün sein.

## Pflichtkontext

Lies vollständig:
1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`
4. `docs/plans/active/017-feature-complete-platform.md`
5. `docs/plans/active/021-collection-pickup-persistence.md`
6. `docs/product/ROADMAP.md`
7. `docs/product/UX.md`
8. `docs/architecture/DATA.md`
9. `docs/architecture/OFFLINE_SYNC.md`
10. `docs/architecture/SECURITY.md`
11. `docs/architecture/MAP.md`
12. relevante Collection-/Pickup-Domain-, Worker-, UI-, Map- und Testdateien.

Nutze `docs/context-map.yaml` als Routing-Graph und lade keine irrelevanten Dokumente nur aus Gewohnheit.

## FC5.2 Checkpoint A abgeschlossen

Pickup Visibility ist als enge serverseitige Collection-Capability umgesetzt:

```text
canViewPickups = true
canCreatePickups = false
canEditPickups = false
canAssignPickups = false
```

Verbindlich:
- 0011 wurde nicht historisch umgeschrieben;
- additive prepared-only Migration 0012 ergänzt `can_view_pickups DEFAULT 1`;
- 0011-only bedeutet für bestehende Collector-Sessions logisch View=true;
- explizite View-Änderung ohne 0012 liefert `pickup_visibility_schema_unavailable`;
- View=false filtert Pickup-Daten serverseitig aus dem Collection Snapshot;
- Areas/Runs bleiben unabhängig sichtbar;
- View=false blockiert Pickup Search/Write serverseitig, auch wenn Write-Flags inkonsistent wären;
- Admin kann vier Rechte pro Collector verwalten;
- keine generische Permission-Runtime wurde eingeführt.

## FC5.2 Checkpoint B abgeschlossen

Der normale Pickup Composer / Sonderadress-Flow ist umgesetzt und auf CI #768 vollständig grün.

Normaler Flow:

```text
+ / Sonderadresse hinzufügen
-> Search Sheet
-> Adresse eingeben
-> Worker-basierter Geoapify Search auf OSM-derived Daten
-> Treffer nach Main Area + Distanz
-> Treffer auswählen
-> MapLibre fokussiert Treffer
-> temporäre Composer-Position
-> Titel / Adresse / Beschreibung
-> Position optional per Finger/Maus über Kartenmitte korrigieren
-> speichern über bestehenden Snapshot-zu-M5-Pickup-Pfad
```

Verbindlich:
- Provider-Credentials bleiben ausschließlich serverseitig;
- Worker begrenzt Suche auf Collection Main Area und prüft Treffer zusätzlich gegen das echte Polygon;
- Bias-Priorität ist einmalig freigegebener Gerätestandort, sonst aktueller Kartenmittelpunkt;
- keine Pflicht-Permission, kein `watchPosition`, keine GPS-Historie;
- Distanz wird deterministisch berechnet, sortiert und angezeigt;
- Search nutzt Debounce, Abort und Race-/Sequence-Schutz;
- Treffer-Fokus verändert die persistente Kampagnenkamera nicht;
- manuelle Korrektur setzt externe Provenance auf `null`, statt einen falschen Geocoder-Treffer zu behaupten;
- Collector Add-Flow benötigt `canViewPickups && canCreatePickups`, Worker prüft Create authoritative;
- M5 bleibt die einzige Mutation Queue;
- kein permanenter Pickup-Layer, Assignment, persistenter Pickup-Comment, Pickup Stats oder Revert wurde in B gestapelt.

Remote D1 bleibt nur 0001 bis 0003 applied. 0010, 0011 und 0012 bleiben prepared only.

## Nächster isolierter FC5.2-Slice

Erst nach Verifikation eines vollständig grünen aktuellen Heads weiterbauen, einschließlich des Living-Docs-Heads dieses Prompts.

Die einfachste sinnvolle Fortsetzung ist die permanente Pickup-Darstellung im normalen Collection-/MapLibre-Read-Flow:

```text
canonical Collection Snapshot mit Pickups
-> View-Capability bereits serverseitig gefiltert
-> feste Pickup GeoJSON Source / feste Layer
-> Marker dauerhaft auf der normalen Karte
-> Auswahl/Fokus nutzt app-eigene Pickup-ID
-> keine externe ID als Domain-Identität
```

Ziele:
- nach erfolgreichem Composer-Save bleibt der Pickup als normaler Karteninhalt sichtbar;
- nur bereits im autorisierten Snapshot enthaltene Pickups rendern;
- app-eigene Pickup-ID als Feature-Identität verwenden;
- MapLibre 5.7.1 und bestehende feste Layer-/Source-Muster weiterverwenden;
- Map Properties minimal halten, keine Credential-, Actor-, Comment- oder unnötigen Provenance-Daten einbetten;
- leere/legacy Snapshots stabil als leere FeatureCollection behandeln;
- Datenupdates getrennt von Auswahl und Kamera halten;
- mobile Hit-Flächen und Dense-Data-Verhalten mit Tests absichern;
- keine zweite Kartenengine, kein DOM-Marker-Fallback als dauerhaften Renderer und keinen Preview-Pfad einführen.

Nicht in denselben Renderer-Slice stapeln:
- Assignment UI;
- persistente Pickup Comments;
- Pickup Stats;
- Actor-Attribution / Highlight / Revert;
- FC5.3 Collection Road Sections.

Wenn Repository-Abhängigkeiten zeigen, dass ein kleiner anderer FC5.2-Schritt zwingend vorher nötig ist, dokumentiere das explizit und halte den Slice trotzdem eng.

Nach dem nächsten Runtime-Slice wieder einen eigenen stabilen CI-Checkpoint herstellen und Living Docs nur auf den tatsächlich erreichten Stand aktualisieren.

## Globale Grenzen

- MapLibre 5.7.1 bleibt einzige Kartenengine.
- M5 bleibt einzige Mutation Queue.
- App-eigene IDs bleiben authoritative, OSM-/Geocoder-IDs nur Provenance.
- Worker bleibt Authorization Boundary.
- Keine Secrets im Client oder in Map Properties.
- Keine kontinuierliche GPS-Historie.
- Keine Remote-Migration.
- Kein manueller Deploy.
- Kein Merge oder Ready.
- Kein neuer Branch/PR.
