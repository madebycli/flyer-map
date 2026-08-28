# Prompt - Continue Feature-Complete Platform

Dieser Living Handoff gehört zur Plan-017-Linie und muss bei jedem weiteren langen Entwicklungschat erneut auf den exakten Repository-, PR- und CI-Stand aktualisiert werden.

```text
Du arbeitest weiter am GitHub-Projekt `madebycli/flyer-map` (Verteil-Flyer / Flyer Map).

DAS REPOSITORY IST DIE EINZIGE SOURCE OF TRUTH.
Prüfe Branch, PR, Migrationen, Remote-D1-Status, Dateien und CI neu. Angaben aus diesem Handoff sind ein verifizierter Ausgangspunkt, aber kein Ersatz für die erneute Prüfung des aktuellen Repository-Stands.

BEVOR DU ÄNDERST

1. Lies `AGENTS.md` vollständig.
2. Lies `docs/status/CURRENT.md` vollständig.
3. Lies `docs/context-map.yaml` vollständig.
4. Lies `docs/plans/active/017-feature-complete-platform.md` vollständig.
5. Lies `docs/architecture/COLLABORATION.md` und die für den nächsten Slice relevanten ADRs.
6. Lies `docs/product/PRODUCT.md`, `docs/product/UX.md` und `docs/product/ROADMAP.md`.
7. Prüfe PR #72 inklusive Base, Head, Draft-Status und Mergeability sowie den aktuellen CI-Lauf des exakten Heads.
8. Prüfe den gestapelten Base-PR #71, falls der Stack den nächsten Slice beeinflusst.
9. Prüfe vor jeder D1-Arbeit den dokumentierten Remote-Migrationsstand. 0004 bis 0009 sind nur vorbereitet, solange GitHub und Doku nichts anderes belegen.

VERIFIZIERTER CHECKPOINT VOR DIESEM DOKU-/HANDOFF-COMMIT

- Branch: `plan-feature-complete-platform`;
- PR #72: `FC0-FC2: Platform, Live Field Groups and Field Sessions`;
- PR #72 Base: `ui-app-launcher-sheet`;
- PR #72 Base-SHA: `48843793184650bd96039f0e3b073f60aebb068a`;
- PR #72 Head-Branch: `plan-feature-complete-platform`;
- PR #72 Head vor diesem Doku-/Handoff-Commit: `6d8a54f30cfcd5ffa1fc0262e0fdf505b3c0fe8e`;
- PR #72 ist offen, Draft und mergeable;
- GitHub Actions CI #700 auf genau diesem Head: erfolgreich;
- CI-Check `98978406286`: Tests, TypeScript, Dependency Audit und Production Build erfolgreich.

Der nachfolgende Doku-/Handoff-Commit verschiebt den Branch-Head. Nach diesem Commit muss der tatsächliche neue Head erneut mit vollständiger CI geprüft und in PR #72 sowie beim nächsten Handoff festgehalten werden. Ein älterer grüner Head darf nicht als finaler Nachweis verwendet werden.

PR #72 bleibt Draft. Nichts mergen, PR nicht auf Ready for Review setzen und nichts explizit deployen.

AUTOMATISCHE CLOUDFLARE-PREVIEW-HINWEISE

Die bestehende Git-Integration kann nach Branch-Commits automatisch einen Cloudflare-Preview-Kommentar in PR #72 aktualisieren. Das ist Integrationsverhalten und kein von diesem Arbeitsauftrag explizit ausgelöster Deployment-Rollout.

Beim zuletzt verifizierten Runtime-Head `6d8a54f30cfcd5ffa1fc0262e0fdf505b3c0fe8e` zeigte der Kommentar:
- Commit Preview: `https://faf8eb71-flyer-map.cloudflare-eleven035.workers.dev`;
- Branch Preview: `https://plan-feature-complete-platform-flyer-map.cloudflare-eleven035.workers.dev`.

