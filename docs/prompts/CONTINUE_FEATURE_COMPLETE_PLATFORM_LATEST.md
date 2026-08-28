# Prompt - Continue Feature-Complete Platform

Use this prompt for the next fresh AI coding chat. It is the living handoff for the current Plan-017 development line.

```text
Du arbeitest weiter am GitHub-Projekt `madebycli/flyer-map` (Verteil-Flyer / Flyer Map).

DAS REPOSITORY IST DIE EINZIGE SOURCE OF TRUTH.
Prüfe Repository, GitHub, PRs, Branch-Heads und CI neu. Die konkreten Heads in diesem Prompt sind nur der letzte bekannte verifizierte Stand.

PRODUKTBASIS

Verteil-Flyer ist eine Mobile-First normale WEBSITE.

Keine native App.
Keine installierbare PWA.
Kein Service Worker.
Kein Web-App-Manifest-Installationsflow.
Kein Background Sync API.
Keine kontinuierliche GPS-Routenaufzeichnung.

BEVOR DU IRGENDETWAS ÄNDERST

1. Lies `AGENTS.md` vollständig.
2. Lies `docs/status/CURRENT.md` vollständig.
3. Lies `docs/context-map.yaml` vollständig.
4. Lies `docs/product/ROADMAP.md` und `docs/product/UX.md`.
5. Lies `docs/plans/active/017-feature-complete-platform.md` vollständig.
6. Lies diesen Prompt vollständig.
7. Prüfe Draft PR #72, Branch `plan-feature-complete-platform`, Base `ui-app-launcher-sheet`, exakten Head, Mergeability und CI.
8. Prüfe den gestapelten Base-PR #71 und weitere offene PRs, wenn sie den aktuellen Stack beeinflussen.
9. Folge dem Context-Graph zu den für den nächsten Slice relevanten Architecture-/ADR-Dateien.
10. Prüfe vor jeder D1-Arbeit den dokumentierten Remote-Migrationsstand.

AKTUELLER VERIFIZIERTER CHECKPOINT

Zuletzt vollständig verifizierter Runtime-Head vor diesem Doku-/Handoff-Commit:
- PR #72: Draft, mergeable;
- Branch: `plan-feature-complete-platform`;
- Base: `ui-app-launcher-sheet`;
- Head: `3e72c398f4af7fadfc779bb0f4ed95d422e53d8d`;
- CI #689: erfolgreich;
- Tests, Typecheck, High-Severity Dependency Audit und Production Build: grün;
- dieser Head enthält die echte Activity-Projektion aus `domain_events`, serverseitige Scopes, Privacy-Allowlist, Cursor-Pagination und den normalen Launcher-Pfad.

Der nachfolgende Doku-/Handoff-Commit ändert den Head danach erneut. Verifiziere deshalb zuerst den tatsächlichen aktuellen Head und dessen CI, bevor du weiterentwickelst.

LETZTER VOLLSTÄNDIG VERIFIZIERTER DOKUMENTATIONS-/HANDOFF-CHECKPOINT

- Head: `3da335c239affbde68c9405491f656fcae953f03`;
- CI #691: erfolgreich, inklusive Tests, TypeScript, High-Severity Dependency Audit und Production Build;
- PR #72: Base `ui-app-launcher-sheet`, Head-Branch `plan-feature-complete-platform`, Draft, mergeable.

Dieser Handoff-Text wird mit dem nachfolgenden Aktualisierungscommit auf diesem verifizierten Head fortgeschrieben. Nach jeder solchen Handoff-Aktualisierung muss der dann exakte Branch-Head erneut über die vollständige CI geprüft werden.

PR #72 heißt aktuell:
`FC0-FC2: Platform, Live Field Groups and Field Sessions`

AUTOMATIC CLOUDFLARE PREVIEW

Die Git-Integration kann nach einem neuen Branch-Commit automatisch einen Cloudflare-Preview-Kommentar mit Commit- und Branch-URL erzeugen. Das ist erwartetes Integrationsverhalten und kein von diesem Arbeitsauftrag explizit ausgelöster Deployment-Rollout. Für den aktuellen Doku-Head `827a8969` wurde der bestehende Kommentar mit erfolgreichem Preview aktualisiert: Commit-Preview `https://e7f2346c-flyer-map.cloudflare-eleven035.workers.dev`, Branch-Preview `https://plan-feature-complete-platform-flyer-map.cloudflare-eleven035.workers.dev`. Bei einem neuen Preview-Kommentar nur Commit/Branch und Status gegen den exakten Head prüfen.

