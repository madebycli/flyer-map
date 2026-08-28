---
id: plan-017-feature-complete-platform
type: plan
status: active
last_updated: 2026-08-28
related: [plan-012-platform-app-expansion, plan-016-app-launcher-sheet, product-roadmap, product-ux, architecture-live-teams, architecture-collaboration, architecture-identity-permissions, architecture-organizations, ADR-0014, ADR-0015, ADR-0016, ADR-0017, ADR-0018, quality]
---

# Plan 017: Feature-Complete Platform Delivery

## Ziel

Verteil-Flyer wird nicht mehr über sichtbare Foundation-/Preview-Slices erweitert, sondern über vertikale Features, die im normalen Produkt wirklich benutzbar sind.

Ein Launcher-Ziel gilt erst als geliefert, wenn der relevante Benutzerweg inklusive UI, Persistenz, Worker-Autorisierung, Offline-/Retry-Verhalten, Fehlerzuständen, Tests und Dokumentation vollständig ist.

## Source of Truth

Vor jeder weiteren Umsetzung:
1. `AGENTS.md` vollständig lesen.
2. `docs/status/CURRENT.md` lesen.
3. `docs/context-map.yaml` traversieren.
4. Relevante Product-, Architecture- und ADR-Knoten laden.
5. Offene PRs, Branch-Stack, exakten Head und CI prüfen.
6. Vor D1-Arbeit den dokumentierten Remote-Migrationsstand prüfen.

Aktueller Entwicklungszweig:
- Draft PR #72;
- Branch `plan-feature-complete-platform`;
- Base `ui-app-launcher-sheet`;
- PR #72 enthält inzwischen nicht nur Planung, sondern den aktuellen FC0-/FC1-Runtime-Slice sowie den durable-Comments- und Activity-Teil von FC2.

Remote D1 ist weiterhin nur bis Migration 0003 dokumentiert. Migrationen 0004 bis 0008 bleiben vorbereitet, aber nicht remote angewendet.

## Delivery-Regel

Nicht feature complete sind:
- lokale React-Daten ohne autoritative Persistenz;
- Workbench/Fake-Preview;
- Callback-only Flows;
- klickbare UI ohne serverseitige Berechtigung;
- Backend ohne vollständige Benutzeroberfläche;
- ein sichtbares Launcher-Ziel, das nur Foundation-Code öffnet.

Feature complete bedeutet für den jeweiligen Slice, soweit zutreffend:
1. Happy Path auf Mobile.
2. Shared State dauerhaft serverseitig gespeichert.
3. Worker autorisiert jeden geschützten Read/Write.
4. Offline-relevante Arbeit nutzt den akzeptierten M5-Mechanismus.
5. Loading, Empty, Error, Revoked, Conflict und Retry sind behandelt.
6. UI zeigt nur erlaubte Aktionen.
7. Kein Core-Flow geht durch Navigation/Redesign verloren.
8. Mobile und Desktop bleiben benutzbar.
9. Touch-Ziele und Accessibility sind berücksichtigt.
10. Unit-/Integration-/Security-Tests decken die relevanten Grenzen ab.
11. Tests, Typecheck, Dependency Audit und Production Build sind grün.
12. Product-/Architecture-/Status-/Context-Doku ist aktuell.
13. Keine sichtbare Foundation-Kennzeichnung bleibt als Ersatz für ein fertiges Feature.

## Verbindliches UI-System

Der Karten-Browse-Zustand bleibt kompakt:
- unten links 3x3 Launcher-Button;
- daneben aktiver Teamname;
- Teamfarbe nur unterstützend;
- keine permanente Team-Auswahl;
- keine permanenten Settings-/Teams-/Gebiet-Buttons.

Launcher und Fachoberflächen verwenden das bestehende Sheet-/Card-System. Neue große UI-Framework-Abhängigkeiten werden nicht eingeführt.

