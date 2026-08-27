---
id: plan-017-feature-complete-platform
type: plan
status: active
last_updated: 2026-08-27
related: [plan-012-platform-app-expansion, plan-016-app-launcher-sheet, product-roadmap, product-ux, architecture-live-teams, architecture-collaboration, architecture-identity-permissions, architecture-organizations, ADR-0014, ADR-0015, ADR-0016, ADR-0017, ADR-0018, quality]
---

# Plan 017: Feature-Complete Platform Delivery

## Ziel

Die weitere Entwicklung von Verteil-Flyer wechselt von isolierten Foundation-/Preview-Slices auf vertikale, benutzbare Features.

Ein Modul gilt ab jetzt nicht mehr als geliefert, nur weil Domain-Modelle, lokale UI oder ein Workbench-Preview existieren. Ein normales Launcher-Ziel wird erst als fertiges Produktfeature behandelt, wenn der komplette Benutzerweg funktioniert: UI, Persistenz, Berechtigungen, Fehlerzustände, Synchronisation, Tests und Dokumentation.

Der nächste große Produktabschluss ist das Team-/Gruppensystem. Danach werden Sessions/Aktivität, Statistik, Smart Streets/Houses, Collection, Admin/Permissions, Aktionen/Analytics sowie Settings/Support nach demselben Feature-Complete-Maßstab abgeschlossen.

## Source of Truth / Baseline

Vor jeder Umsetzung aus diesem Plan:
1. `AGENTS.md` lesen;
2. `docs/status/CURRENT.md` lesen;
3. `docs/context-map.yaml` traversieren;
4. `docs/product/ROADMAP.md` und `docs/product/UX.md` lesen;
5. nur die zum Slice gehörenden Architecture-/ADR-Knoten laden;
6. aktuellen Code, offene PRs, Branch-Stack und CI prüfen.

Aktueller Branch-Stack zum Zeitpunkt dieses Plans:
- `release-platform-integration-2026-08-26` -> Draft PR #68 gegen `main`;
- `m6-house-persistence-runtime` -> Draft PR #70 gegen Release-Branch;
- `ui-app-launcher-sheet` -> Draft PR #71 gegen House-Branch;
- dieser Plan-Branch baut auf PR #71 auf.

Migrationen 0004 und 0005 bleiben bewusst nicht remote angewendet, bis ein eigener Rollout ausdrücklich freigegeben wird.

## Neue Delivery-Regel: kein Foundation-Feature im normalen Produkt

### Was nicht mehr als fertig zählt

Folgendes zählt nur als interne Vorbereitung:
- lokaler React-State ohne Worker/D1-Persistenz;
- `?workbench=`-Preview;
- Fake-Daten;
- Callback-only Join/Create/Save-Flows;
- UI, die zwar klickbar ist, aber keine autorisierte Serverfunktion besitzt;
- Backend ohne vollständige Benutzeroberfläche;
- ein Launcher-Eintrag mit `Foundation`- oder `Security-Gate`-Charakter im normalen Feldfluss.

Workbench-Routen dürfen als Entwicklungswerkzeug bestehen bleiben, sind aber kein Produktmeilenstein und werden normalen Nutzern nicht als fertige App angeboten.

### Definition Feature Complete

Ein Feature ist erst abgeschlossen, wenn alle zutreffenden Punkte erfüllt sind:
1. vollständiger Happy Path auf Mobile;
2. dauerhafte Server-/D1-Persistenz, sofern es Shared State ist;
3. Worker-seitige Autorisierung für jeden Read/Write;
4. M5-Queue/Idempotenz für offline-relevante Mutationen;
5. Loading-, Empty-, Error-, Revoked-, Conflict- und Retry-Zustände;
6. UI zeigt nur Aktionen, für die effektive Berechtigungen bestehen;
7. keine verlorenen Kernfunktionen durch Navigation/Redesign;
8. responsive Mobile- und Desktop-Darstellung;
9. Accessibility, Touch-Ziele und Reduced Motion;
10. Unit-/Integration-/Security-Tests auf der niedrigsten sinnvollen Ebene;
11. Production Build, Typecheck, Dependency Audit und Cloudflare Preview grün;
12. relevante Product-/Architecture-/CURRENT-/Context-Dokumentation aktualisiert;
13. keine sichtbare `Foundation`-Kennzeichnung im normalen Produkt.

