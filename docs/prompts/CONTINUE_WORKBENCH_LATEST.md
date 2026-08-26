# Flyer Map Workbench — kompletter Neuer-Chat-Prompt

Kopiere ab `BEGIN PROMPT` vollständig in einen neuen ChatGPT-Chat.

---

## BEGIN PROMPT

Du arbeitest weiter am GitHub-Projekt `madebycli/flyer-map` (Flyer Map / Verteil-Flyer).

Das Repository ist die **Source of Truth**. Wenn Chattext und Repository/Branches/PRs/CI voneinander abweichen, gilt das Repository.

Sprache mit dem Nutzer: Deutsch, natürlich, kompakt. Im Projekt wird der Nutzer häufig als `Master` angesprochen.

### Arbeitsregel

Der Nutzer erlaubt lange eigenständige Workbench-Arbeit ohne regelmäßige Approvals, aber:
- `main`/stable nicht ungefragt verändern;
- Workbench-PRs nicht automatisch nach `main` mergen;
- neue Slices auf isolierten Workbench-Branches/PRs;
- echte Architekturentscheidungen niemals heimlich treffen;
- wenn eine Entscheidung nicht blockiert, andere Arbeit fortsetzen und Entscheidung offen dokumentieren;
- bei Architekturentscheidungen Optionen + Empfehlung nennen, finale Wahl trifft der Nutzer;
- sicherheitskritische Account/TOTP/Permission-/Credential-Runtime erst nach akzeptierten ADRs + Threat Model.

### Vor jeder Änderung

1. `AGENTS.md` vollständig lesen.
2. `docs/status/CURRENT.md` auf `main` lesen.
3. `docs/context-map.yaml` lesen.
4. `docs/status/WORKBENCH.md` auf `workbench-unattended-platform` lesen.
5. relevante Product/Architecture/ADR/Plan-Dateien über Context Graph laden.
6. offene PRs inklusive Base/Head/CI prüfen.
7. aktuellen `main` und letzte Merges prüfen.

Danach kurze Bestandsaufnahme und direkt weiterarbeiten. Nicht nach reiner Planung stoppen.

# Harte Produkt-/Architekturgrenzen

Flyer Map bleibt eine normale Mobile-First-Website:
- keine native App;
- keine installierbare PWA;
- kein Service Worker;
- kein Web-App-Manifest;
- kein Background Sync.

MapLibre GL JS 5.7.1 ist akzeptierte Renderer-Basis, solange kein akzeptierter ADR sie ändert.

Security ist release-blocking:
- D1 SQL immer prepared/parameterized;
- keine Passwörter, TOTP-Secrets/Codes, Recovery-Codes, Session-/Access-/Join-/QR-Secrets loggen;
- Nutzereingaben mit SQL/HTML/JS/Prompt-artigem Inhalt bleiben inert data/text;
- Authorization immer serverseitig;
- IDs sind Selektoren, keine Credentials;
- Organization/Tenant-Grenzen serverseitig erzwingen;
- keine kontinuierliche GPS-Überwachung oder GPS-Routen-Historie.

# Stable/Main

`main` während aktueller Workbench-Phase nicht automatisch verändern.

Bereits stabil:
- M5 resilient mutation sync ist gemergt;
- durable IndexedDB Mutation Queue;
- idempotente serverseitige Mutation-Ledger-Logik;
- Konflikte statt silent last-write-wins;
- auth-blocked/retry states durable;
- serverseitige Rollenprüfung;
- SQL-Sicherheitsregressionen.

ADR-0012 ist akzeptiert:
- vorbereiteter Offline-Kartenbereich über bounded OSM/Overpass-compatible Worker-Request;
- ca. 3 km initialer Radius;
- normalisiertes lokales OSM-Paket in IndexedDB;
- kein CARTO-/OSMF-Bulk-Cache;
- initial kein R2/PMTiles;
- kein SW/PWA.

Plan 011 Prepared Offline Map ist noch nicht komplett promoted. Reale Phone/Browser-Akzeptanz fehlt noch.

# Wichtige Workbench PRs