Wenn die Git-Integration nach einem neuen Commit erneut kommentiert, prüfe Commit-SHA, Preview-Status und URLs gegen den exakten Branch-Head. Interpretiere den Preview-Kommentar nicht als Nachweis, dass eine vorbereitete D1-Migration remote angewendet wurde. Führe keinen manuellen `wrangler deploy` aus.

MIGRATIONSSTATUS

Remote-D1 ist weiterhin nur bis 0003 dokumentiert.

Vorbereitet, aber NICHT remote angewendet:
- 0004: Smart Street source provenance;
- 0005: House Tasks;
- 0006: Field Groups, Credentials, Memberships und FC1-Idempotency;
- 0007: Field Sessions und minimierte Domain Events;
- 0008: durable Comments und Comment-Tombstones;
- 0009: deterministische Automation-Konfiguration.

0004 bis 0008 müssen weiterhin ausdrücklich als nicht remote angewendet gelten, sofern die erneute Repository-/D1-Prüfung nichts anderes beweist. Keine Migration remote anwenden und keinen Rollout durchführen, solange der User dies nicht ausdrücklich beauftragt.

FC0 STATUS

FC0 Navigation/Action-Bridge ist im normalen Produkt umgesetzt:
- typisierter PlatformShell-/App-Contract;
- aktiver Karten-Teamname im Launcher-Kontext;
- capability-/scope-gesteuerte Settings, Teamverwaltung und Gebietsaktionen;
- `Team` öffnet den echten Team Hub;
- Launcher-Ziele werden im Production-Graph geprüft, nicht nur über Workbench-Dateien.

FC1 STATUS

Der Live-Field-Group- und Team-Hub-Slice ist umgesetzt:
- Campaign-scoped aktive Field Groups und canonical Team-Scope;
- Admin und eigener Team Editor als Managementrollen;
- idempotente Creation mit Payload-Bindung;
- human-safe Room Code und separater QR-Token, nur Hashes in D1;
- Rotation, Revoke, Room-Code-Join und QR-Join;
- Cloudflare Actor-/Candidate-Rate-Limits mit fail-closed Verhalten;
- temporäre `vf_field_group_session` nur für den Campaign-/Team-/Group-Scope;
- kein Rollen-Upgrade, keine persistenten Rechte durch temporäre Membership;
- Participant Count, Discoverability, Leave und Manager Remove;
- serverseitige 24h-Hard-Expiry;
- Folgezugriffe prüfen revoked/removed/closed/expired erneut serverseitig;
- autorisierte Manager-Memberliste mit minimalen Metadaten.

FIELD SESSIONS

ADR-0017 ist accepted. Migration `0007_field_sessions_events.sql` ist vorbereitet und nicht remote angewendet.

Die Runtime persistiert Field Sessions und minimierte `domain_events` für:
- `field_session.closed`;
- `field_session.expired`;
- autorisierte Session-/Task-Kontexte;
- Dauer, explizite Teilnehmer und Person-Time, soweit sicher bekannt.

Bei Expiry ohne bekannte Teilnehmer bleiben Teilnehmer und Person-Time `NULL`. Es gibt keine GPS-Trails, keine Credentials und keine vollständigen Campaign-Snapshots. Normaler Group-Close wird mit `field_session_schema_unavailable` blockiert, solange die vorbereitete Schema-Grundlage fehlt. Group-Endzustand und Session-/Event-Historie liegen in derselben D1-Transaktion.

FC2 STATUS

Kommentare

