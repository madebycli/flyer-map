---
id: plan-027-mission-day-one-fixpack
type: plan
status: active
last_updated: 2026-09-02
related: [ADR-0023, plan-m5-sync, plan-app-launcher-sheet, security, offline-sync, quality]
---

# Plan 027: Mission Day-One Fixpack

## Ziel

Die manuelle Distribution muss ohne Tab-Reload auf anderen Geräten aktualisieren.
Terminale lokale M5-Records dürfen den kanonischen Server-Refresh nicht blockieren.
Tour-QRs bleiben ein eigener Credential-Pfad, Viewer bleiben teamlos und Mission-UI
bleibt auf Feldarbeit beschränkt.

## Erledigt

1. Terminale `conflict`/`invalid`-Queue-Records werden mit lokaler Sicherheitskopie
   einzeln server-wins entfernt, spätere Records weiter verarbeitet und danach wird der
   kanonische Snapshot geladen.
2. Ein leerer Queue plus stale Browser-Cache wird als `saved`, nicht als Konflikt
   behandelt. Online-Polling erfolgt alle drei Sekunden ohne Parallel-Polling.
3. Sync-Status zeigt eine sichere, klickbare Recovery-Erklärung.
4. Mehrdeutige D1-Batch-Metadaten beim ersten Tour-Create werden gegen den persistierten
   Request geprüft, damit der erste erfolgreiche Request nicht fälschlich 409 meldet.
5. Field-Group-QRs unterdrücken den Admin-Recovery-Gate; Viewer erhalten keinen geerbten
   aktiven Team-Scope; leere House- und erwartete Kommentar-404-Flächen werden verborgen.
6. `team.delete` ist eine enge M5-Mutation: nur Admin, mit `expectedUpdatedAt`, ohne
   Snapshot-Cascade und mit fail-closed D1-Prüfung für Gebiete, Touren, Sessions,
   Historie und aktive Team-Links.
7. Mission-Sheets für Team, Gebiet, Straße, Haus, Campaign-Kommentare und Einstellungen
   lassen sich über den zugänglichen Griff einklappen. Der Zustand bleibt nur für das
   aktuell geöffnete Sheet und liegt oberhalb der permanenten Feldleiste.

## Noch offen

- Restabnahme der neuen Farbwahl und Chrome auf realen Geräten;
- reale Zwei-Browser-/Tour-Smoketests;
- remote D1-Migrationen 0015/0016 ausschließlich nach expliziter Master-Freigabe.

## Nicht-Ziele

Keine Reaktivierung automatischer Area-Vorbereitung, keine Snapshot-PUT-Rückkehr, kein
Merge und kein manueller Deploy.