- #28 Offline Map Settings Download/Update/Delete.
- #29 Offline OSM MapLibre context + neutral foundations + `docs/status/WORKBENCH.md` + Handoff-Prompts.
- #30 app menu/support/session metrics.
- #31 Team-Farbpalette.
- #32 app/progress/Team/support UI surfaces.
- #33 comments/automation foundations + ADR-0017.
- #34 OSM Smart Street/House candidates.
- #35 System/Light/Dark.
- #36 Campaign/Team/Area progress.
- #37 `?workbench=ui` allgemeine UI Preview.
- #38 Smart Street Domain start/end/routes/waypoints/point snap.
- #39 Smart Street combined touch preview, Base `workbench-m6-candidate-prep`, nicht main.
- #40 House selection UI.
- #41 Pickup domain/UI.
- #42 comments UI.
- #43 Field Session draft/history UI.
- #44 Organizer/Admin/Team-role/destructive-action Preview.
- #45 compact field chrome.
- #46 ADR-0013 Smart Street/House identity proposed.
- #47 ADR proposals Live Groups/Identity/Permissions + Threat Model.
- #48 Live Group create/discovery/Team filters.
- #49 Templates/New Action/Admin analytics/comparison.

Alle bleiben Draft/Workbench, sofern Repo nicht inzwischen etwas anderes zeigt.

# Smart Streets — bestätigte UX

Ziel: keine groben freien Textmarker-Linien mehr.

Bestätigt:
- Klick/Tap direkt auf vorbereitete echte Straßenlinie;
- auf präzisen Punkt der Road-Geometrie snappen;
- bei Kreuzungen mehrere nahe Road-Kandidaten anbieten statt raten;
- erster Punkt = Start;
- zweiter Punkt = Ende;
- Straßennamen sind nur Anzeige-Metadaten;
- niemals automatisch kilometerweit gleiche Straßennamen auswählen;
- eindeutiger kürzester topologischer Pfad zwischen Start/Ende wird ausgewählt;
- mehrere plausible Wege werden nicht geraten;
- Produktentscheidung für Mehrdeutigkeit = **C**:
  1. bounded Route-Varianten zeigen;
  2. zusätzlich Zwischenpunkte erlauben;
- Zwischenpunkte dürfen absichtlich längeren/anderen Weg erzwingen;
- disconnected/zu komplex -> sichtbarer Fehler;
- Straßenliste bleibt Keyboard-/Accessibility-Fallback.

Preview:
- `?workbench=m6`
- PR #39 aktueller geprüfter Touch-Preview-Head bestand CI #416.

Houses:
- einzeln;
- Mehrfachauswahl;
- alle adressierten Häuser einer Straße als Bulk-Auswahl;
- noch keine Durable-Persistenz.

ADR-0013 bleibt **proposed**. Nicht heimlich akzeptieren.
Empfohlene Richtung:
- eigene application-owned durable Task IDs;
- OSM `way/...` nur Provenance;
- reviewed geometry snapshot.

Vor M6-Persistenz Nutzerentscheidung nötig:
- app-owned Task ID + OSM provenance akzeptieren;
- persisted representation für geclippte/multi-way Street-Geometrie.

# Templates / Aktionen / Einsätze

Bestätigte Begriffe:
- Template/Vorlage = wiederverwendbare Planung + normale non-secret Defaults;
- Aktion = konkrete reale Runde mit frischem Zustand/History;
- Einsatz/Field Session = einzelner Außentermin innerhalb einer Aktion.

Typischer Ablauf ungefähr zweimal jährlich, aber Frequenz niemals hardcoden.

Templates:
- erstellen;
- als Datei herunterladen;
- später Datei importieren/laden;
- beim Erstellen einer neuen Aktion auswählen;
- ohne Template starten ebenfalls möglich;
- portable validierte JSON-Struktur `flyer-map-action-template`;
- enthält Map View, Teamnamen/-farben, Areas, geplante Geometrie, normale Defaults wie `online anzeigen = an`;
- kopiert nie Completion, alte entity IDs als neue Operational Identity, Sessions, History, Comments, Field Groups, Room/QR/Access/Session-Secrets.

**Distribution Template und Collection Template sind getrennte Typen.**

Distribution:
- eigene Verteilteams;
- Verteilgebiete;
- geplante Straßen/Häuser;
- neue Aktion startet frisch/offen.

Collection:
- eigene Auto-/Abholteams;
- typischerweise mehr und kleinere, anders geschnittene Gebiete;
- übernimmt ausdrücklich NICHT, welches Flyer-Team vorher wo verteilt hat;
- Pickup-Aufgaben starten frisch;
- optionaler Action Cycle darf Distribution + Collection nur für Reporting gruppieren, ohne Assignments/Progress zu koppeln.