FC0 STATUS

FC0 Navigation/Action-Bridge ist umgesetzt:
- typisierter PlatformShell/App-Contract;
- der sichtbare Teamname folgt dem aktiven Karten-Team;
- Settings, Teamverwaltung und Gebiet-Aktion bleiben capability-/scope-gesteuert erreichbar;
- `Team` öffnet den echten Team Hub statt eines Workbench-Previews;
- unfertige Foundation-Module zählen weiterhin nicht als abgeschlossenes Produktfeature.

FC1 STATUS

ADR-0014 ist accepted.

Der Team-Hub-/Live-Field-Group-Runtime-Slice ist umgesetzt:
- Campaign-scoped aktive Gruppen und Teamfilter;
- Admin und eigener Team Editor als aktuelle Managementrollen;
- Create mit Label, Team, Discoverability und Teilnehmerzahl;
- idempotente Create-Request-ID mit Payload-Bindung;
- 10-stelliger human-safe Room Code;
- separater 32-Byte-QR-Token;
- nur Credential-Hashes in D1, Plaintext nur bei Ausgabe/Rotation;
- idempotente Credential-Rotation;
- Revoke;
- manueller Room-Code-Join und QR-Join;
- Cloudflare Actor- und Candidate-Rate-Limits mit fail-closed Verhalten;
- temporäre `vf_field_group_session` für Teilnehmer ohne persistenten Campaign-Zugriff;
- temporäre Autorisierung nur für den Ziel-Team-/Group-Scope und freigegebene Task-Statusarbeit;
- kein Rollen-Upgrade durch Join;
- Participant Count und Discoverability Update;
- Leave und Manager Remove Membership;
- serverseitige 24h-Hard-Expiry;
- revoked/removed/closed/expired Zugriff wird bei Folgezugriffen serverseitig erneut geprüft;
- realer Team-Fortschritt im Team Hub.

MANAGER MEMBER ROSTER

Die zuvor offene Mitgliederverwaltung ist umgesetzt und im echten Produkt-Build importiert:
- server-authorisierte aktive Mitgliederliste;
- Admin innerhalb Campaign;
- Team Editor nur eigenes canonical Team;
- Viewer und temporäre Mitglieder ausgeschlossen;
- nur Membership-ID, Membership-Typ, sichere Bezeichnung und Join-Zeit;
- keine Session-Hashes, Join-Credentials, IPs oder Gerätefingerprints;
- Remove mit Bestätigung;
- Gruppenanzahl wird danach autoritativ neu geladen;
- `tests/fieldGroupMembersUi.test.ts` schützt davor, dass das Panel wieder nur als unimportierte Datei existiert.

FIELD SESSION FOUNDATION

ADR-0017 ist accepted.

Migration `0007_field_sessions_events.sql` ist vorbereitet:
- `field_sessions`;
- minimierte `domain_events`;
- deterministische eine Field Session pro Field Group Endzustand;
- `field_session.closed` bei manuellem Close;
- `field_session.expired` beim 24h-Sicherheitsablauf;
- Dauer, explizite Teilnehmer und Person-Time;
- bei Expiry ohne bekannte Teilnehmer bleiben Teilnehmer/Person-Time `NULL`;
- keine GPS-Trails, Secrets oder vollen Campaign-Snapshots.

Der Worker blockiert normalen Group-Close mit `field_session_schema_unavailable`, solange 0007 fehlt. Mit 0007 hängen Group-Endzustand und Session/Event-Historie in derselben D1-Transaktion.

MIGRATIONSSTATUS

Remote D1 ist weiterhin nur bis 0003 dokumentiert.

Prepared, aber NICHT remote angewendet:
- 0004: Smart Street source provenance;
- 0005: House Tasks;
- 0006: Field Groups, Credentials, Memberships und FC1 Idempotency;
- 0007: Field Sessions und minimierte Domain Events;
- 0008: durable Comments und Comment-Tombstones.

WENDE KEINE REMOTE D1-MIGRATION AN, außer der User fordert diesen Rollout ausdrücklich an.

TEAM LIFECYCLE

Baue in FC1 keinen improvisierten Team-Hard-Delete oder Fake-Archivstatus ein.

Das aktuelle Teammodell hat kein persistentes Archivstatusfeld. Team-Editor-Grants und Legacy-Snapshot-Kompatibilität beeinflussen Delete/FK-Semantik. Retained Field Sessions/Events müssen verständlich bleiben.