## Verbindliches UI-System

Alle folgenden Features verwenden das mit Plan 016 festgelegte Design statt neue parallele Navigationsmuster einzuführen.

### Permanenter Karten-Chrome

Im normalen Browse-Zustand bleibt unten nur eine kompakte Launcher-Leiste:
- 3x3 App-Grid/Menu-Button;
- direkt daneben der aktive Teamname als Text;
- Teamfarbe nur als unterstützender Marker;
- keine permanente Team-Auswahl;
- keine permanenten Settings-/Teams-/Gebiet-Buttons.

Kontextuelle Area-/Street-/House-Sheets dürfen darüber liegen, wenn der Nutzer aktiv mit einem Objekt arbeitet.

### Launcher-Sheet

Das Menü bleibt ein kompaktes, abgerundetes Sheet in derselben visuellen Familie wie Settings-/Teams-Sheets:
- große App-Icons;
- kurze Labels darunter;
- keine Fullscreen-Home-Screen-Dashboard-Fläche;
- Module dürfen nach Auswahl eine eigene volle Fachoberfläche öffnen;
- Einträge sind capability-/scope-gesteuert;
- unfertige interne Module werden nicht als normale Ziele angezeigt.

### Einheitliche Fachoberflächen

Team, Gruppen, Stats, Einsätze, Feedback, Smart, Collection, Aktionen und Admin verwenden wiederkehrende Muster:
- klare Sheet-/Card-Hierarchie;
- kompakte Überschriften;
- Status zuerst, Aktionen darunter;
- destructive Aktionen deutlich getrennt;
- keine Desktop-Admin-Dichte im mobilen Feldfluss;
- keine neue große UI-Framework-Abhängigkeit.

## FC0: Navigation und Berechtigungs-Bridge abschließen

Bevor das Gruppensystem als echtes Feature startet, muss die neue Navigation funktional vollständig werden.

### Aufgaben
- `PlatformShell` erhält einen typisierten Action-/Navigation-Contract mit `App` statt versteckter DOM-Button-Proxies.
- Der angezeigte Teamname stammt aus dem tatsächlichen aktiven Karten-Team, nicht nur aus dem ersten/autorisierten Team-Fallback.
- Das Launcher-Menü wird aus einem zentralen, permission-aware Registry-Modell aufgebaut.
- Bestehende Kartenfunktionen werden wieder erreichbar, aber nicht permanent angezeigt:
  - Einstellungen;
  - Team/Teamverwaltung;
  - Gebiet anlegen, sofern berechtigt;
  - spätere weitere rollenabhängige Aktionen.
- `Team` darf nicht länger nur auf ein Workbench-Live-Group-Preview zeigen.
- normale Launcher-Ziele dürfen keine Fake-/Foundation-Oberfläche öffnen.

### Akzeptanz
- kein Core-Flow ist durch das Entfernen der alten Toolbar unerreichbar;
- Teamname entspricht dem aktuellen Karten-Arbeitskontext;
- Viewer sieht keine Bearbeitungsaktionen;
- Team-scoped Rollen sehen nur zulässige Aktionen;
- Admin-/Organizer-Aktionen erscheinen nur mit entsprechender effektiver Berechtigung.

## FC1: Team Hub + Live Field Groups feature complete

Dies ist der nächste priorisierte Produktabschluss.

### Produktstruktur

Der Launcher-Eintrag `Team` öffnet einen echten Team Hub. Er kombiniert dauerhafte Team-Kontexte mit temporären Einsatzgruppen, trennt die Konzepte aber sichtbar.