Der durable Comment-Slice ist umgesetzt und verwendet Migration 0008:
- Kontexte: Campaign, Area, Street Task und persistierbare House Tasks;
- bounded context reads sowie Create, Edit und Soft Delete;
- Body trimmen, leer ablehnen, maximal 2000 Zeichen;
- inert gespeicherter Text, keine HTML-/Markdown-Ausführung;
- Worker als authoritative Boundary, Campaign-/Team-/Target-Isolation und Same-Origin-Write-Schutz;
- Viewer read-only, Team Editor nur eigener canonical Team-Scope;
- temporäre Mitglieder nur exakt im autorisierten Campaign-/Team-/Group-Kontext;
- Legacy-Identity wird nicht zu einer erfundenen Person erweitert. Self-Edit/Self-Delete bleibt konservativ eingeschränkt, wenn eine sichere Autor-Zuordnung fehlt;
- Löschen erzeugt einen Tombstone mit `Kommentar gelöscht`, ohne normalen Hard Delete;
- `comment.created`, `comment.edited`, `comment.deleted` mit minimaler normalisierter Payload und Retry-Dedupe;
- Schreiben ist online-only. Bereits geladene Kommentare bleiben offline sichtbar; es gibt keine falsche Erfolgsmeldung und keine zweite Queue-Architektur.

Activity

Activity ist kein zweites Eventsystem, sondern eine bounded Campaign-scoped Projektion der persistierten `domain_events`.

Echte unterstützte Eventtypen:
- `field_session.closed`;
- `field_session.expired`;
- `task.status.changed`;
- `comment.created`;
- `comment.edited`;
- `comment.deleted`;
- `automation.executed`.

Contract:
- `GET /api/campaigns/:campaignId/activity`;
- Default-Limit 30, hartes Maximum 50;
- newest-first über `occurred_at DESC, id DESC`;
- stabiler Cursor ohne langfristig wachsenden OFFSET-Read;
- optionaler Teamfilter nur gemäß bestehender Access-Semantik;
- Unknown Events werden bewusst ausgelassen, unbekannte Ziele erhalten sichere generische Darstellung;
- unbekannte Entity-Zustände zerstören den Feed nicht;
- normale Launcher-Fläche `Aktivität` mit Loading, Empty, Error/Retry, Offline-Read-Hinweis und `Mehr laden`;
- bereits geladene Activity bleibt offline sichtbar, neue Reads benötigen Internet.

Die Activity-DTO-Allowlist enthält nur Event-ID, Eventtyp, Zeit, sichere Team-/Session-/Entity-Selektoren, Actor-Kategorie und typisierte minimale Details. Sie gibt niemals rohes `payload_json`, `actor_ref`, Kommentartext, Cookies, Tokens, Session-Hashes, Join-Credentials, Room Codes, QR-Tokens, IPs, Request-Bodies, GPS oder vollständige Snapshots aus. Actor-Ausgaben bleiben bei sicheren Kategorien wie `Campaign-Zugriff`, `Temporäre Gruppe`, `System` oder unbekannter sicherer Kategorie.

Stats

Der erste echte Statistics-Slice ist umgesetzt. Stats ist eine begrenzte Server-Projektion des autoritativen Campaign-Zustands, der Field-Session-Daten und der normalisierten `domain_events`; es gibt keine Activity-/Stats-Rollup-Tabelle und keine clientseitig erfundene Historie.

Contract und Projektion:
- `GET /api/campaigns/:campaignId/stats`;
- Admin und Viewer lesen normale operative Campaign-Stats Campaign-weit;
- Team Editor bleibt auf den canonical eigenen Team-Scope begrenzt;
- temporäre Field-Group-Mitglieder erhalten keine Campaign-weite Statistik, sondern nur den exakt autorisierten Group-/Session-Scope und den eigenen Team-Arbeitsbereich;
- Campaign, Team und Area werden serverseitig aufgelöst;
- Straßen- und Hausaufgaben haben getrennte Nenner und Fortschrittswerte; Hauswerte bleiben als unavailable markiert, wenn das vorbereitete House-Schema fehlt;
- Einsätze werden getrennt nach Distribution/Collection mit Dauer, bekannten Teilnehmern, Person-Time und betroffenen Aufgaben aggregiert;
- die Liste der letzten Einsätze ist auf 20 Einträge plus Truncation-Hinweis begrenzt;
- Fortschrittsänderungen aus `task.status.changed` sind auf ein 90-Tage-Fenster und sichere Aggregate begrenzt;
- Pickup-Statistiken werden nicht simuliert, solange kein echtes persistentes Pickup-Modell existiert.

