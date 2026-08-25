# Prompt — New Agent / Fresh Chat

Use this prompt when starting a completely new AI coding session with **no prior knowledge** of Verteil-Flyer.

```text
Du arbeitest am GitHub-Projekt `madebycli/flyer-map` (Verteil-Flyer).

WICHTIG: Das Repository ist die einzige Source of Truth. Du hast kein verlässliches Vorwissen aus alten Chats. Erfinde keine Architektur, Roadmap, Zugangsdaten, CI-/Preview- oder Produktionszustände aus Erinnerung.

ARBEITSWEISE ZUM START

Bevor du irgendetwas änderst:

1. Lies `AGENTS.md` vollständig.
2. Lies `docs/status/CURRENT.md` vollständig.
3. Lies `docs/context-map.yaml` vollständig.
4. Behandle `docs/context-map.yaml` als Routing-Graph und lade nur die zur Aufgabe passenden Nodes.
5. Prüfe bei Architekturänderungen die relevanten akzeptierten ADRs unter `docs/decisions/`.
6. Prüfe aktuellen Code, offenen PR/Branch-Stand, letzte CI-Läufe und Preview-/Produktionsstatus.
7. Wenn Code und Doku widersprechen, ermittle den aktuellen beabsichtigten Stand anhand Code + aktuellem PR/main + ADRs und bereinige die falsche Doku im selben Slice.

PRODUKT

Verteil-Flyer ist eine mobile-first Website für reale Kleidersammlungs-Aktionen. Die Karte ist der primäre Feldarbeitsplatz.

Aktuelle Kernkonzepte:
- Campaign / Aktion
- Team
- Area / Gebiet
- Distribution Task
- Status: open / completed / later / not-deliverable
- Campaign-scoped Access mit Admin / Team Editor / Viewer

Langfristige Roadmap (Details immer aus `docs/product/ROADMAP.md` lesen):
- M5 resiliente Mutation Queue / Sync — AKTUELLER IMPLEMENTIERUNGS-SLICE
- M5.5 herunterladbarer ca. 3-km Offline-Kartenbereich für die geladene Website
- M6 Smart Street + House Tasks mit echter OSM/OSM-derived Geometrie
- M6.5 Collection / pickup mode für die spätere Kleider-Abholung per Auto, inklusive abgehakter Straßenabschnitte und expliziter Abholadressen
- M7 Kommentare, Activity, deterministische Automationen und Distribution-Einsatzfeedback (Dauer, Gruppengröße, optionale Notiz)
- M8 Organizations, mehrere Admins und separates Admin Panel
- M9 Statistiken/Reporting inkl. Dauer, Gruppengröße/Personenzeit sowie UI Light/Dark/System
- M10 Field Hardening / Release

Future-Features sind nicht automatisch implementiert. Lies die jeweiligen Graph-Nodes/Proposed-Architektur bevor du sie baust.

NICHT VERHANDELBARE WEBSITE-REGELN

Verteil-Flyer ist aktuell eine normale Website:
- keine native App
- keine installierbare PWA
- kein Service Worker
- kein Web-App-Manifest-Installationsflow
- kein Background Sync API

Eine Änderung daran braucht eine neue akzeptierte ADR.

WICHTIGE OFFLINE-GRENZE

M5 schützt Domain-Änderungen in IndexedDB. Das bedeutet NICHT automatisch, dass Chrome/Safari die komplette Website bei einem kalten Reload ohne Netz laden können.

Real-Browser-Beobachtung am 2026-08-25:
- geladene Website kann offline Streets erstellen/editieren und zeigt `offline gespeichert`;
- bei einem späteren vollständigen Reload ohne Netz zeigte Chrome die normale Offline-/Dino-Seite, bevor Verteil-Flyer JavaScript laufen konnte.

Daher:
- diesen Cold-Offline-Reload NICHT als bestanden darstellen;
- ihn auch nicht als Mutationverlust interpretieren;
- M5 akzeptiert geladene-App Offline-Queue/Retry-Verhalten;
- Plan 011 behandelt bewusst herunterladbare Offline-Kartendaten für die geladene App;
- garantiertes Cold-Offline-App-Shell-Loading würde eine neue Architekturentscheidung erfordern, die ADR-0006 revisitiert.

AKTUELLER MAP-BASELINE

- MapLibre GL JS 5.7.1 gepinnt
- CARTO Voyager Retina Raster-Basemap online
- gespeicherte Areas und Streets in persistenten MapLibre GeoJSON Sources/Layers
- aktive Draw/Edit-Geometrie nur SVG
- Browse darf keine Projektion aller gespeicherten Geometrien pro Frame ausführen

Am 2026-08-25 wurde ein Max-Zoom-Fehler behoben:
- Ursache: CARTO Raster-Layer `maxzoom: 20` wurde bei Map-Zoom 20 ausgeblendet;
- Fix-Commit `5029f9b958502d96d6c185beac16b894774d72e9` setzt nur den Raster-Layer auf maxzoom 21;
- Source und Map bleiben max 20;
- CI #226 grün;
- Worker Version Preview `https://98516141-flyer-map.cloudflare-eleven035.workers.dev`;
- Real-Browser-Abnahme: Basemap bleibt beim maximalen Zoom sichtbar.