#### Team Hub Start
- aktuelles Team mit Name/Farbe und optionalem Datum;
- Team wechseln, wenn der Zugriff mehrere Teams erlaubt;
- Team-Fortschritt kompakt;
- aktueller Einsatz / aktuelle Field Group;
- aktive Online-Gruppen in der Aktion;
- Team-Filter;
- passende Verwaltungsaktionen nur bei Berechtigung.

#### Teamverwaltung
Feature-complete Teammanagement umfasst, soweit aktuelle/akzeptierte Berechtigungen es erlauben:
- Team erstellen;
- umbenennen;
- Farbe ändern;
- optionales Datum bearbeiten;
- Mitglieder/Einladungen später unter accepted capability runtime;
- Archivierung statt unbedachtem Hard Delete, sobald ADR-0017-Retention akzeptiert ist;
- klarer read-only Zustand für Viewer/temporäre Gruppenmitglieder.

### Live Group Benutzerwege

#### Gruppe erstellen
Ein berechtigter Nutzer kann:
- Team auswählen, nur aus server-seitig erlaubtem Scope;
- Gruppenname/Label setzen;
- `online anzeigen` standardmäßig aktiv lassen oder deaktivieren;
- Gruppe erstellen;
- danach Room Code und QR anzeigen;
- Teilnehmerzahl während der Tour setzen/ändern;
- Gruppe manuell schließen.

#### Gruppe finden
Im aktuellen Campaign-Kontext:
- Standardfilter `Alle in der Aktion`;
- optionaler Teamfilter;
- nur aktive discoverable Gruppen;
- Teamname/Farbe, Gruppenlabel, Joinbarkeit und sinnvoller Fortschrittskontext;
- niemals Join-Secrets in Discovery-Listen.

#### Gruppe beitreten
Unterstützt werden:
- manueller Room Code;
- QR-Join;
- manuelle Eingabe bleibt immer als Fallback bestehen, auch wenn Kamera/QR-Scan nicht verfügbar ist.

Ein Nutzer ohne bestehenden Campaign-Zugriff darf nach erfolgreicher Online-Einlösung eine temporäre server-revocable Field-Group-Session erhalten. Diese Session bleibt auf das benötigte Team-/Gruppenfeld beschränkt.

#### Aktive Gruppe
Nach Beitritt zeigt die UI:
- Team und Gruppenname;
- Status `aktiv`;
- Startzeit/Dauer;
- Teilnehmerzahl;
- Gruppen-/Teamfortschritt;
- Online-/Sync-Zustand;
- Verlassen bzw. Entfernen, soweit erlaubt;
- Schließen nur mit Management-Berechtigung;
- klaren Hinweis bei geschlossen/abgelaufen/revoked.

#### Tour schließen
- finale Teilnehmerzahl ist Pflicht;
- manuelles Schließen invalidiert neue Joins sofort;
- Gruppe wird `closed`;
- verbundene Field Session wird abgeschlossen;
- Dauer, Personen und Person-Time werden nachvollziehbar gespeichert;
- spätere Session-/Event-Verknüpfung folgt ADR-0017.

### ADR-0014 vor Runtime abschließen

Vor D1-/Credential-Runtime wird ADR-0014 explizit akzeptiert. Planempfehlung für die offenen Punkte:
- 10-stelliger human-safe Base32 Room Code beibehalten;
- separater QR-Token mit mindestens 128 Bit Entropie;
- Credential-Rotation ersetzt nur Credentials und verlängert niemals die ursprüngliche 24h-Gruppenfrist;
- bestehender Campaign-Zugriff kann einer Group-Membership zugeordnet werden, ohne eine zweite privilegiertere Identity zu erzeugen;
- Nutzer ohne Campaign-Zugriff erhalten eine separate temporäre Field-Group-Session;
- temporäre Standardrechte bleiben enger als ein persistenter Team Member: eigene Teamkarte lesen, zulässige Task-Statusarbeit im Ziel-Team, eigene Gruppen-/Session-Interaktion, keine Team-/Gebiets-/Invite-/Admin-Verwaltung;
- Route- und codebezogene Rate Limits plus generische Fehlerantworten;
- Audit Events für Create, Discoverability Change, Credential Rotate/Revoke, Join, Remove, Close, Expire, ohne Secrets.

