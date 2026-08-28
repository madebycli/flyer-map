---
id: status-current
type: status
status: active
last_updated: 2026-08-28
---

# Current Project State

## Product baseline

Verteil-Flyer ist eine mobile-first normale Website.

Weiterhin ausdrücklich ausgeschlossen:
- native App Runtime;
- installierbare PWA;
- Service Worker;
- Web App Manifest;
- Background Sync;
- kontinuierliche GPS-Historie.

Die Feldkarte bleibt MapLibre GL JS 5.7.1 mit CARTO Online-Basemap. Vorbereitete Offline-OSM-Daten liegen separat im Browser-IndexedDB und bulk-cachen keine CARTO/OSMF-Tiles.

M4 Access/Session, M5 resilient mutation synchronization und M5.5 prepared offline map bleiben etablierte Grundlagen.

## Delivery direction

Plan 017 ist die aktuelle Delivery-Source-of-Truth für neue Produktfeatures.

Normale Launcher-Features zählen nicht als fertig, wenn sie nur aus Workbench, Fake-Daten oder lokalem React-State bestehen. Shared Features brauchen den vollständigen UI-/Persistenz-/Autorisierungs-/Fehler-/Test-Weg.

FC0, FC1 und der aktuelle FC2-Runtime-Slice liegen auf Draft PR #72, Branch `plan-feature-complete-platform`.

## Unified platform UI

Der normale Browse-Zustand verwendet weiterhin:
- kompakten 3x3 App-Launcher unten links;
- sichtbaren aktiven Teamnamen daneben;
- Teamfarbe nur als unterstützenden Marker;
- keine permanente Team-Auswahl;
- keine permanenten Settings-/Teams-/Gebiet-Buttons.

FC0 ist auf PR #72 umgesetzt:
- typisierte PlatformShell/App-Bridge;
- aktiver Teamname folgt dem realen Karten-Arbeitskontext;
- Settings, Teamverwaltung und Gebiet-Aktion bleiben capability-/scope-gesteuert erreichbar;
- `Team` öffnet den echten Team Hub;
- unfertige Foundation-Module bleiben interne Entwicklungseingaben und zählen nicht als Produktabschluss.

## FC1 Team Hub und Live Field Groups

ADR-0014 ist akzeptiert.

Der aktuelle FC1-Runtime-Slice umfasst:
- Team Hub als normales `Team`-Launcher-Ziel;
- realen Team-Fortschritt mit getrennten Street-/House-Nennern;
- Campaign-scoped aktive Gruppenliste plus Teamfilter;
- Admin und eigener Team Editor als aktuelle Managerrollen;
- Gruppen-Create mit Label, Team, Discoverability und Teilnehmerzahl;
- 10-stelligen human-safe Room Code;
- separaten 32-Byte-QR-Token;
- nur Hashes in D1, Plaintext nur bei Ausgabe/Rotation;
- idempotente Create- und Rotate-Request-IDs mit Payload-Bindung;
- QR- und manuellen Room-Code-Join;
- `vf_field_group_session` für temporäre Teilnehmer ohne persistenten Campaign-Zugriff;
- temporäre Autorisierung auf genau Campaign/Team/Group und erlaubte Task-Statusarbeit;
- Update Participant Count und Discoverability;
- Credential Rotate/Revoke;
- Leave und Manager Remove Membership;
- serverseitige 24h-Hard-Expiry;
- serverseitige Revocation auf geschützten Folgezugriffen;
- Cloudflare Actor- und Candidate-Rate-Limits mit fail-closed Verhalten.

### Manager member roster

Die FC1-Mitgliederverwaltung ist umgesetzt:
- aktiver Member-Roster nur für echte Gruppenmanager;
- Admin darf innerhalb der Campaign lesen/entfernen;
- Team Editor nur für Gruppen des eigenen canonical Team-Scope;
- Viewer und temporäre Mitglieder dürfen den Roster nicht verwalten;
- Ausgabe nur von Membership-ID, Membership-Typ, sicherer Bezeichnung und Join-Zeit;
- keine Session-Hashes, Join-Credentials, IPs oder Device Fingerprints;
- Remove mit expliziter Bestätigung;
- Gruppen-Membership-Count wird danach autoritativ neu geladen;
- Source-Guard schützt davor, dass das Panel wieder aus dem echten Team-Hub-Build verschwindet.

## FC2 Field Sessions und operative Historie

ADR-0017 ist akzeptiert.

`migrations/0007_field_sessions_events.sql` bleibt die dauerhafte Session-/Event-Grundlage:
- `field_sessions`;
- minimierte `domain_events`;
- deterministische Field-Group-zu-Session-Beziehung;
- aktive Session ab Gruppenstart;
- dedupliziertes `field_session.closed` bei manuellem Close;
- `field_session.expired` bei 24h-Sicherheitsablauf;
- Dauer, explizite Teilnehmerzahl und Person-Time;
- optionale Session-Notiz;
- unbekannte Teilnehmer/Person-Time bleiben bei vergessener Expiry `NULL` statt erfunden zu werden;
- keine GPS-Trails, Secrets oder vollen Campaign-Snapshots im Eventmodell.