## FC0: Navigation und Berechtigungs-Bridge

**Status: umgesetzt auf PR #72.**

Erreicht:
- typisierter PlatformShell/App-Action-Contract;
- sichtbarer Teamname folgt dem aktiven Karten-Team;
- Settings, Teamverwaltung und Gebiet-Aktion bleiben über Launcher/Bridge erreichbar;
- Viewer und Team-scoped Rollen sehen nur passende Aktionen;
- `Team` öffnet den echten Team Hub statt des alten Workbench-Live-Group-Previews;
- unfertige Foundation-Module gelten weiterhin nicht als abgeschlossen, nur weil interne UI existiert.

## FC1: Team Hub + Live Field Groups

**Status: Runtime-Slice umgesetzt, Rollout noch nicht freigegeben.**

ADR-0014 ist akzeptiert. ADR-0017 ist für die Field-Session-Historie akzeptiert.

### Team Hub

Der normale Launcher-Eintrag `Team` bietet:
- aktuelles Team mit Name/Farbe;
- Teamwechsel bei entsprechendem Zugriff;
- realen Team-Fortschritt;
- aktive Gruppen;
- Campaign-weite Gruppenliste mit optionalem Teamfilter;
- Join per Room Code und QR;
- Management-Aktionen nur für Admin bzw. eigenen Team Editor;
- read-only Verhalten für Viewer/temporäre Mitglieder.

### Gruppe erstellen

Berechtigte Nutzer können:
- ein erlaubtes Team auswählen;
- Gruppenlabel setzen;
- Discoverability setzen, standardmäßig aktiv;
- optionale Teilnehmerzahl setzen;
- eine Gruppe mit idempotenter Create-Request-ID erzeugen;
- den einmal ausgegebenen Room Code und QR-Zugang teilen.

Create-Replay mit gleicher Request-ID und gleichem Payload erzeugt keine zweite Gruppe und legt Secrets nicht erneut offen. Gleiche Request-ID mit anderem Payload konfliktet.

### Credentials

Akzeptierter FC1-Stand:
- 10-stelliger human-safe Base32 Room Code;
- separater 32-Byte-QR-Token;
- D1 speichert nur SHA-256-Lookup-Hashes;
- Plaintext wird nur bei Ausgabe/Rotation zurückgegeben;
- Rotation ist idempotent und verlängert die ursprüngliche 24h-Frist nicht;
- Revoke sperrt neue Joins, ohne bestehende Memberships automatisch zu entfernen.

### Join und temporäre Session

Join ist online-only und Worker-authorisiert.

Ohne vorhandenen Campaign-Zugriff kann eine separate `vf_field_group_session` erzeugt werden:
- HttpOnly;
- Secure;
- SameSite=Lax;
- serverseitig nur gehashte Session gespeichert;
- Scope auf genau eine Campaign, ein Team und eine Field Group;
- keine Team-/Gebiets-/Invite-/Admin-Verwaltung;
- nur freigegebene Task-Statusarbeit im Ziel-Team.

Bestehender Campaign-Zugriff bleibt das Berechtigungsmaximum. Join erhöht keine Rolle und erweitert keinen Team Editor auf andere Teams.

### Rate Limits

Join verwendet zwei Cloudflare-Rate-Limit-Bindings:
- 30 Versuche pro 60 Sekunden für Campaign plus Connecting-IP-Key;
- 8 Versuche pro 60 Sekunden für Campaign plus Kandidaten-Hash.

Die IP dient nur als Rate-Limit-Key und wird nicht als Produktdaten gespeichert.

### Aktive Gruppe

Die UI zeigt:
- Gruppen-/Teamname;
- aktiven Status;
- Laufzeit;
- Teilnehmerzahl;
- realen Team-Fortschritt;
- Online-/Offline-Zustand;
- Leave für die eigene Membership;
- Discoverability, Credential Rotate/Revoke und Close nur für Manager.