Optionales Gruppenpasswort ist kein Blocker für die erste Feature-Complete-Version, solange Room Code und QR vollständig funktionieren. Wenn es später kommt, muss es einen akzeptierten Hashing-Ansatz wiederverwenden und darf niemals plaintext gespeichert werden.

### Persistenz/API

Nach ADR-Akzeptanz additive Tabellen nur für diesen Slice, voraussichtlich:
- `field_groups`;
- `field_group_join_credentials`;
- `field_group_memberships` bzw. temporäre Membership-Sessions;
- Verknüpfung zu `field_sessions`, sobald ADR-0017 akzeptiert ist.

Benötigte serverseitige Operationen:
- create/list/get group;
- update discoverability;
- update participant count;
- join via Room Code;
- join via QR token;
- rotate/revoke join credentials;
- leave/remove membership;
- close group;
- expire group server-side bei jeder relevanten Autorisierungs-/Read-/Join-Prüfung spätestens nach 24h.

Es darf kein Client-only Expiry oder Client-only Join geben.

### Synchronisation

- Group-/Session-Mutationen verwenden idempotente Serveroperationen;
- offline bereits autorisierte Arbeitsmutationen nutzen M5, soweit ihr Scope das erlaubt;
- neuer Join benötigt Online-Worker-Redemption;
- nach Reconnect stoppen revoked/closed/expired Sessions privilegierte Queue-Synchronisation sichtbar;
- kein WebSocket/Service-Worker-Zwang nur für „live“; gemeinsamer Zustand wird zunächst über den bestehenden Snapshot/API-Refresh sinnvoll aktualisiert, neue Realtime-Infrastruktur nur nach gemessenem Bedarf.

### Security-Akzeptanz
- Room Code nicht sequenziell;
- QR enthält keinen persistenten Campaign/Admin-Token;
- Join Secrets nie in Logs/Discovery/Analytics;
- Rate-Limit-/Brute-Force-/Expiry-/Revocation-Tests;
- Cross-Campaign und Cross-Team negative Tests;
- temporärer Member kann nie Teamverwaltung/Admin/Organizer erhalten;
- manuelles Close macht neuen Join sofort unmöglich;
- Rotation verlängert die 24h-Frist nicht.

## FC2: Field Sessions + Kommentare + Activity + Automations

Nach dem Team-/Gruppensystem wird Zusammenarbeit dauerhaft statt lokal.

### ADR-0017 abschließen
Vor Tabellen/Runtime werden entschieden:
- Aktion/Campaign archivieren vs permanent löschen bei retained history;
- Kommentar-Edit/Delete-Semantik;
- Security/Audit-Retention getrennt von normaler Activity, falls nötig;
- ADR-0018-Linkage für cross-action Analytics.

### Feature Complete
- Field Session manuell oder über Field Group starten;
- Dauer/Teilnehmer/Notiz;
- Task-Mutationen erhalten Session/Event-Bezug serverseitig;
- Session schließen und Historie anzeigen;
- Session auf Karte auswählen und betroffene aktuelle/reviewed Street-/House-Geometrie hervorheben;
- Kommentare auf Campaign/Area/Street/House/Pickup-Kontext dauerhaft speichern;
- Activity Feed aus echten Domain Events;
- Automations nur deterministisch/idempotent, mit sichtbaren Erfolgs-/Fehlerzuständen;
- Retry derselben M5-Mutation erzeugt kein doppeltes Event.

## FC3: Stats feature complete

Stats ersetzt reine Preview-Karten.