Der Worker blockiert normalen Group-Close mit `field_session_schema_unavailable`, solange 0007 nicht vorhanden ist. Mit 0007 bindet SQLite den autorisierten `active -> closed` bzw. `active -> expired` Übergang transaktional an dieselbe Session-/Event-Historie.

### Reale Einsatzhistorie

Das Launcher-Ziel `Einsätze` verwendet jetzt echte serverseitige Field Sessions:
- Campaign-/Team-/temporärer Group-Scope wird im Worker erzwungen;
- stabile Cursor-Pagination;
- Dauer, Teilnehmer, Person-Time und Status;
- Anzahl unterschiedlicher betroffener Street-/House-Aufgaben wird aus `task.status.changed` Events mit deduplizierter Task-Identität abgeleitet;
- keine Fake-/Workbench-Historie als Produktzustand.

### Task-Event-Attribution

M5 `task.set-status` und `house.set-status` erzeugen bei erfolgreicher autoritativer Anwendung minimierte `task.status.changed` Domain Events:
- Event und Domain-Mutation teilen dieselbe Campaign-Revision-/Write-Token-Batchgrenze;
- Retry derselben M5-Mutation erzeugt kein zweites Event;
- temporäre Mitglieder werden nur ihrer serverbekannten Field Group/Session zugeordnet;
- bei mehreren möglichen persistenten Memberships wird keine Session geraten;
- Event-Payload enthält nur vorherigen und neuen Status plus notwendige Referenzen.

### Session auf der Karte

Eine Session kann aus `Einsätze` auf der Karte reflektiert werden:
- autorisierte, deduplizierte Task-Referenzen werden über einen eigenen bounded Read-Endpunkt geladen;
- aktuelle/reviewed Street-Geometrie wird in einer separaten MapLibre-Layer hervorgehoben;
- der normale Task-Auswahl-/Bearbeitungspfad bleibt unangetastet;
- das Highlight ist transient und kann wieder ausgeblendet werden;
- House-Events werden in Historie und Zählung berücksichtigt, aber nicht als Polygon-Highlight vorgetäuscht, solange der normale House-Polygon-Renderer aus FC4 noch fehlt;
- es wird keine Route oder historische Geometriekopie gespeichert.

### Session-Notizen

Session-Notizen sind jetzt Runtime-Funktion:
- `field_sessions.note` aus Migration 0007 wird verwendet, keine zusätzliche Migration erforderlich;
- maximal 1000 getrimmte Zeichen;
- leerer Text löscht die Notiz zu `NULL`;
- Text bleibt inert und wird als gebundener D1-Wert gespeichert;
- Admin darf Notizen aller Campaign-Sessions ändern;
- Team Editor nur Sessions des eigenen Teams;
- Viewer und temporäre Field-Group-Mitglieder bleiben read-only;
- Notizen bleiben offline lesbar, Änderungen sind online-only;
- die UI aktualisiert erst nach erfolgreichem Worker-Write.

### Durable Comments Runtime

Der aktuelle FC2-Comments-Slice ist als echter, serverautorisierter Runtime-Pfad umgesetzt:
- Campaign-, Area-, Street-Task- und House-Task-Kommentare werden dauerhaft in D1 gespeichert;
- Pickup bleibt bis zu einem echten persistenten Pickup-Modell ausgeschlossen;
- Body wird serverseitig getrimmt, auf 2000 Zeichen begrenzt und als inert gespeicherter React-/D1-Text behandelt;
- der API-Vertrag ist Campaign-scoped, target-scoped und cursor-paginiert mit einem Limit von höchstens 50 Einträgen;
- der Worker löst jedes Zielobjekt innerhalb der Campaign auf, bevor gelesen oder geschrieben wird;
- Admin darf innerhalb der Campaign moderieren;
- Team Editor darf nur im aktuellen eigenen Team-Scope moderieren;
- Viewer bleiben read-only;
- temporäre Mitglieder dürfen nur im aktuellen Campaign-/Team-/aktiven-Group-Scope erstellen;
- temporäre Mitglieder erhalten wegen der nicht zuverlässig auflösbaren Legacy-Identity keine Self-Edit-/Self-Delete-Sonderregel;
- dieselbe konservative Regel gilt für alle Legacy-Access-Grants, solange keine sichere Personenidentität existiert;
- Edit nutzt aktuelle Version/`updated_at`, Delete ist ein idempotenter Tombstone ohne physischen Hard Delete;
- gelöschte Kommentare geben im Produkt keinen Body mehr zurück und erscheinen sinngemäß als `Kommentar gelöscht`;
- normale Reads von gelöschten oder nicht mehr vorhandenen Zielobjekten failen geschlossen;
- `comment.created`, `comment.edited` und `comment.deleted` enthalten nur Ziel-/Actor-/Versionsmetadaten, niemals Kommentartext, Cookies, Secrets, Request-Bodies, GPS oder Snapshots;
- Create-/Edit-/Delete-Replays erzeugen keine zweiten Domain Events;
- der normale Produktpfad hängt am Launcher sowie an Area-, Street- und vorhandenen House-Kontext-Sheets;
- bereits geladene Kommentare bleiben offline sichtbar, neue Writes sind online-only und werden nicht fälschlich als gespeichert bestätigt.