### Manager-Mitgliederverwaltung

Umgesetzt:
- server-autorisierter aktiver Member-Roster;
- Admin für jede Gruppe der Campaign;
- Team Editor nur für die eigene Teamgruppe;
- Viewer und temporäre Mitglieder ausgeschlossen;
- minimale Daten: Membership-ID, Membership-Typ, sichere Bezeichnung, Join-Zeit;
- keine Session-Hashes, Join-Secrets, IPs oder Gerätefingerprints;
- Entfernen mit expliziter Bestätigung;
- Gruppenanzahl wird danach erneut autoritativ geladen.

Ein Source-Guard stellt sicher, dass das Member-Panel im echten Team-Hub-Build bleibt und nicht wieder als unimportierte Datei aus dem Produktgraph verschwindet.

### Close und 24h-Expiry

Manuelles Schließen:
- finale Teilnehmerzahl verpflichtend;
- blockiert neue Joins sofort;
- invalidiert temporären privilegierten Zugriff;
- beendet die Field Group;
- legt nach Migration 0007 dauerhaft die zugehörige Field Session plus dedupliziertes `field_session.closed`-Event an.

24h-Sicherheitsablauf:
- wird serverseitig auf relevanten Read-/Join-/Authorization-Pfaden aufgelöst;
- erzeugt `field_session.expired`;
- unbekannte Teilnehmerzahl bleibt unbekannt;
- Person-Time wird nicht erfunden.

### Persistenz

Migration 0006:
- `field_groups`;
- `field_group_join_credentials`;
- `field_group_memberships`;
- Create-/Rotate-Idempotenzfelder und Constraints.

Migration 0007:
- `field_sessions`;
- minimierte `domain_events`;
- deterministische Field-Group-zu-Session-Beziehung;
- transaktionale Close-/Expiry-Historie.

Migration 0008:
- `comments` mit Campaign-/Target-/Team-Scope;
- sicherer Actor-Prinzipal ohne neue Personen- oder Account-Identity;
- getrimmter Body, Versionierung und Tombstone-Zustand;
- bounded Context-Read-Indizes.

Alle drei Migrationen sind vorbereitet, aber nicht remote angewendet.

### FC1 Rollout-Gate

FC1 darf erst als produktiv ausgerollt gelten, wenn:
- 0006 und 0007 bewusst remote angewendet wurden;
- exakter Release-Head grün ist;
- Cloudflare Worker/Rate-Limit-Bindings im Zielenvironment verifiziert sind;
- Multi-Device-Smoke-Test mit Room Code und QR erfolgt;
- Close/Expiry plus Membership-Removal im Zielenvironment geprüft sind.

### Team-Lifecycle bewusst nicht in FC1 verstecken

Die bestehende persistente Teamstruktur besitzt keinen Archivstatus. Team-Editor-Grants hängen außerdem an der aktuellen Team-Existenz und die Legacy-Snapshot-Kompatibilität beeinflusst FK-Entscheidungen.

Darum wird in FC1 **kein neuer Team-Hard-Delete oder improvisierter Archivstatus** eingebaut.

Sicheres Team-Archivieren wird als eigener Team-Lifecycle-/Admin-Slice unter Organization/Permissions behandelt. Dieser Slice muss vorher explizit definieren:
- persistentes Team-Statusfeld;
- Verhalten aktiver Areas/Tasks;
- Verhalten bestehender Team-Editor-Grants;
- Verhalten aktiver Field Groups;
- retained Field Sessions/Events;
- Wiederherstellung vs permanentes Löschen.

ADR-0017 bleibt dabei verbindlich: Historie referenzierter Teams darf nicht durch unbedachten Hard Delete unverständlich werden.

## FC2: Field Sessions + Comments + Activity + Automations

**Status: Field-Session-, durable-Comments- und Activity-Runtime umgesetzt; Automations bleiben offen.**

