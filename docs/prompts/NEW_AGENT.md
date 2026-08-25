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
4. Behandle `docs/context-map.yaml` als Routing-Graph:
   - wähle die Nodes, deren `topics`/`load_when` zur Aufgabe passen;
   - folge relevante `depends_on`, `constrained_by`, `implements`, `governed_by` und Plan-Kanten;
   - lade vorgeschlagene Future-Architektur nur, wenn die Aufgabe dieses Future-Thema betrifft;
   - lade nicht pauschal alle Dokumente.
5. Prüfe bei Architekturänderungen die relevanten akzeptierten ADRs unter `docs/decisions/`.
6. Prüfe aktuellen Code, offenen PR/Branch-Stand, letzte CI-Läufe und Produktions-/Preview-Status, soweit für die Aufgabe relevant.
7. Wenn Code und Doku widersprechen, ermittle den aktuellen beabsichtigten Stand anhand Code + aktuellem PR/main + ADRs und bereinige die falsche Doku im selben Slice.

PRODUKT

Verteil-Flyer ist eine mobile-first Website für reale Flyer-/Verteilaktionen. Die Karte ist der primäre Feldarbeitsplatz.

Aktuelle Kernkonzepte:
- Campaign / Aktion
- Team
- Area / Gebiet
- Distribution Task
- Status: open / completed / later / not-deliverable
- Campaign-scoped Access mit Admin / Team Editor / Viewer

Die langfristige Produkt-Roadmap steht in `docs/product/ROADMAP.md`. Reihenfolge:
- M5 resiliente Mutation Queue / Sync — AKTUELLER IMPLEMENTIERUNGS-SLICE
- M6 Smart Street + House Tasks mit OSM/OSM-derived Geometrie statt Freihand-Textmarker als Normalfall
- M7 Kommentare, Activity und deterministische Automationen
- M8 Organizations, mehrere Admins und separates Admin Panel
- M9 Statistiken/Reporting und UI Light/Dark/System
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

AKTUELLER MAP-BASELINE

Der aktuelle akzeptierte Renderer-Pfad ist:
- MapLibre GL JS 5.7.1 (bewusst gepinnt; nicht beiläufig upgraden)
- CARTO Voyager Retina Raster-Basemap
- gespeicherte Areas als MapLibre GeoJSON Source + Fill/Outline Layer
- gespeicherte Street Tasks als MapLibre GeoJSON Source + wenige feste Status-Line-Layer
- normale Browse-Pan/Zoom/Rotate-Bewegung darf keine Anwendungsschleife über alle gespeicherten Straßen/Areas ausführen
- aktive Area-Draw/Edit- und Street-Draw-Geometrie bleibt in einem kleinen SVG-Overlay
- Edit-Punkte sind im Browse-Modus nicht sichtbar
- MapLibre `queryRenderedFeatures()` dient zur gespeicherten Auswahl

Lies `docs/architecture/MAP.md` und ADR-0010 bevor du diesen Renderer änderst.

WICHTIG: MapLibre 6.4.1 hat im realen Browser dieses Projekts gespeicherte GeoJSON-Geometrie unsichtbar gemacht. 5.7.1 ist deshalb die aktuelle getestete Basis. M5 darf diesen Renderer nicht nebenbei ändern.

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
- übergeordneter Plan: `docs/plans/active/009-product-platform-foundation.md`
- akzeptierte M5-Entscheidung: `docs/decisions/ADR-0011-durable-mutation-queue-and-idempotency.md`
- der alte Draft PR #17 ist geschlossen/superseded und darf nicht als aktueller Branch wiederbelebt werden.

Implementiert in PR #24:
- explizite Campaign/Team/Area/Street-Task-Mutationen;
- IndexedDB als durable Queue für nicht bestätigte Änderungen;
- geordnete Verarbeitung + bounded exponential retry;
- Retry bei online / sichtbarem Tab / manuellem Refresh;
- Konflikt-, Auth-blocked- und Invalid-Zustände;
- best-effort localStorage Emergency Shadow im kurzen IndexedDB-Enqueue-Fenster;
- IndexedDB-Operationen warten auf Transaktionsabschluss;
- Worker-Endpunkt `/api/campaigns/:id/mutations`;
- bestehende Worker-Autorisierung bleibt maßgeblich;
- additive Migration `migrations/0003_m5_mutations.sql`;
- kanonischer SHA-256 Mutation-Fingerprint bindet Mutation-ID an exakten Inhalt;
- gleiche ID + gleicher Inhalt = idempotenter Retry;
- gleiche ID + anderer Inhalt = `409 mutation_id_reused`;
- narrow D1 writes mit Campaign revision + internem `write_token`;
- kompakter Sync-Status im UI.

Repository-Akzeptanz:
- Runtime-Hardening-Head `8c7020ad5d1538bea68c351d918e94aa8f54973c` bestand CI #202;
- Gesamt-Head `5c7dce819d472be8242da59034310d7a87c21f36` (Code + Context/ADR/Runbook zu diesem Zeitpunkt) bestand CI #208;
- spätere reine Context/Handoff-Commits ändern keine Runtime; prüfe trotzdem den aktuellen finalen CI-Stand vor Merge.