Lies `docs/architecture/MAP.md` und ADR-0010 bevor du den Renderer änderst.

AKTUELLER ACCESS-/SECURITY-BASELINE

- Campaign id ist nur Selector, niemals Credential.
- Access Grants sind revocable und Campaign-scoped.
- Rollen: Admin, Team Editor (Team-scoped), Viewer.
- Authorization wird immer im Cloudflare Worker erzwungen.
- Session ist Secure/HttpOnly/SameSite=Lax.
- Plaintext Access Tokens werden nicht in D1 gespeichert.
- Operator Admin recovery/bootstrap ist über das serverseitige `M4_BOOTSTRAP_SECRET` abgesichert.
- Keine Race-to-claim-/First-visitor-Ownership einführen.

Lies `docs/architecture/SECURITY.md` + ADR-0009 bevor du Access/Organizations/Admin-Funktionen änderst.

AKTUELLER M5-SLICE

M5 wurde bereits gestartet. ERSTELLE NICHT NOCH EINEN NEUEN M5-BRANCH.

Aktueller Arbeitsstand:
- Branch: `m5-resilient-sync-mainline`
- Draft PR #24: `M5 durable mutation queue on current MapLibre baseline`
- aktiver Detailplan: `docs/plans/active/010-m5-resilient-mutation-sync.md`
- Plan 011: `docs/plans/active/011-offline-map-area.md` ist der geplante nächste Offline-Karten-Slice
- übergeordneter Plan: `docs/plans/active/009-product-platform-foundation.md`
- akzeptierte M5-Entscheidung: `docs/decisions/ADR-0011-durable-mutation-queue-and-idempotency.md`
- der alte Draft PR #17 ist geschlossen/superseded.

Implementiert in PR #24:
- explizite Campaign/Team/Area/Street-Task-Mutationen;
- IndexedDB als durable Queue;
- geordnete Verarbeitung + bounded exponential retry;
- Retry bei online / sichtbarem Tab / manuellem Refresh;
- Konflikt-, Auth-blocked- und Invalid-Zustände;
- best-effort localStorage Emergency Shadow;
- Worker-Endpunkt `/api/campaigns/:id/mutations`;
- bestehende Worker-Autorisierung bleibt maßgeblich;
- additive Migration `migrations/0003_m5_mutations.sql`;
- kanonischer SHA-256 Mutation-Fingerprint;
- gleiche ID + gleicher Inhalt = idempotenter Retry;
- gleiche ID + anderer Inhalt = `409 mutation_id_reused`;
- kompakter Sync-Status im UI.

BESTÄTIGTE GATES:
- D1 Migration `0003_m5_mutations.sql` erfolgreich auf remote `flyer-map-db` angewendet;
- Real-Browser Preview lädt;
- offline Street create/edit in der geladenen App zeigt `offline gespeichert`;
- Max-Zoom-Fix CI + neue Version Preview + Real-Browser-Abnahme bestanden.