### Mobile
- Campaign-Fortschritt;
- Team-Fortschritt;
- Area-Fortschritt;
- Streets und Houses separat verständlich;
- offene/restliche Arbeit;
- Einsätze, Dauer, Teilnehmer, Person-Time;
- Session-Historie;
- optional Karte fokussieren/highlighten.

### Regeln
- jede Prozentzahl benennt ihren Nenner;
- Distribution und Collection bleiben getrennt;
- keine Worker-/Team-Rangliste;
- keine GPS-basierte Produktivitätsmetrik;
- zunächst aus Source State + Sessions/Events berechnen, Rollups erst bei gemessenem Bedarf.

## FC4: Smart Streets + Houses als echter Kartenworkflow

M6 gilt erst als abgeschlossen, wenn die vorhandene Persistenz auch im normalen Kartenprodukt benutzbar ist.

Feature Complete umfasst:
- reale Straßen auswählen/generieren statt Highlighter-Tracing;
- Area -> passende Straßenvorschläge/generierte Segmente;
- stabile Street-Snapshots;
- House Polygon Layer in MapLibre;
- ein oder mehrere Häuser auswählen;
- klare Street-vs-House-Modi;
- Parent-Street-Bezug;
- Statusänderungen offline-resilient;
- whole-city Dichte-/Performance-Tests;
- manuelles Zeichnen nur als Fallback.

Remote Migration 0004/0005 bleibt ein separater, explizit freizugebender Rollout.

## FC5: Collection / Pickup feature complete

- expliziter Distribution/Collection-Modus;
- separate Pickup-Persistenz;
- Straßenabschnitte gefahren/fertig;
- Häuser/Adressen als Pickup Tasks;
- manuelle Telefon-/Meldeadressen;
- open/collected/unavailable/follow-up;
- Field Groups funktionieren auch in Collection;
- eigene Stats;
- keine Überschreibung von Flyer-Status.

## FC6: Organizations + Identity + Permissions + Admin feature complete

Erst nach expliziter Akzeptanz von ADR-0015 + Threat Model + ADR-0016.

### Identity
- username/password/TOTP;
- sichere Recovery;
- server-revocable Sessions;
- mehrere Organizers/Admins;
- letzter Organizer geschützt;
- sichere Migration/Koexistenz mit Legacy Access Links.

### Permissions
- named role templates;
- Organizer/Admin/Team Member/Team Leader/Viewer;
- capability registry;
- Team-/Campaign-/Organization-Scopes;
- Worker deny-by-default;
- permission-aware Launcher und Admin UI.

### Desktop Admin
- Organizations;
- Aktionen;
- Teams;
- Areas;
- Mitglieder/Invites;
- Rollen/Rechte;
- Live Groups;
- Sessions/Stats;
- Activity/Audit;
- Support;
- Security/Accounts.

Admin bleibt desktop-first und wird nicht in den mobilen Kartenfluss gequetscht.

## FC7: Aktionen, Templates und Analytics feature complete

Nach ADR-0018-Akzeptanz:
- persistente Distribution-/Collection-Templates;
- neue Aktion aus kompatibler Vorlage oder leer;
- immer frische operative IDs/History;
- Template Import/Export;
- Archive;
- Organizer-only Permanent Delete;
- tenant-scoped Analytics Export;
- repeated-action comparison;
- keine automatische AI-Ausführung und keine AI-gesteuerten Rechte.

## FC8: Settings + Support + Appearance feature complete

### Settings
- Campaign-Fokus/Startansicht;
- vorbereitete Offline-Arbeitsfläche;
- Sprache;
- Appearance System/Light/Dark;
- weitere capability-gesteuerte Campaign-Einstellungen.

### Support/Feedback
- Hilfe/FAQ;
- Version/Environment;
- Feedback/Bugreport;
- sichere optionale Kontextdaten;
- niemals Secrets/Tokens/TOTP/GPS-History automatisch anhängen.

## FC9: Hardening und Release