Die Close-/Expiry-Session-Grundlage aus FC1 ist bereits vorhanden. FC2 erweitert sie zu einem echten Collaboration-Produkt.

### Umsetzung

1. Field Session Read-/History-API mit Campaign-/Team-Scope.
2. Session-Historie im normalen `Einsätze`-Modul statt Fake-/Foundation-State.
3. explizite Session-Notiz mit klarer Größenbegrenzung und inertem Text.
4. Task-Mutationen erhalten serverseitigen Session-/Event-Bezug.
5. Retry derselben M5-Mutation erzeugt kein zweites Event.
6. Session-Auswahl kann betroffene aktuelle/reviewed Street-/House-Geometrie hervorheben.
7. Kommentare werden auf Campaign/Area/Street/House-Kontext dauerhaft gespeichert. Pickup bleibt bis zum echten persistenten Pickup-Modell ausgeschlossen.
8. Kommentar Edit/Delete/Moderation folgt einer konservativen, dokumentierten Legacy-Identity-Regel.
9. Activity Feed basiert auf echten normalisierten Domain Events.
10. Automations bleiben deterministisch, autorisiert und idempotent.

### Durable Comments Runtime

Der Comment-Slice verwendet Migration 0008 und den Worker als authoritative Boundary.

- API: `GET` für einen einzelnen Campaign-/Area-/Street-Task-/House-Task-Kontext sowie `POST`, `PATCH` und `DELETE` auf Campaign-scoped Comment-IDs;
- jede Liste ist cursor-paginiert und auf höchstens 50 Einträge pro Read begrenzt;
- Body wird getrimmt, auf 2000 Zeichen begrenzt und als inert gespeicherter Text behandelt;
- Ziel-IDs werden serverseitig gegen Campaign und aktuellen Team-Scope aufgelöst;
- Admin darf in der Campaign moderieren;
- Team Editor darf nur aktuelle Zielobjekte im eigenen Team moderieren;
- Viewer bleiben read-only;
- temporäre Mitglieder dürfen nur im eigenen aktiven Campaign-/Team-/Group-Scope erstellen und erhalten keine persistenten Rechte;
- die aktuelle Legacy-Identity erlaubt keine sichere Personen-Zuordnung für Self-Edit/Self-Delete, daher wird diese Sonderregel konservativ nicht freigeschaltet;
- Delete setzt einen Tombstone und leert den Body, der Datensatz und notwendige Metadaten bleiben erhalten;
- gelöschte Kommentare sind nicht editierbar und werden als `Kommentar gelöscht` dargestellt;
- Target-Reads nach Entfernung des Zielobjekts failen geschlossen, die historische Comment-Referenz bleibt erhalten;
- `comment.created`, `comment.edited` und `comment.deleted` speichern nur minimale Actor-, Ziel- und Versionsreferenzen. Vollständiger Body, Request-Body, Secrets, Cookies, GPS und Snapshots bleiben außerhalb des Event-Payloads;
- stabile Comment-/Operation-IDs und D1-Dedupe verhindern doppelte Events bei Retries;
- der normale Launcher öffnet Campaign-Kommentare, Area-/Street-/House-Sheets enthalten die passenden Kontextflächen;
- bereits geladene Kommentare bleiben offline sichtbar. Writes bleiben in diesem Slice online-only und nutzen keinen zweiten Queue-Mechanismus.

### Activity Feed Runtime

Activity ist eine sichere Projektion der bereits persistierten `domain_events` und keine zweite Activity-Persistenz.