### Noch offen in FC2

Noch nicht feature-complete:
- Activity Feed als Projektion normalisierter Domain Events;
- deterministische, autorisierte, idempotente Automations;
- House-Polygon-Highlight, sobald der normale FC4 House-Renderer vorhanden ist.

## Team lifecycle

Sicheres Team-Archivieren ist nicht als versteckte FC1-Nebenänderung umgesetzt.

Grund:
- das aktuelle Teammodell besitzt kein persistentes Archivstatusfeld;
- Team-Editor-Grants hängen an aktueller Team-Existenz;
- die Legacy-Snapshot-Kompatibilität beeinflusst aktuell mögliche Team-FKs und Delete-Semantik;
- retained Field Sessions/Events müssen verständlich bleiben.

Daher gibt es in FC1 weder neuen Team-Hard-Delete noch improvisiertes Archivieren.

Team Archive/Restore/Permanent Delete wird als eigener Team-Lifecycle-/Admin-Slice unter Organization/Permissions umgesetzt, nachdem Statusfeld, Area/Task-Verhalten, Grants, aktive Field Groups und retained history explizit geklärt sind.

## M6 Street und House persistence

ADR-0013 bleibt akzeptiert.

Prepared, aber nicht remote angewendet:
- `0004_m6_task_source_provenance.sql` für Street source provenance;
- `0005_m6_house_tasks.sql` für House Tasks.

Vor 0004 bleiben normale manuelle Street-Writes möglich, Smart-Street-Provenance-Writes failen explizit mit `schema_migration_required`.

Vor 0005 bleiben Street-Reads/Writes möglich, House-Writes failen explizit vor Revision Claim.

House Rendering als normaler batched MapLibre-Layer bleibt FC4-Arbeit.

## D1 rollout status

Dokumentierter Remote-Stand bleibt nur 0001 bis 0003.

Prepared, aber nicht remote angewendet:
- 0004: Smart Street provenance;
- 0005: House Tasks;
- 0006: Field Groups, Credentials, Memberships und FC1 Idempotency;
- 0007: Field Sessions und minimierte Domain Events;
- 0008: durable Comments und Comment-Tombstones.

Kein Runtime- oder Dokumentationscommit wendet diese Migrationen automatisch an.

## Security/release gates

Weiterhin verbindlich:
- Worker ist authoritative Authorization Boundary;
- IDs sind Selektoren, keine Credentials;
- SQL ist prepared/parameterized;
- untrusted Text bleibt inert;
- Join-/Session-/Access-Secrets werden weder geloggt noch als Produktdaten exponiert;
- keine IP-Persistenz aus Join Rate Limiting;
- temporäre Membership erweitert keinen persistenten Role-Scope.

Letzter vollständig verifizierter Runtime-Checkpoint:
- Head `7f9dd9682687f20d7f09ff665975f387a2f18961`;
- CI #687 erfolgreich;
- Tests, Typecheck, Dependency Audit und Production Build grün;
- dieser Lauf enthält den durable Comments Runtime-Slice mit API-Authorization, Tombstones, minimalen Comment-Events, Pagination und Produktions-UI-Pfad.

Dokumentationscommits nach diesem Runtime-Checkpoint müssen auf ihrem eigenen exakten Head erneut grün werden, bevor PR #72 promotet wird.

## Architecture blockers for later work

Noch nicht autorisiert:
- Organization username/password/TOTP runtime vor ADR-0015-Akzeptanz plus Threat-Model-Review;
- configurable capability runtime vor ADR-0016-Akzeptanz;
- durable Action/Templates/Cross-Action Analytics vor ADR-0018-Akzeptanz;
- Team Archive/Delete ohne eigenen Lifecycle-Slice;
- Service Worker/PWA/Background Sync;
- kontinuierliche GPS-Historie.

ADR-0014 und ADR-0017 sind akzeptiert und keine Blocker mehr für ihre aktuellen FC1-/FC2-Slices.

## Immediate next

1. Comment-Events nach der festgelegten Semantik in die normale Activity-Historie aufnehmen.
2. Activity Feed aus normalisierten Domain Events aufbauen.
3. Deterministische Automations mit explizitem Trigger/Effekt und Idempotenz anbinden.
4. House-Polygon-Highlight erst mit dem normalen FC4 House-Renderer ergänzen.
5. 0004 bis 0008 weiterhin nicht remote anwenden, solange kein expliziter Rollout beauftragt ist.
