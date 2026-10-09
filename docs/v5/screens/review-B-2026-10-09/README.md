# Review B, 2026-10-09

Basis: `708e8690b19aadf0066abfde7d13e2194af25bba`. Vergleich des Rewrites gegen `30092acb850d1439652a6d0003c09409aa6b4ce8`: 576 geänderte Dateien, 3305 hinzugefügte und 83397 entfernte Zeilen. Fokus dieses Durchgangs: Mutationspfad, Rechte-Matrix, Zugang/alte Links, prune/forget und A-1/A-3/A-4. Kein vollständiger UI-Audit aller 390/430-px-, Theme- und Hand-Kombinationen.

## Eigene Prüfungen

| Stand | Prüfung | Ergebnis |
|---|---|---|
| Basis 708e869 | npm test | 423/423, kein Skip |
| Basis 708e869 | npx tsc --noEmit -p .; npm run build | grün |
| Basis 708e869 | alle 15 run-all-Einträge, inklusive 40 Soak-Zyklen | grün, echte Worker-Handler auf SQLite-Fixture |
| A-1 3715a7c0cab9f2c2c7dde14b030ecb3b67755226 | npm test | 424/424, kein Skip |
| A-1 3715a7c | gezielte access/authorization/v5Api/collectionAccessPersistenceHardening-Tests | 39/39 |
| A-1 3715a7c | Typecheck, Build, Browser flow12/13/14 | grün |
| A-4 30558a318dea6adb6b87e1ed574a62657d08f87e | legacyImportSnapshot-Test | 1/1, Basis + Overlay für Alt-Import nachgewiesen |
| Staging-Konfiguration auf Basis/A-3 | wrangler d1 migrations list DB --local -c deploy/staging/wrangler.staging.example.jsonc | **ROT**: migrations_dir fehlt, sucht deploy/staging/migrations |
| Basis | npm run audit:dependencies | **ROT**: High-Advisories im Cloudflare-Dev-Tooling |

Soak auf synthetischer Standardstadt (`CITY_BLOCKS` ungesetzt, also 12): JS-Heap nach Warm-up 11,39 → 11,63 MB, DOM 116 → 116, Listener 226 → 232, WASM 5,64 → 5,64 MB; Layer/Quellen/Provider 20/6/1 unverändert. Software-WebGL im Headless-Browser, keine Geräte-/FPS-Zusage und kein 39k-Häuser-Nachweis dieses Durchgangs.

## Reproduzierte Befunde

| ID | Prio | Befund | Nachweis |
|---|---|---|---|
| B-F-001 | P1 | A-3-Runbook verwendet unqualifiziertes rollback, obwohl Root-Konfiguration Produktion ist | A-3-Diff 44d14e964852f21f7f2818f7e308251db34b0baa, Ablauf Schritt 5 |
| B-F-002 | P1 | Physisches prune/forget propagiert keine Löschung zu anderen FieldStores | Serverzeile entfernt, Peer nach inkrementellem und vollständigem Pull weiterhin completed |
| B-F-003 | P2 | null-JSON und null-Elemente werfen TypeError | ops/notes/prune null sowie ops:[null]/notes:[null] |
| B-F-004 | P2 | forget-Precheck ist nicht atomar mit der Löschung | zwischen Precheck und Batch neu angelegtes Gebiet bleibt, sein neuer Status verschwindet |
| B-F-005 | P1 | Staging-Binding ohne migrations_dir erreicht Repo-Migrationen nicht | eigener lokaler Wrangler-Lauf Exit 1 |

Reproduktion: `node --experimental-transform-types scripts/v5-e2e/review-regressions.ts`. Das Skript behauptet ausdrücklich **REPRODUZIERT**: erfolgreiche Assertions bestätigen die beschriebenen Defekte. Es ist keine grüne Release-Abnahme. Nach A-Fixes als Regression auf das gewünschte Verhalten umstellen; nicht unverändert in den Release-Gate aufnehmen.

## Gegenlesen

A-1 und A-4 am jeweils exakten Commit: B-OK per Inbox. A-3: BEFUND, kein OK. B-F-001..005: Korrekturen durch A offen; keine Gesamtfreigabe des Rewrites. Kommunikation und aktueller Befundstatus sind im Master-Context unter `projects/flyer-map/handoffs/dual/BOARD.md` verlinkt.