- der Worker bietet den Campaign-scoped Read-Pfad `GET /api/campaigns/:campaignId/activity`;
- Default-Limit ist 30, das harte Maximum 50. Die Sortierung ist `occurred_at DESC, id DESC`; der Cursor enthält nur den letzten Zeit-/ID-Tie-Breaker;
- die aktuelle Allowlist umfasst ausschließlich `field_session.closed`, `field_session.expired`, `task.status.changed`, `comment.created`, `comment.edited` und `comment.deleted`;
- `task.status.changed` projiziert nur Street/Haus, alten/neuen allowlisteten Status und sichere aktuelle Labels. Session-Events laden sichere Metriken aus `field_sessions`. Comment-Events zeigen Zieltyp und aktuellen sicheren Kontext, nie Kommentartext;
- Actor-Darstellung bleibt auf sichere Kategorien (`Campaign-Zugriff`, `Temporäre Gruppe`, `System`, unbekannt) reduziert;
- Admin und Viewer lesen Campaign-weit, Team Editor nur das canonical eigene Team. Temporäre Mitglieder erhalten keine Campaign-weite Activity, sondern nur ihre autorisierte Field Group/Field Session und die eigenen temporären Comment-Events;
- unbekannte Eventtypen werden ausgelassen, unbekannte Ziele erhalten einen generischen Fallback. Rohes `payload_json`, Actor-Referenzen, Secrets, Tokens, Cookies, Session-Hashes, Room-/QR-Credentials, IPs, GPS und Snapshots verlassen den Worker nicht;
- das normale Produkt erreicht Activity über das kompakte Launcher-Sheet mit Loading, Empty, Error/Retry, Offline-Read-Hinweis und `Mehr laden`. Bereits geladene Einträge bleiben bei Offline-Wechsel sichtbar, neue Reads benötigen Internet;
- es gibt keine neue Activity-Tabelle, keine Rollup-Kopie und keinen zweiten Sync-/Queue-Mechanismus. Schemafehler liefern explizit 503, solange die vorbereitete 0007-Grundlage nicht vorhanden ist.

### Grenzen

- keine GPS-Route;
- keine vollständigen Snapshot-Kopien pro Event;
- keine unrestricted Request Bodies im Eventlog;
- Security/Audit bleibt bei Bedarf getrennt vom normalen Produkt-Activity-Feed.

## FC3: Stats

Feature complete umfasst:
- Campaign-Fortschritt;
- Team-Fortschritt;
- Area-Fortschritt;
- Streets und Houses separat;
- offene/restliche Arbeit;
- Einsätze, Dauer, Teilnehmer, Person-Time;
- Session-Historie;
- optionaler Kartenfokus/Highlight.

Regeln:
- jede Prozentzahl benennt ihren Nenner;
- Distribution und Collection bleiben getrennt;
- keine Team-/Worker-Rangliste;
- keine GPS-basierte Produktivitätsmetrik;
- zunächst aus Source State plus Sessions/Events berechnen, Rollups erst bei gemessenem Bedarf.

## FC4: Smart Streets + Houses

Feature complete umfasst:
- reale Straßen auswählen/generieren statt Highlighter-Tracing;
- Area zu passenden Straßen-/Segmentvorschlägen;
- stabile Street-Snapshots;
- House Polygon Layer in MapLibre;
- ein oder mehrere Häuser auswählen;
- klare Street-/House-Modi;
- Parent-Street-Bezug;
- offline-resiliente Statusänderungen;
- Dichte-/Performance-Tests;
- manuelles Zeichnen nur als Fallback.

Migrationen 0004/0005 bleiben bis zum bewussten Rollout unangetastet.

## FC5: Collection / Pickup

- expliziter Distribution-/Collection-Modus;
- separate Pickup-Persistenz;
- Straßenabschnitte gefahren/fertig;
- Häuser/Adressen als Pickup Tasks;
- manuelle Meldeadressen;
- open/collected/unavailable/follow-up;
- Field Groups auch in Collection;
- separate Stats;
- keine Überschreibung von Distribution-Status.

## FC6: Organizations + Identity + Permissions + Admin

Erst nach expliziter Akzeptanz von ADR-0015, Threat Model und ADR-0016.