Privacy und Performance:
- SQL bleibt prepared/parameterized; Scope, Campaign und Group-/Session-Beziehungen werden ausschließlich im Worker autorisiert;
- fehlendes `field_sessions`-/`domain_events`-Schema liefert explizit 503 statt einer Ersatzsemantik;
- die Antwort enthält nur ein versioniertes allowlistiertes DTO. Rohes `payload_json`, Actor-Referenzen, Kommentartext, Notes, Cookies, Tokens, Hashes, Room Codes, QR-Tokens, IPs, GPS-Daten und Snapshots werden nicht ausgeliefert;
- unbekannte oder fehlende Entity-Labels zerstören die Statistik nicht; es gibt sichere Fallbacks;
- Aggregationen und die begrenzte Recent-Session-Abfrage vermeiden unbounded Reads und N+1-Historienabfragen.

UI:
- normales Launcher-Ziel `Stats` im map-first Produkt;
- Loading, Empty, Error/Retry, Offline-Read-Verhalten und mobile-first Karten für Fortschritt, Teams, Areas, Einsätze und Verlauf;
- bereits geladene Stats bleiben offline sichtbar; neue Reads benötigen Internet und werden nicht als erfolgreich ausgegeben;
- `Einsätze` wird über die typisierte PlatformShell-Action geöffnet. House-Polygon-Fokus bleibt bis zum echten House-Renderer offen.

Deterministische Automations

ADR-0019 ist accepted. Der erste Runtime-Slice ist implementiert:
- feste Registry-Regel, Version 1: `complete-parent-street-when-all-houses-complete`;
- Admin-only `GET`/`PATCH /api/campaigns/:campaignId/automations` mit explizitem Boolean-Contract;
- Admin-only normales Launcher-Ziel `Automationen` mit Loading, Error/Retry, Migration-unavailable, Enabled/Disabled, Busy- und Offline-Zuständen;
- kein Script, keine SQL-Fragmente, keine beliebigen Bedingungen, keine Webhooks, keine Timer, kein Polling und keine AI-Automation.

Trigger und Effekt:
- ausschließlich nach erfolgreicher autorisierter M5-Mutation `house.set-status` mit resultierendem House-Status `completed`;
- Automation muss für die Campaign aktiviert sein;
- House und Parent Street müssen zur selben Campaign und Area sowie zum selben sicheren Team-Scope gehören;
- alle aktuell persistierten House-Kinder des Parent Streets müssen vorhanden und `completed` sein;
- mindestens ein Kind ist erforderlich;
- Parent Street muss exakt `open` sein;
- Parent Street wird atomar auf `completed` gesetzt und erhält `completed_at`/`updated_at` aus der Mutation;
- `later`, `not-deliverable` und bereits abgeschlossene Parent Streets werden nicht überschrieben;
- kein Auto-Reopen, keine Änderung von Tasks außer dem geschützten Parent-Status, keine Geometrie-/Label-/Source-/Provenance-Änderung.

Der Parent-Update, der normale `task.status.changed`-Eventpfad, `automation.executed` und die bestehende M5-Idempotenz liegen in derselben guarded D1-Batch. Mutation-ID/Fingerprint und Event-Dedupe verhindern bei Retry ein zweites Update oder zweite Events. Die Automation nutzt einen Field-Session-Kontext nur, wenn er eindeutig ist, sonst `NULL`.

Automatische Events verwenden den Actor `system` und minimale Payloads: Rule-/Effect-Identifier und Trigger-Entity-Referenz, keine Kommentare, Secrets, Credentials, Tokens, Session-Hashes, GPS-Daten, Request-Bodies oder Snapshots. Activity allowlistet `automation.executed` und projiziert nur sichere aktuelle Kontextlabels.

AUTHORIZATION

