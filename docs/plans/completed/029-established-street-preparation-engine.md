---
id: plan-029-established-street-preparation-engine
type: plan
status: completed
last_updated: 2026-09-02
related: [ADR-0026, architecture-stack, quality, offline-map, smart-street]
source_of_truth_for: [established-street-preparation-engine]
---

# Plan 029: Established Street Preparation Engine

## Ausgangslage

Dieser isolierte Feature-Branch startet auf dem verifizierten Head von `plan-feature-complete-platform`. Die bestehende Area-Preparation besitzt bereits einen geschützten Server-Job, verwendet für Straßen aber zufällige Task-IDs und eigene Geometrie-Mathematik. Sync/RxDB bleibt außerhalb dieses Branches.

## Ziel

Eine produktionsnahe, serverseitige Street Engine, die vorbereitete OSM-Straßen einmal pro Area serverseitig abruft, normalisiert, eligibility-gefiltert und mit JSTS exakt gegen das Area-Polygon schneidet. Die resultierenden Fragmente erhalten stabile app-owned IDs und bleiben für Map-first und Smart Street direkt nutzbar.

## Umsetzung

- Dependency- und Lizenzentscheidung für JSTS 2.12.1 und Turf 7.4.0 dokumentieren.
- Geometrie- und Eligibility-Module unter `worker/streetPreparation/` isolieren.
- OSM-Ways deterministisch deduplizieren, ablehnen oder fail-closed behandeln und zu stabilen Straßenfragmenten vorbereiten.
- Bestehende Area-Preparation auf algorithm-versionierte Fingerprints und reconcile-basierte Street-Publikation umstellen.
- Bestehende App-IDs, Statuswerte, Labels, manuelle Tasks und bearbeitete automatische Tasks schützen.
- Turf für Smart-Street-Snap und A/B-Teilstrecken verwenden, ohne Browser-Overpass oder Geräte-Recompute.
- Fixture-basierte Tests für Clipping, Kurven, Concave-/Multi-Fragmente, Eligibility, Snap, Persistenz und Regression ergänzen.
- Sync-Vertrag separat dokumentieren, ohne RxDB-, D1-Feed- oder Durable-Object-Code zu verändern.

## Nicht in diesem Branch

- `mission-rxdb-sync`, PR #74, Remote-D1-Migrationen, Merge, Release oder Production Deploy.
- Browser-Overpass, neue OSM-Quelle, PWA/Service Worker oder XXL-Straßenliste.
- Behauptung einer echten Android-/iPhone-Abnahme ohne verfügbaren Realgerät-Test.

## Abnahmekriterien

- Kein automatisch gespeichertes Straßenfragment liegt außerhalb des gespeicherten Area-Polygons.
- Reprepare erzeugt bei gleicher Eingabe keine Delete/Create-Churn für unveränderte automatische Straßen und löscht niemals manuelle Tasks.
- Bearbeitete automatische Straßen blockieren bei Obsoleszenz sicher statt still gelöscht zu werden.
- Smart Street snappt nur auf vorbereitete echte Straßen und speichert exakt die angezeigte Teilstrecke.
- `npm test`, `npm run typecheck`, `npm run audit:dependencies` und `npm run build` sind im exakten finalen Branch-Head grün.
- Draft-PR bleibt gegen `plan-feature-complete-platform` gerichtet und wird nicht gemergt.

## Hardening Follow-up

- Die bestehende Geometry Engine bleibt erhalten; dieses Follow-up härtet nur Integration, Ownership, Generation-Reconcile, Quellenisolation und Layering.
- PR #74 bleibt read-only. RxDB, D1-Feed, Durable Object und Migrationen werden in diesem Branch nicht implementiert.
- Plan 029 wird erst nach exaktem Head-CI, exaktem Cloudflare-Check und sauberem Sync-Handoff wieder abgeschlossen.


## Abschluss

- Ownership ist auf Engine-Kandidaten und einen gemeinsamen Street-Reconcile-Adapter getrennt.
- Die kanonische generation-unabhängige Street-ID ist mit dem SHA-256-Vertrag des Sync-Workstreams ausgerichtet.
- Reprepare liefert Inserts, Updates, zulässige Tombstones und No-Churn-Unchanged-Deltas und bewahrt Nutzerfelder.
- Nach begonnenem automatischem Work gilt Policy A: action-required, kein Retry-Loop, kein stale Publish und kein Löschen bearbeiteter Tasks.
- Roads und Buildings werden in getrennten bounded Overpass-Phasen geladen und diagnostisch getrennt.
- JSTS-Clipping bleibt server-only; der Client importiert keine Worker-Module.
- Exakte GitHub-CI- und Cloudflare-Preview-Gates wurden vor dem Planabschluss verifiziert. Reale Android-/iPhone-Abnahme bleibt ein separates offenes Produkt-Gate.