Umfasst:
- username/password/TOTP;
- sichere Recovery;
- revocable Account Sessions;
- mehrere Admins/Organizer;
- Capability Registry;
- Team-/Campaign-/Organization-Scopes;
- deny-by-default Worker-Autorisierung;
- desktop-first Admin;
- sicheren Team-Lifecycle inklusive Archive/Restore/Permanent Delete nach akzeptierter Retention-Semantik.

## FC7: Actions, Templates und Analytics

Nach ADR-0018-Akzeptanz:
- persistente Distribution-/Collection-Templates;
- neue Action aus Vorlage oder leer;
- frische operative IDs/History;
- Template Import/Export;
- Archive;
- privilegierter Permanent Delete;
- tenant-scoped Analytics Export;
- repeated-action comparison.

Keine automatische AI-Ausführung und keine AI-gesteuerten Berechtigungen.

## FC8: Settings + Support + Appearance

Settings:
- Campaign-Fokus/Startansicht;
- vorbereitete Offline-Arbeitsfläche;
- Sprache;
- System/Light/Dark;
- capability-gesteuerte Campaign-Einstellungen.

Support:
- Hilfe/FAQ;
- Version/Environment;
- Feedback/Bugreport;
- nur sichere optionale Kontextdaten;
- keine Secrets/Tokens/TOTP/GPS-History automatisch anhängen.

## FC9: Hardening und Release

Vor Plattform-Feature-Complete:
- reale Android-/iPhone-Tests;
- Desktop Admin;
- 500/1000/2500/5000 Streets plus House-Dichte;
- Session/Event-Historie unter Last;
- schlechte Verbindung, Reconnect und Revocation;
- Security Matrix für Identity/Permissions/Join Codes;
- XSS/CSRF/SQL-Injection/Tenant-Isolation;
- Accessibility/Reduced Motion;
- Recovery-/Deployment-Runbooks;
- exakter Release-Head plus Cloudflare-Verifikation.

## Branch-/PR-Strategie

- keine neue Serie dauerhaft offener Workbench-Preview-PRs;
- Feature-Slices bleiben klein genug für Review, aber end-to-end im Produktziel;
- Security-ADR/Threat-Model darf separat vor Runtime landen;
- Migrationen werden vorbereitet, getestet und separat remote ausgerollt;
- gestapelte PRs werden vor großen Folgeslices bewusst integriert/retargeted;
- experimentelle Workbench-Linien bleiben historisch und werden nicht parallel als Produktlinie fortgeführt.

## Unmittelbare Reihenfolge

1. Für jeden weiteren PR-Commit den exakten Head erneut durch CI verifizieren.
2. 0006/0007/0008 **nicht** remote anwenden, bis ein expliziter Rollout beauftragt ist.
3. Deterministische Automations mit explizitem Trigger/Effekt und Idempotenz anbinden.
4. Stats aus echten Tasks/Sessions/Events abschließen.
5. Anschließend FC4 bis FC9.

## Risiken

- Feature complete darf nicht zu einem monolithischen, unreviewbaren PR werden.
- Credentials und Account Identity bleiben echte Sicherheitsgrenzen.
- zu frühe Realtime-Infrastruktur erhöht Komplexität ohne bewiesenen Nutzen;
- UI-Rechte ersetzen niemals Worker-Autorisierung;
- Statistics dürfen Street/House/Collection-Einheiten nicht irreführend vermischen;
- retained history macht Archive/Delete-Semantik dauerhaft relevant;
- Team-Lifecycle darf nicht über Legacy-Snapshot-/Grant-Grenzen improvisiert werden.

## Nicht-Ziele

- keine native App;
- keine installierbare PWA;
- kein Service Worker;
- kein Background Sync;
- kein öffentliches Gruppenverzeichnis;
- kein Continuous-GPS-Tracking;
- keine Client-only Authorization;
- kein All-at-once-D1-Schema;
- keine sichtbare Foundation-Oberfläche als Ersatz für ein fertiges Feature.