Rollen-Matrix gelesen und durch bestehende Tests/Flows exercised: Admin umfassend im Campaign-Scope; Viewer read-only; Team-Editor eigene Verteilgebiete; Collector Abholgebiete lesbar, Status/Notizen nur im aktiven übernommenen Run, Sonder-Marker über Geräte-Capabilities. Alte Rooms-Rolle wird mit A-1 abgelehnt. Die Grundprüfung auf Scope ersetzt nicht die separaten Race-/JSON-Befunde.

## Screenshots

Alle folgenden PNGs stammen vom isolierten A-1-Checkout `3715a7c`, frischen Fixtures und Chromium 151 bei **430 × 932 px**, dunkel. Nur synthetische, nicht produktive Zugangsdaten. B hat sie visuell geprüft. Der widerrufene Link wurde mit derselben flow12-Logik nach dem Ende der Einblendung aufgenommen (600 ms warten, Screenshot animations disabled); die Assertions bleiben unverändert.

- `a1-access.png`: Zugang erzeugt, QR und Kopieren.
- `a3-revoked.png`: ungültiger/widerrufener Link.
- `g1-groups.png`: Gruppenverwaltung.
- `c3-rights.png`: Geräte-Rechte im Abholmodus.

Screenshots beweisen diese Ansichten, keine vollständige Mobile-/A11y-Abnahme. A als Autor soll sie ebenfalls prüfen. Echtgeräte, Live-D1, Live-Basemap, echtes Overpass und Organizer gegen echte API fehlen. Kein Deploy, keine Remote-Migration, kein Main-/Beta-Merge.

## Fix-Gegenprüfung (A-Antwort 14:00Z)

- A-3 f6d308ded391d2152ada7dd4e93d9d46d83f3169: korrigierter Staging-Rollback/Quell- und Versions-ID gelesen; eigene lokale Migrationen-Liste grün (0001..0027, Exit 0). B-OK, B-F-001/B-F-005 geschlossen. Kein Deploy/Migrations-Go.
- A-5 dbeb5a0873d707f966662175d97f06adcb3b35d1: eigene 430/430 Tests, Typecheck/Build und flow9/10/13 grün. Normales prune und forget konvergiert in echten FieldStores, Null-Shapes werden strukturiert abgelehnt, Recreate hält neuen Fortschritt, 1005 Tombstones über zwei Chunks/37er Pull-Seiten ohne Lücke. B-F-003/B-F-004 geschlossen.
- B-F-002 bleibt offen (P1): gültiger Counter zzzz wird zu fünfstellig 10000 erhöht; neuer Tombstone ist lexikografisch kleiner und kein gültiger Clock. Server open, Peer bleibt completed. Kein A-5-OK.
- Neuer B-F-006 (P2): neues h:low@NOW-3000 zwischen Lookup und Batch wird trotz Änderung gelöscht, weil anderer Kandidat h:high@NOW-1000 als globaler Max-Guard dient. Vergleich mit dem tatsächlich gelesenen op_id je Schlüssel erforderlich. Der unabhängige Test injiziert die Änderung über den echten ops-Handler.
- Tombstones dauerhaft behalten, solange keine sichere Cursor-Untergrenze/Generation mit verpflichtendem Reset existiert. TTL allein würde Offline-Geräte inkonsistent machen.

Eigenständiger gewünschter Verhaltenstest (Exit 1 bei dbeb5a0: vier PASS, zwei FAIL):

```sh
REVIEW_ROOT=/path/to/exact-checkout node --experimental-transform-types scripts/v5-e2e/review-fixes.mjs
```

u6-cleaned.png: isoliertes dbeb5a0, 430×932 dunkel, Aufnahme nach Bereinigen und Ende der Einblendung. Derselbe flow9 mit zusätzlicher Aufnahme, Assertions unverändert. B hat den Screenshot angesehen. Keine vollständige UI-Abnahme. Der B-Branch übernimmt den geprüften A-1/A-4-Integrationsstand f1d9e09; A-5-Fix wird vor Abschluss der zwei Gegenbeispiele nicht übernommen.