Der Worker bleibt die authoritative Boundary:
- IDs sind Selektoren und niemals Credentials;
- Campaign-Isolation ist serverseitig strikt;
- Admin darf Campaign-weit lesen und Automations konfigurieren/moderieren;
- Viewer darf normale operative Activity lesen, aber nicht schreiben oder konfigurieren;
- Team Editor bleibt auf dem canonical eigenen Team-Scope;
- temporäre Field-Group-Mitglieder bekommen weder Campaign-weite Activity noch Team-/Admin-Rechte;
- temporäre Activity ist mindestens auf die eigene autorisierte Group/Session sowie den eigenen Team-Arbeitsbereich begrenzt;
- temporäre Mitglieder dürfen die normale autorisierte House-Statusmutation und den daraus entstehenden Systemeffekt auslösen, aber keine Automation konfigurieren;
- Parent-/Target-/Area-/Team-/Session-Beziehungen werden serverseitig geprüft;
- protected writes prüfen Same-Origin/CSRF-Grenzen analog zu bestehenden Pfaden;
- SQL bleibt prepared/parameterized und Fehlerpfade fail closed;
- fehlendes vorbereitetes Schema liefert einen expliziten 503 statt einer stillen Ersatzsemantik.

OFFENE FC2-PUNKTE

- House-Polygon-Highlight ist weiterhin offen und hängt am echten normalen House-Renderer;
- Stats-Runtime und normale Launcher-Fläche sind umgesetzt und auf dem Runtime-Head durch vollständige CI verifiziert;
- Comment- und Automation-Writes bleiben bewusst online-only, solange der bestehende M5-Mutationsmechanismus nicht ohne zweite Sync-Architektur sicher wiederverwendet werden kann;
- sichere personenbezogene Autorauflösung bleibt bis zu einer echten Identity-/Organization-Grundlage konservativ eingeschränkt.

NÄCHSTER ENTWICKLUNGSSCHRITT

Wenn der exakte aktuelle PR-Head und seine vollständige CI weiterhin grün sind, prüfe als nächsten Slice das House-Polygon-Rendering im echten normalen Renderer. Automations nicht ausweiten, bevor ein expliziter Trigger-/Effekt-/Idempotenz-Contract und die jeweilige serverseitige Autorisierung vorliegen.

NICHT TUN

- nichts mergen und PR nicht Ready for Review setzen;
- nichts explizit deployen;
- 0004 bis 0009 nicht remote anwenden;
- keine neue Organization-/Account-Identity erfinden;
- keine Capability-Runtime vor akzeptierter ADR;
- keine PWA, keinen Service Worker und kein Background Sync;
- keine GPS-Historie;
- keine Activity-Duplikatdatenbank;
- keine AI-Automation;
- keine Comment-Hard-Deletes im normalen Produkt;
- keine UI-only-Berechtigung.

QUALITÄTSGATES

Vor jedem Abschluss:
- relevante Security-Negativtests;
- vollständige Testsuite;
- TypeScript;
- Dependency Audit;
- Production Build;
- PR-/Branch-Head und CI auf genau diesem Head;
- keine Regression bestehender Launcher-, M5-, Field-Session-, Comment- und Activity-Pfade.

VERPFLICHTUNG FÜR DEN NÄCHSTEN HANDOFF

Aktualisiere beim nächsten Handoff dieselbe Datei erneut mit:
- exaktem Branch und exaktem finalem Head;
- PR #72 Base, Head, Draft-Status und Mergeability;
- finalem CI-Lauf auf genau diesem Head;
- aktuellem Migration-/Remote-D1-Status;
- FC0-, FC1- und FC2-Stand;
- offenen Punkten und konkretem nächsten Schritt;
- aktuellen Security-/Authorization-Grenzen;
- erneutem Hinweis auf automatische Cloudflare-Preview-Kommentare, falls sie auftreten.

Die Doku muss den realen Repository-Stand beschreiben. Veraltete grüne Heads sind zu ersetzen, nicht als Nachweis weiterzuführen.
```
