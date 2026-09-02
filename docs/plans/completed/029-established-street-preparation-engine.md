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

## Abschluss

- Die serverseitige Street Preparation, exakte JSTS-Geometrie, Turf-Smart-Street-Integration, Eligibility, stabile IDs, Reconcile-Logik, Telemetrie und Fixture-Regressionen sind implementiert.
- Die Sync-Übergabe ist als separater Vertrag dokumentiert; RxDB, D1-Feed und Durable Object bleiben außerhalb dieses Branches.
- Echte Android-/iPhone-Abnahme und Cloudflare-Preview-Abnahme bleiben offen, bis die jeweiligen Umgebungen verfügbar sind.
