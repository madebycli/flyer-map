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

Letzter vollständig grüner FC5.2 Visibility-Code-Checkpoint vor dem anschließenden Living-Docs-Commit:

```text
Head: a8ae9a33dd478df459b450f4d0f25519302e9ae0
CI: #765 success
```

Wenn dieser Prompt selbst auf einem späteren Docs-Head liegt, muss dessen CI vor Runtime-Arbeit ebenfalls vollständig grün sein.

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
12. relevante Collection-/Pickup-Domain-, Worker-, UI- und Testdateien.

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

Remote D1 bleibt nur 0001 bis 0003 applied. 0010, 0011 und 0012 bleiben prepared only.

## Nächster Slice: FC5.2 Checkpoint B

Erst nach Verifikation eines vollständig grünen aktuellen Heads weiterbauen.

Ziel ist ausschließlich der normale Pickup Composer / Sonderadress-Flow:

```text
+ / Sonderadresse hinzufügen
-> Search Sheet
-> Adresse eingeben
-> Worker-basierter OSM-derived Search
-> Treffer mit Distanz
-> Treffer auswählen
-> MapLibre fokussiert Treffer
-> temporärer Marker
-> Titel / Adresse / Beschreibung
-> Position optional per Finger/Maus korrigieren
-> speichern über bestehenden M5-Pickup-Pfad
```

### Search Bias

Priorität:
1. einmalig freigegebener Gerätestandort, wenn vorhanden;
2. sonst aktueller MapLibre-Kartenmittelpunkt.

Keine Pflicht-Permission, kein `watchPosition`, keine GPS-Historie. Worker bekommt nur validierte bounded longitude/latitude-Werte.

### Distanz

Distanz zwischen Bias-Punkt und Treffer deterministisch berechnen, nach Nähe sortieren und mobil lesbar anzeigen, beispielsweise `84 m`, `320 m`, `1,4 km`, `12 km`.

### Main Area

Bestehende Worker-Grenze beibehalten: Provider-BBox/Proximity auf Collection Main Area und jeden Treffer zusätzlich gegen das echte Main-Area-Polygon prüfen. Kein offener Geocoder-Proxy und keine weltweite ungebremste Suche.

### UX

Bestehendes Sheet-System verwenden. Debounce, Abort alter Requests und Race-Schutz für out-of-order Responses. Loading, Empty, Network Error, Rate Limit, Provider Error, Permission Error und Schema Error getrennt behandeln. Kein Fehlerzustand gleichzeitig als `0 Treffer` darstellen.

Treffer-Auswahl fokussiert MapLibre und setzt nur einen temporären Marker, kein Auto-Save. Manuelle Positionskorrektur muss Touch und Maus unterstützen, nie `[0,0]` verwenden.

Collector darf den Add-Flow nur sehen, wenn `canViewPickups && canCreatePickups`. Worker prüft Create weiterhin authoritative.

### Nicht in Checkpoint B stapeln

- permanente Pickup MapLibre Layer;
- Assignment;
- persistente Pickup Comments;
- FC5.3 Collection Road Sections;
- Revert;
- Pickup Stats.

Nach Checkpoint B wieder einen eigenen stabilen CI-Checkpoint herstellen und Living Docs nur auf den tatsächlich erreichten Stand aktualisieren.

## Globale Grenzen

- MapLibre 5.7.1 bleibt einzige Kartenengine.
- M5 bleibt einzige Mutation Queue.
- App-eigene IDs bleiben authoritative, OSM IDs nur Provenance.
- Worker bleibt Authorization Boundary.
- Keine Secrets im Client oder in Map Properties.
- Keine kontinuierliche GPS-Historie.
- Keine Remote-Migration.
- Kein manueller Deploy.
- Kein Merge oder Ready.
- Kein neuer Branch/PR.