AKTUELL NOCH OFFEN — NICHT ALS BESTANDEN DARSTELLEN:
1. geladenen App offline mutieren -> reconnect -> Queue genau einmal zum Server liefern;
2. Retry/Reconnect ohne Duplicate-Effekt;
3. echter Target-Konflikt sichtbar, kein stilles Überschreiben;
4. revoked/ungültiger Access stoppt blind retry und bleibt sichtbar access-blocked;
5. transienter Fehler bleibt queued und wird später erneut versucht;
6. gespeicherte MapLibre Areas/Streets und aktives Edit-Verhalten bleiben unverändert;
7. finaler Repository-Head vor Merge grün.

Cold Full-Page Reload ohne Netz ist derzeit DEFERRED/TODO, nicht M5-bestanden.

NEUE FUTURE-ANFORDERUNGEN

1. Distribution effort feedback:
   - Dauer der Verteilung für konkreten Abschnitt/Area/Session;
   - Anzahl Personen;
   - optionale Notiz;
   - später Auswertung für Gebietszuschnitt, Person-Zeit und Leiterrunden;
   - keine GPS-basierte Mitarbeiterüberwachung.

2. Collection / pickup mode:
   - eigener Modus getrennt vom Flyer-Verteilfortschritt;
   - Straßenabschnitte beim späteren Einsammeln per Auto abhaken;
   - Häuser/Adressen als Abholstellen markieren;
   - telefonisch gemeldete Abholadressen manuell hinzufügen;
   - reale Street/House-Geometrie aus M6 wiederverwenden;
   - exaktes Datenmodell/Statusvokabular vor Implementierung entscheiden.

ORGANIZATIONS / ADMIN PANEL

Mehrere Organisationen und mehrere Administratoren sind geplant, aber noch nicht Teil des aktuellen Campaign-Rollenmodells. Vor Implementierung `docs/architecture/ORGANIZATIONS.md` lesen und eine passende ADR akzeptieren.

COMMENTS / ACTIVITY / AUTOMATIONS / STATISTICS

Vor Implementierung `docs/architecture/COLLABORATION.md` lesen. Dort stehen jetzt auch Distribution-Einsatzfeedback und Collection-Reporting.

BEKANNTE FOLLOW-UPS

- GitHub #22: Desktop bottom-toolbar fit/spacing;
- GitHub #23: Production-Health/Recovery/`?diag=1`/500-5000-Street-Validation;
- Cold-Offline-App-Shell-Reload unter Website-only Architektur;
- Plan 011 Offline-Kartenbereich;
- M6.5 Collection / pickup mode;
- M7/M9 Distribution-Einsatzfeedback und Auswertung.

CODE-/GIT-REGELN

- Repository ist Source of Truth.
- Kleine reviewbare Commits.
- Keine historischen Migrationen umschreiben.
- Neue D1-Änderungen nur additive Migrationen.
- Keine Secrets/Access Links/private Campaign-Daten committen oder im Chat anfordern.
- Authorization serverseitig.
- Vor Abschluss: Tests + TypeScript + Production Build + relevante Doku + `CURRENT.md` + Context-Graph prüfen.
- Bestehenden aktiven PR/Plan fortführen statt parallele Ersatz-Slices zu erzeugen.

EXTERNE CLOUDFLARE-AKTIONEN

Wenn eine manuelle Cloudflare-Aktion des Users nötig ist:
- immer nur genau EINE manuelle Aktion gleichzeitig;
- exakten Klick/Befehl nennen;
- genau EIN nicht-sensitives Ergebnis zurückfragen;
- niemals Secret-Werte, OAuth-/Device-Codes oder Access Tokens im Chat anfordern.

DEIN START IN JEDEM FRISCHEN CHAT

Gib nach dem Lesen zuerst eine kurze Bestandsaufnahme mit aktuellem main/PR/Branch-Stand, Milestone/Plan, relevanten Graph-Nodes/ADRs, tatsächlich bestandenen Gates und offenen Risiken. Danach direkt weiter umsetzen, außer eine echte externe Aktion blockiert.
```

## Minimal handoff note

If a shorter handoff is needed, give the new agent only this file path and tell it:

> Read `docs/prompts/NEW_AGENT.md` from the repository and follow it exactly. Do not rely on prior chat memory.
