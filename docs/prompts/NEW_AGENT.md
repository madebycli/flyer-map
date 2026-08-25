# Prompt — New Agent / Fresh Chat

Use this prompt when starting a completely new AI coding session with **no prior knowledge** of Verteil-Flyer.

```text
Du arbeitest am GitHub-Projekt `madebycli/flyer-map` (Verteil-Flyer).

WICHTIG: Das Repository ist die einzige Source of Truth. Du hast kein verlässliches Vorwissen aus alten Chats. Erfinde keine Architektur, Roadmap, Zugangsdaten oder Produktionszustände aus Erinnerung.

ARBEITSWEISE ZUM START

Bevor du irgendetwas änderst:

1. Lies `AGENTS.md` vollständig.
2. Lies `docs/status/CURRENT.md` vollständig.
3. Lies `docs/context-map.yaml` vollständig.
4. Behandle `docs/context-map.yaml` als Routing-Graph:
   - wähle die Nodes, deren `topics`/`load_when` zur Aufgabe passen;
   - folge relevante `depends_on`, `constrained_by`, `implements` und Plan-Kanten;
   - lade vorgeschlagene Future-Architektur nur, wenn die Aufgabe dieses Future-Thema betrifft;
   - lade nicht pauschal alle Dokumente.
5. Prüfe bei Architekturänderungen die relevanten akzeptierten ADRs unter `docs/decisions/`.
6. Prüfe aktuellen Code, offenen PR/Branch-Stand, letzte CI-Läufe und Produktionsstatus, soweit für die Aufgabe relevant.
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

Die langfristige Produkt-Roadmap steht in `docs/product/ROADMAP.md`. Dazu gehören nach dem aktuellen Baseline-Slice insbesondere:
- M5 resiliente Mutation Queue / Sync
- M6 Smart Street + House Tasks mit OSM/OSM-derived Geometrie statt Freihand-Textmarker als Normalfall
- M7 Kommentare, Activity und deterministische Automationen
- M8 Organizations, mehrere Admins und separates Admin Panel
- M9 Statistiken/Reporting und UI Light/Dark/System
- M10 Field Hardening / Release

Diese Features sind geplant, aber nicht automatisch bereits implementiert. Lies die jeweiligen Graph-Nodes/Proposed-Architektur bevor du sie baust.

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

WICHTIG: MapLibre 6.4.1 hat im realen Browser dieses Projekts gespeicherte GeoJSON-Geometrie unsichtbar gemacht. 5.7.1 ist deshalb die aktuelle getestete Basis. Ein Upgrade braucht einen echten Browser-Test mit sichtbarer und anklickbarer Area + Street, nicht nur grünes TypeScript/CI.

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

PLÄNE

Nicht-triviale Arbeit braucht eine Datei unter `docs/plans/active/`.

Aktuell relevante übergeordnete Planung:
- `docs/plans/active/008-renderer-access-recovery.md` solange PR #21 noch offen ist;
- `docs/plans/active/009-product-platform-foundation.md` für die Arbeit danach.

Wenn PR #21 noch offen ist:
- arbeite zuerst dessen Acceptance/Restpunkte fertig;
- starte nicht parallel einen großen M5/M6/M8-Rewrite in denselben Branch.

Wenn PR #21 bereits gemergt und Production gesund ist:
- starte den nächsten Slice von aktuellem `main`;
- M5 ist der nächste technische Foundation-Slice.

CODE-/GIT-REGELN

- Repository ist Source of Truth.
- Kleine reviewbare Commits.
- Keine historischen Migrationen umschreiben.
- Neue D1-Änderungen nur additive Migrationen.
- Keine Secrets/Access Links/private Campaign-Daten committen oder im Chat anfordern.
- Authorization serverseitig.
- Vor Abschluss: Tests + TypeScript + Production Build + relevante Doku + `CURRENT.md` + Context-Graph prüfen.
- Abgeschlossene Pläne nach `docs/plans/completed/` verschieben.

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
- relevanten Graph-Nodes;
- vorhandenen Blockern/Risiken.

Danach beginne direkt mit der Umsetzung. Stoppe nicht nach einer bloßen Planung, außer eine echte externe Aktion ist erforderlich.
```

## Minimal handoff note

If a shorter handoff is needed, give the new agent only this file path and tell it:

> Read `docs/prompts/NEW_AGENT.md` from the repository and follow it exactly. Do not rely on prior chat memory.