Die Plattform gilt erst nach produktweitem Abschluss als feature complete:
- reale Android-/iPhone-Tests, auch langsamere Geräte;
- Desktop Admin;
- 500/1000/2500/5000 Streets + House-Dichte;
- Session/Event-Historie unter Last;
- schlechte Verbindung, Reconnect, Revocation;
- Security Matrix für Identity/Permissions/Join Codes;
- XSS/CSRF/SQL-Injection/Tenant-Isolation;
- Accessibility/Reduced Motion;
- Recovery/Runbooks;
- exakte Release-Head CI + Cloudflare Preview.

## Branch-/PR-Strategie

- Keine weitere Serie von dauerhaft offenen Workbench-Preview-PRs für normale Features.
- Pro Feature-Complete-Slice ein kleiner, klarer Integrationsbranch oder wenige logisch getrennte PRs, aber das Produktziel des Slices bleibt end-to-end.
- Security-sensitive ADR-/Threat-Model-Änderungen können separat vor Runtime gemergt werden.
- Migrationen werden vorbereitet, getestet und in eigener dokumentierter Operation remote ausgerollt.
- Gestapelte PRs werden vor dem nächsten großen Slice sauber integriert/retargeted, damit kein unübersichtlicher Workbench-Baum entsteht.
- Alte experimentelle Workbench-PRs werden nach bestätigter Integration geschlossen oder als historische Experimente markiert, statt parallel als vermeintliche Produktlinien offen zu bleiben.

## Empfohlene unmittelbare Reihenfolge

1. PR #70/#71 exact-head prüfen und Branch-Stack sauber integrieren/retargeten, ohne ungeprüften Main-Merge.
2. FC0 Navigation/Action-Bridge abschließen.
3. ADR-0014 offene Punkte final entscheiden und ADR explizit akzeptieren.
4. Team Hub UI im aktuellen Design fertig bauen.
5. Field Group D1/API/Credentials/Membership + Join/QR/Close end-to-end bauen.
6. ADR-0017 finalisieren und Field Session/Events direkt an das fertige Gruppensystem anbinden.
7. Stats aus echten Tasks/Sessions/Events abschließen.
8. Danach FC4 bis FC9 in der obigen Reihenfolge.

## Akzeptanz für diesen Plan

Dieser Plan ist erfüllt, wenn:
- normale Nutzer keine Foundation-/Fake-Module mehr als Produktfeature sehen;
- alle Launcher-Ziele entweder end-to-end funktionieren oder bewusst nicht angeboten werden;
- das Team-/Gruppensystem real über mehrere Geräte nutzbar ist;
- Sessions, Activity, Stats und Collection auf dauerhaften Daten beruhen;
- Admin/Identity/Permissions sicher und serverseitig umgesetzt sind;
- Smart Street/House der normale Kartenworkflow ist;
- das mobile UI durchgehend dem unteren Launcher-/Sheet-Design folgt;
- die Plattform die M10-Hardening-Gates besteht.

## Risiken

- „Feature complete“ darf nicht zu einem riesigen unreviewbaren PR führen. Vertikal vollständig bedeutet nicht monolithisch.
- Group Credentials und Account Identity sind echte Authentifizierungsgrenzen und dürfen nicht durch UI-Druck an ihren ADR-/Threat-Model-Gates vorbeigebaut werden.
- zu frühe Realtime-Infrastruktur kann Komplexität erhöhen, ohne Nutzwert zu liefern;
- Launcher-Rechte dürfen nicht zum Sicherheitsmechanismus werden;
- Statistics dürfen Street/House/Collection-Einheiten nicht irreführend vermischen;
- retained history macht Archive/Delete-Semantik dauerhaft relevant.

## Nicht-Ziele

- keine native App;
- keine installierbare PWA;
- kein Service Worker;
- kein Background Sync;
- kein öffentliches Gruppenverzeichnis;
- kein Continuous-GPS-Tracking;
- keine Client-only Authorization;
- kein all-at-once D1-Schema;
- keine weitere sichtbare Foundation-Oberfläche als Ersatz für ein fertiges Feature.