NOCH OFFENE M5-GATES — NICHT ALS BESTANDEN DARSTELLEN:
1. Cloudflare PR-Bot/Deployment-Record nennt bislang nur den älteren Preview-Commit `fc200f9d...`; ein exakter Preview für den finalen runtime-equivalenten Head muss noch bestätigt werden.
2. `0003_m5_mutations.sql` ist repository-prepared, aber NICHT als auf D1 angewendet bestätigt. Mutation-Runtime-Tests erst nach expliziter Migration im gewählten Test-/Produktions-D1.
3. Real-Browser-Abnahme: offline speichern -> Reload -> reconnect; Retry ohne Duplicate; sichtbarer Conflict; revoked access stoppt blind retry; transienter Fehler bleibt queued; MapLibre-Verhalten unverändert.
4. PR #24 bleibt Draft bis diese Gates dokumentiert bestanden sind.

Wenn eine neue KI M5 übernimmt, muss sie zuerst `CURRENT.md`, Plan 010, ADR-0011, OFFLINE_SYNC, DATA, SECURITY, DEPLOYMENT sowie PR #24/aktuelles CI prüfen und dann auf DEM BESTEHENDEN Branch/PR weiterarbeiten.

ORGANIZATIONS / ADMIN PANEL

Mehrere Organisationen und mehrere Administratoren sind geplant, aber noch nicht Teil des aktuellen Campaign-Rollenmodells.

Vor Implementierung:
- lies `docs/architecture/ORGANIZATIONS.md`;
- erstelle/akzeptiere eine ADR für Identity/Membership/Org-Scope;
- behandle Organization als Tenant-Grenze;
- keine Cross-Organization Reads/Writes;
- Campaign Admin darf nicht stillschweigend zu Organization Admin umgedeutet werden.

COMMENTS / ACTIVITY / AUTOMATIONS / STATISTICS

Vor Implementierung lies `docs/architecture/COLLABORATION.md`.

Prinzipien:
- Comments an Campaign/Area/Task-Kontext binden;
- Activity möglichst append-only aus echten Domain-Mutationen;
- Automationen deterministisch, idempotent und auditierbar;
- Statistiken aus Domain-State/Events, nicht aus kontinuierlichem GPS-Tracking;
- keine versteckten privilegierten Automationen.

PLÄNE UND BEKANNTE FOLLOW-UPS

Plan 008 ist abgeschlossen und historisch:
- `docs/plans/completed/008-renderer-access-recovery.md`.

PR #21 ist am 2026-08-25 in `main` gemergt. Öffne den alten Renderer-Branch nicht für neue Arbeit.

Bekannte, ausdrücklich NICHT als bestanden geltende Follow-ups:
- GitHub #22: Desktop bottom-toolbar fit/spacing;
- GitHub #23: Production-Health/Deployed-Origin-Recovery/`?diag=1`/500-5000-Street-Operational-Validation.

Diese Issues dürfen nicht stillschweigend als erledigt interpretiert werden. Sie blockieren nicht automatisch M5, müssen aber gemäß `CURRENT.md`/Plan 009 eingeordnet und spätestens im Field-Hardening geschlossen werden.

CODE-/GIT-REGELN

- Repository ist Source of Truth.
- Kleine reviewbare Commits.
- Keine historischen Migrationen umschreiben.
- Neue D1-Änderungen nur additive Migrationen.
- Keine Secrets/Access Links/private Campaign-Daten committen oder im Chat anfordern.
- Authorization serverseitig.
- Vor Abschluss: Tests + TypeScript + Production Build + relevante Doku + `CURRENT.md` + Context-Graph prüfen.
- Abgeschlossene Pläne nach `docs/plans/completed/` verschieben.
- Bestehenden aktiven PR/Plan fortführen statt parallele Ersatz-Slices zu erzeugen.

EXTERNE CLOUDFLARE-AKTIONEN

Wenn eine manuelle Cloudflare-Aktion des Users nötig ist:
- frage immer nur genau EINE manuelle Aktion gleichzeitig an;
- gib den exakten Klick/Befehl an;
- frage genau EIN nicht-sensitives Ergebnis zurück;
- bitte niemals darum, Secret-Werte oder Access Tokens in den Chat zu kopieren.

DEIN START IN JEDEM FRISCHEN CHAT

Gib nach dem Lesen zuerst eine kurze Bestandsaufnahme mit:
- aktuellem main/PR/Branch-Stand;
- aktuellem Milestone/Plan;
- relevanten Graph-Nodes/ADRs;
- tatsächlich bestandenen CI/Preview/Migrations-Gates;
- vorhandenen Blockern/Risiken.

Danach beginne direkt mit der Umsetzung. Stoppe nicht nach einer bloßen Planung, außer eine echte externe Aktion ist erforderlich.
```

## Minimal handoff note

If a shorter handoff is needed, give the new agent only this file path and tell it:

> Read `docs/prompts/NEW_AGENT.md` from the repository and follow it exactly. Do not rely on prior chat memory.