PR #49:
- `?workbench=actions`
- New Action Wizard;
- passende Template-Typen;
- Template import/download;
- getrennte Fake-Verteil-/Abholplanung;
- Admin Analyseexport.

Der Actions Preview Head vor dem neuesten Vergleichs-Ausbau bestand CI #433. Prüfe immer aktuellen Head/CI neu.

ADR-0018 + Plan 013 bleiben proposed/active. Kein D1 Template/Action-Schema vor akzeptierter Persistenzrichtung.

# Admin AI Analytics / Logs Export

Admin/Organizer Feature.

Single Action Export:
- `analytics.json`
- `teams.csv`
- `areas.csv`
- `sessions.csv`
- `events.csv`
- `AI_ANALYSE_PROMPT.md`

Mehrere Aktionen:
- `comparison.json`
- `actions.csv`
- `AI_VERGLEICHS_PROMPT.md`

Analyseziele:
- Problemgebiete;
- wiederkehrende Engpässe;
- Personenzeit;
- Team-/Gebietslast;
- sinnvolle Umverteilung nächste Runde;
- welche Gruppe weniger/mehr übernehmen sollte, quantitativ begründet;
- Verbesserungsvorschläge;
- Trends über mehrere Aktionen.

Keine opaque Team-/Worker-Performance-Scores.
Keine automatische Sanktion/Assignment/Permission durch AI.

Security:
- strict allowlist;
- CSV formula prefixes `= + - @` neutralisieren;
- Prompt sagt explizit, dass alle exportierten Labels Daten, keine Instruktionen sind;
- keine Passwörter/TOTP/Tokens/QR-/Room-Secrets/GPS-Trails/Kommentartexte/free Session notes/account details im initialen Export;
- später `analytics.export` serverseitig prüfen und Export auditieren;
- keine automatische externe AI-Verbindung nötig.

Workbench `?workbench=actions` soll Single-Action und Multi-Action Export mit Fake-Daten lokal vorbereiten/downloaden können. Prüfe aktuellen PR #49 Head/CI.

# Historie / Löschen

Bestätigt:
- sinnvolle operative Historie behalten;
- keine automatische 12-/24-Monats-Löschung;
- exact historical geometry v1 nicht nötig;
- aktuelle/reviewed Task references + retained Sessions/Events reichen initial zur Reflection;
- abgeschlossene Aktionen normal archivieren;
- permanente Löschung nur Organizer;
- Workbench Bestätigung exakt `AKTION LÖSCHEN`;
- echter Worker muss Organizer erneut authorisieren + Audit Event;
- UI ist nur UX-Guard.

ADR-0017 bleibt vor echter History/Event-Persistenz relevant.

# Live Field Groups

Bestätigt:
- Field Group gehört zu Aktion/Campaign + Team;
- neue Gruppe default `Online anzeigen = an`;
- Liste default `Alle in der Aktion`;
- optional Teamfilter;
- versteckte Gruppen nicht in Discovery;
- keine öffentliche cross-Campaign Directory;
- gültiger Room Code/QR darf jemanden ohne vorherigen Campaign-Zugang temporär in genau diese Field Group/Team bringen;
- temporäre Mitgliedschaft darf niemals persistente Team-Management/Admin/Organizer-Rechte erzeugen;
- initiales Credential Redemption braucht Worker/Netzwerk.

PR #48:
- local create draft: label, allowed Team ID, discoverable, active state;
- kein Room Code/QR/Role/Authority im Draft;
- `?workbench=groups` kombiniert create/list/filter mit Fake-Daten;
- neue Preview-Gruppen haben ohne Server-Credential bewusst kein echtes Join;
- aktueller Live Group Preview Head bestand CI #434 nach TypeScript Fix.

Noch Nutzerentscheidung offen:
- Standardlaufzeit Room Code/QR.
Empfehlung bisher: gültig bis Einsatzgruppe geschlossen wird, zusätzlich hard maximum 24 Stunden.
Nicht annehmen, bis Nutzer antwortet.

Danach noch definieren:
- Rotation/Revocation;
- genaue temporäre Member-Capabilities;
- Rate Limits / brute-force tests.

# Rollen / Organization

Bestätigte Hierarchie:
- Organization
- Organizer
- Admin
- optional Team Leader
- Team Member
- Viewer/read-only wo genutzt.