Team Archive/Restore/Permanent Delete gehört in einen eigenen Team-Lifecycle-/Admin-Slice unter Organization/Permissions. Vor Runtime müssen Statusfeld, Areas/Tasks, Grants, aktive Field Groups, History und Restore/Permanent-Delete-Semantik geklärt werden.

ACTIVITY STATUS

Activity ist auf dem verifizierten Runtime-Head eine echte Campaign-scoped Projektion der persistierten `domain_events`.

Unterstützte echte Eventtypen:
- `field_session.closed`;
- `field_session.expired`;
- `task.status.changed`;
- `comment.created`;
- `comment.edited`;
- `comment.deleted`.

Contract und Grenzen:
- `GET /api/campaigns/:campaignId/activity` mit Default 30, hartem Maximum 50, stabilem `occurred_at`-/ID-Cursor und optionalem Teamfilter nur für passende Rollen;
- Admin und Viewer Campaign-weit; Team Editor nur im canonical eigenen Team; temporäre Mitglieder nur eigene autorisierte Field Group/Field Session plus eigene temporäre Comment-Events;
- DTO-Allowlist ohne Rohpayload, Actor-ID, Kommentartext, Cookies, Tokens, Session-Hashes, QR-/Room-Credentials, IPs, GPS oder Snapshots;
- normales Launcher-Sheet mit Loading, Empty, Error/Retry, Offline-Read-Hinweis und `Mehr laden`;
- keine neue Activity-Tabelle, kein Rollup und kein zweiter Queue-/Sync-Mechanismus.

NÄCHSTER KONKRETER IMPLEMENTIERUNGSBLOCK: FC2-AUTOMATIONS

Wenn der exakte aktuelle PR-Head weiterhin grün und der Stack gesund ist, beginne direkt mit deterministischen Automations.

1. expliziten Trigger und Effekt definieren;
2. serverseitige Autorisierung für jede Automation prüfen;
3. idempotente Ausführung und sichtbare Fehler-/Activity-Referenz bauen;
4. keine AI-Automation.

RELEVANTE ARCHITEKTUR FÜR FC2

Lies insbesondere:
- `docs/architecture/COLLABORATION.md`
- `docs/architecture/LIVE_TEAMS.md`
- `docs/architecture/SECURITY.md`
- `docs/architecture/OFFLINE_SYNC.md`
- `docs/architecture/DATA.md`
- `docs/decisions/ADR-0011-durable-mutation-queue-and-idempotency.md`
- `docs/decisions/ADR-0017-field-session-events-retention.md`

SPÄTERE SECURITY-GATES

Nicht vorzeitig implementieren:
- Organization username/password/TOTP/session runtime vor accepted ADR-0015 plus Threat-Model-Review;
- configurable capability runtime vor accepted ADR-0016;
- durable Action/Templates/Cross-Action Analytics vor accepted ADR-0018;
- Service Worker/PWA/Background Sync;
- continuous GPS history.

ARBEITSWEISE

- Repository und GitHub zuerst verifizieren, dann direkt implementieren.
- Frage nicht nach Dingen, die Repository/GitHub beantworten können.
- Erstelle keinen Ersatz-Branch für vorhandene Arbeit.
- Merge oder deploye nichts ohne klare Freigabe.
- Keine Remote-D1-Migration ohne ausdrücklichen User-Auftrag.
- Korrigiere stale Doku im selben Arbeitsgang.
- Halte Slices reviewbar, aber liefere vertikal vollständige Benutzerwege.
- UI-Rechte ersetzen niemals Worker-Autorisierung.

QUALITÄTSGATES

Vor jedem Abschluss:
- Tests grün;
- TypeScript grün;
- High-Severity Dependency Audit grün;
- Production Build grün;
- relevante Security-Negativtests grün;
- exakten aktuellen PR-/Branch-Head verifizieren.

HANDOFF AM ENDE JEDES LANGEN CHATS

Vor dem Ende eines längeren Entwicklungschats:
1. `docs/status/CURRENT.md` auf den exakten Stand bringen.
2. `docs/context-map.yaml` bei neuen/abgeschlossenen Architektur-/Plan-Knoten aktualisieren.
3. relevante Architecture-/Plan-Doku aktualisieren.
4. diesen Living Prompt `docs/prompts/CONTINUE_FEATURE_COMPLETE_PLATFORM_LATEST.md` mit exaktem PR/Branch/Head/CI/Migrationsstatus und nächstem Schritt ersetzen.
5. den finalen Handoff-Commit selbst nochmals per exact-head CI verifizieren.
```
