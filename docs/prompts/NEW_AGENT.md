# Prompt — New Agent / Fresh Chat

Use this prompt when starting a completely new AI coding session with **no prior knowledge** of Verteil-Flyer.

```text
Du arbeitest am GitHub-Projekt `madebycli/flyer-map` (Verteil-Flyer).

WICHTIG: Das Repository ist die einzige Source of Truth. Verlasse dich nicht auf alte Chat-Erinnerungen.

START

1. Lies `AGENTS.md` vollständig.
2. Lies `docs/status/CURRENT.md` vollständig.
3. Lies `docs/context-map.yaml` vollständig.
4. Nutze `docs/context-map.yaml` als Routing-Graph und lade nur relevante Nodes/Abhängigkeiten.
5. Prüfe bei Architekturänderungen die relevanten akzeptierten ADRs.
6. Prüfe aktuellen Branch/PR, CI und Cloudflare-Preview-Status.
7. Wenn Code und Doku widersprechen, kläre den aktuellen Stand anhand Branch/PR/ADRs und bereinige die falsche Doku im selben Slice.

PRODUKT

Verteil-Flyer ist eine mobile-first Website für reale Flyer-/Verteilaktionen. Die Karte ist der primäre Feldarbeitsplatz.

Kernkonzepte:
- Campaign / Aktion
- Team
- Area / Gebiet
- Distribution Task
- Status open / completed / later / not-deliverable
- Campaign-scoped Access mit Admin / Team Editor / Viewer

Roadmap-Reihenfolge:
- M5 resiliente Mutation Queue / Sync — AKTUELLER RELEASE-SLICE
- M5.5 Downloadable Offline Working Area (~3 km) — Plan 011
- M6 Smart Street + House Tasks
- M7 Kommentare / Activity / Automationen
- M8 Organizations / Multi-Admin / Admin Panel
- M9 Statistiken / Reporting / UI Appearance
- M10 Field Hardening / Release

WEBSITE-REGELN

Verteil-Flyer bleibt eine normale Website:
- keine native App
- keine installierbare PWA
- kein Service Worker
- kein Web-App-Manifest-Installationsflow
- kein Background Sync API

Browser-lokales IndexedDB ist erlaubt, wenn es einen konkreten Feldbedarf löst.

MAP-BASELINE

- MapLibre GL JS 5.7.1 bleibt gepinnt.
- CARTO Voyager Retina ist der aktuelle Online-Raster-Basemap.
- gespeicherte Areas/Streets liegen in persistenten MapLibre GeoJSON Sources/Layers.
- aktive Draw/Edit-Geometrie bleibt im kleinen SVG-Overlay.
- normale Browse-Bewegung darf keine Anwendungsschleife über alle gespeicherten Geometrien ausführen.
- gespeicherte Auswahl nutzt `queryRenderedFeatures()`.

Lies `docs/architecture/MAP.md` + ADR-0010 bevor du Renderer-Code änderst.

MapLibre 6.4.1 hatte in diesem Projekt eine reale Browser-Regression mit unsichtbarer gespeicherter GeoJSON-Geometrie. Nicht beiläufig upgraden.

ACCESS-/SECURITY-BASELINE

- Campaign id ist nur Selector, niemals Credential.
- Rollen: Admin, Team Editor (Team-scoped), Viewer.
- Authorization wird im Worker erzwungen.
- Access Grants sind revocable und Campaign-scoped.
- Session ist Secure/HttpOnly/SameSite=Lax.
- Plaintext Access Tokens werden nicht in D1 gespeichert.
- Operator Admin recovery/bootstrap nutzt serverseitig `M4_BOOTSTRAP_SECRET`.
- keine First-visitor/Race-to-claim-Ownership einführen.

Lies `docs/architecture/SECURITY.md` + ADR-0009 bei Access-/Admin-Arbeit.

AKTUELLER M5-SLICE

M5 existiert bereits. ERSTELLE KEINEN NEUEN M5-BRANCH.

Aktueller Arbeitsstand:
- Branch `m5-resilient-sync-mainline`
- Draft PR #24 `M5 durable mutation queue on current MapLibre baseline`
- Plan 010 `docs/plans/active/010-m5-resilient-mutation-sync.md`
- ADR-0011 durable mutation queue/idempotency
- alter PR #17 ist geschlossen/superseded.

Implementiert in PR #24:
- explizite Campaign/Team/Area/Street-Mutationen
- IndexedDB durable queue
- emergency localStorage shadow
- ordered bounded retry/backoff
- online/visible/manual retry triggers
- conflict/auth-blocked/invalid states
- canonical SHA-256 mutation fingerprints
- Worker mutation endpoint + bestehende Authorization
- additive D1 migration `0003_m5_mutations.sql`
- narrow D1 writes + idempotency ledger
- kompakter Sync-Status.

Bestätigte Gates:
- Migration `0003_m5_mutations.sql` wurde am 2026-08-25 erfolgreich auf remote `flyer-map-db` angewendet.
- Offline Street create/edit zeigt `offline gespeichert`.
- Offline Street-Daten überleben einen vollständigen Reload.
- Runtime-Fix `5029f9b958502d96d6c185beac16b894774d72e9` behebt den gefundenen Maximum-Zoom-Grenzwertfehler (`carto-basemap` Layer maxzoom 20 -> 21).
- CI #226 für `5029f9b...` ist grün.

WICHTIGER PREVIEW-STATUS:
- Der ältere exakte Preview `5c7dce...` war akzeptiert, ist aber nach dem Runtime-Commit `5029f9b...` nicht mehr ausreichend.
- Vor Merge muss Cloudflare einen Preview/Deployment-Stand liefern, der `5029f9b...` oder einen späteren runtime-equivalenten Head enthält.
- Danach im echten Browser maximal hineinzoomen und bestätigen, dass die Basemap bei Zoom 20 sichtbar bleibt.

Noch offene M5-Gates:
1. neuer Cloudflare Runtime-Preview nach `5029f9b...`;
2. real-browser max-zoom check;
3. reconnect nach Offline-Reload -> queued Mutation wird genau einmal geliefert;
4. Retry ohne Duplicate;
5. sichtbarer Target-Konflikt ohne silent overwrite;
6. revoked/invalid access stoppt blind retry;
7. transienter Fehler bleibt queued und retryt später;
8. Area/Street selection + active edit bleiben korrekt;
9. finaler Head grün.

PR #24 bleibt Draft bis diese Gates bestanden und dokumentiert sind.

M5.5 OFFLINE WORKING AREA — PLAN 011

Neue bestätigte Produktanforderung:
- Settings-Aktion soll ungefähr 3 km um den aktuellen Kartenmittelpunkt für Offline-Arbeit herunterladen können;
- nach erfolgreichem Download muss der geografische Kontext nach Offline-Reload weiter sichtbar sein;
- Areas/Streets und M5-Queue funktionieren darüber weiter;
- kein Service Worker/PWA.

Plan:
- `docs/plans/active/011-offline-map-area.md`

WICHTIG: CARTO-Rastertiles dürfen dafür NICHT gespeichert/gecached werden. CARTO Basemap Terms verbieten storing/saving/caching basemap content. Plan 011 muss vor Implementierung per ADR einen offline-erlaubten OSM/OSM-derived Provider und ein Paketformat auswählen.

Bevorzugt soll derselbe OSM/OSM-derived Datenpfad später auch M6 Smart Street + House Tasks versorgen.

ORGANIZATIONS / COMMENTS / STATISTICS

Mehrere Organisationen/Admins, Kommentare/Activity/Automationen und Statistik sind geplant, aber nicht Teil des aktuellen M5-Domainmodells. Vor Implementierung die passenden proposed architecture Nodes laden und erforderliche ADRs erstellen.

BEKANNTE FOLLOW-UPS

- GitHub #22 Desktop bottom-toolbar fit/spacing
- GitHub #23 Production health/recovery/diagnostics + 500/1000/2500/5000 Street validation

Nicht stillschweigend als bestanden markieren.

CODE-/GIT-REGELN

- Repository ist Source of Truth.
- kleine reviewbare Commits.
- historische Migrationen nicht umschreiben.
- neue D1-Änderungen nur additive Migrationen.
- keine Secrets/Access Links/private Campaign-Daten committen oder im Chat anfordern.
- Authorization serverseitig.
- vor Abschluss Tests + TypeScript + Production Build + relevante Doku + CURRENT + Context-Graph prüfen.
- bestehende aktive Branches/PRs/Pläne fortführen statt Parallel-Ersatz zu erzeugen.

EXTERNE CLOUDFLARE-AKTIONEN

Wenn eine manuelle Aktion nötig ist:
- immer genau EINE Aktion gleichzeitig;
- exakter Klick/Befehl;
- genau EIN nicht-sensitives Ergebnis zurückfragen;
- niemals Secret-Werte, Tokens oder OAuth-/Device-Codes anfordern.

STARTAUSGABE EINER NEUEN KI

Nach dem Lesen kurze Bestandsaufnahme:
- main/Branch/PR
- aktueller Plan/Milestone
- relevante ADRs/Graph-Nodes
- tatsächlich bestandene CI/Preview/Migrations-Gates
- Blocker/Risiken

Danach direkt weiterarbeiten. Nicht nach einer bloßen Planung stoppen, außer eine echte externe Aktion ist erforderlich.
```

## Minimal handoff note

> Read `docs/prompts/NEW_AGENT.md` from the repository and follow it exactly. Do not rely on prior chat memory.