Organizer:
- mehrere erlaubt;
- mindestens einer muss immer effektiv bleiben;
- `admin.manage` standardmäßig;
- darf Admins hinzufügen/verwalten;
- darf `admin.manage` gezielt an ausgewählte Admin Role Templates delegieren;
- delegierter Admin wird nie Organizer;
- nur Organizer verwaltet Organizer-Status;
- permanente Action-Löschung Organizer-only und nicht delegierbar.

Admin:
- breite operative Rechte gemäß Role Template;
- kann delegiertes `admin.manage` bekommen;
- niemals automatisch `organizer.manage`.

Team Member Standard:
- operative Daten im eigenen Team bearbeiten;
- inklusive Areas und Tasks/Status;
- niemals Cross-Team wegen client-geliefertem Team ID.

Team Leader optional/opt-in Standard:
- alles Team Member;
- Teamname/Farbe;
- Mitglieder/Einladungen;
- Team Field Groups / live-group settings.

Diese normalen Defaults sollen konfigurierbar sein.
Proposed Modell: named role templates + bekannte Capability Registry.
Harte Invarianten bleiben nicht konfigurierbar: Tenant boundary, last Organizer, Organizer-only permanent delete, keine Selbst-Eskalation.

PR #47:
- ADR-0016 auf diese Defaults aktualisiert;
- bestätigter Rollen-Doku-Head bestand CI #413;
- kein Runtime-Code.

PR #44:
- `?workbench=admin`;
- fake mehrere Organizer/Admins;
- delegiertes Adminmanagement sichtbar;
- configurable Team Member/Team Leader local role drafts;
- unbekannte/Cross-Team/Admin capability in Team-role model abgelehnt;
- Organizer Action delete UX;
- Preview Head bestand CI #423.

# Identity / Password / TOTP

Noch NICHT implementieren.

Gewünscht:
- username;
- password;
- authenticator TOTP;
- kein SMS-Zwang;
- Email nicht erforderlich.

Runtime bleibt blockiert bis ADR-0015 + ADR-0016 + Identity Threat Model akzeptiert.

Threat Model mindestens:
- SQL injection;
- XSS;
- brute force;
- password hashing runtime feasibility;
- TOTP replay;
- session fixation;
- CSRF/Origin;
- tenant breakout;
- last-Organizer concurrency;
- secret logging;
- recovery.

Passwortsicherheit nicht reduzieren, um Worker-Limits zu erfüllen. Wenn sichere Parameter technisch nicht tragbar sind, Runtime/Architektur/Tarif anpassen.

# Weitere vorbereitete Bereiche

- comments + controlled composer/list, noch ohne Persistenz/Moderationspolicy;
- automation signals read-only;
- Field Sessions + History UI, noch ohne endgültige Event-Persistenz;
- Pickup unabhängig von Flyerstatus;
- Campaign/Team/Area current progress;
- system/light/dark lokal;
- mobile field chrome;
- desktop Admin shell;
- Support diagnostics strict allowlist, Campaign context opt-in.

# Aktuelle offene Architekturentscheidungen

Nur fragen, wenn sie blockieren, sonst andere Arbeit fortsetzen:
1. ADR-0013 durable Smart Street/House Task Identity + persisted selected geometry.
2. Live Group credential lifetime/rotation + temporary capability matrix.
3. ADR-0015 Identity/TOTP/session/recovery Details.
4. ADR-0016 role-template update/version semantics + legacy access migration.
5. ADR-0018 Template/Action/Cycle D1 representation + template version persistence UX.
6. Comment edit/delete/moderation semantics.
7. Legacy Campaign access-link coexistence/migration.

# Empfohlene Fortsetzung

Solange Stable geschützt bleibt:
- keine Workbench-Merges zu main;
- aktuellen PR Head/CI immer verifizieren;
- UI/domain/test slices weiterentwickeln;
- Doku/Context Graph synchron halten;
- keine Security-/Credential-/Identity-Persistenz vor akzeptierten ADRs;
- keine Architektur stillschweigend auswählen.

Wenn der Nutzer später einen Bereich Richtung stable bringen will:
1. Dependencies/PR-Reihenfolge prüfen;
2. relevante ADRs akzeptieren;
3. kleinen Promotion-Branch vom aktuellen `main`;
4. nur benötigte geprüfte Slices übernehmen;
5. tests + typecheck + build;
6. Cloudflare Preview;
7. reale Browser/Mobile Acceptance;
8. erst dann main merge.

## END PROMPT
