# Flyer Map – Entwicklungsstand-Audit vom 2026-09-07

Status: **Re-Planning Snapshot / keine Production-Freigabe**  
Repository: `madebycli/flyer-map`  
Snapshot-Zeitpunkt: 2026-09-07  
Source-of-Truth-Regel: **GitHub Remote > CURRENT/Handoff > Context-Graph > Pläne > Chat-Historie**.

> WICHTIG: Alle SHAs und Run-IDs in diesem Dokument sind Übergabemarker. Jeder neue Agent muss Remote-Heads, PR-Status, exact-head CI, Workflow-Runs und Staging vor Änderungen erneut selbst verifizieren.

## 1. Executive Summary

Das Projekt ist technisch deutlich weiter als ein früher Prototyp, aber die Teilbereiche haben **unterschiedliche Reifegrade** und dürfen nicht als ein einziger „grüner“ Release-Kandidat betrachtet werden.

- **RxDB/D1-Sync (PR #74)**: Architektur und exact-head Engineering-Gates sind auf der separaten Sync-Linie weitgehend geschlossen. D1 bleibt kanonisch; RxDB ist der lokale operative Spiegel; Durable Object dient der Invalidation. Diese Linie ist nicht mit Production freigegeben.
- **Street/House Engine (PR #75)**: Der isolierte Engine-Branch hat eine saubere serverseitige Architektur, deterministische Street-Identität, getrennte Street-/House-Phasen und grüne Engineering-Gates. Das ist jedoch **kein Beleg für belastbare Produktakzeptanz auf großen realen Gebieten**. Die Nutzerbeobachtung, dass praktisch nur ein kleines Gebiet mit ungefähr zehn Straßen erfolgreich war, ist als **offener P0/P1-Produktbefund** zu behandeln.
- **Organizer/Admin + Field UI (PR #76)**: Umfangreiche Funktionalität ist implementiert und der aktuelle Product-Head ist CI-grün. Gleichzeitig zeigt die jüngere Commit-Historie eine hohe Dichte an Access-/Session-/Navigation-/Sheet-/Comments-Regressionsfixes. Der neueste isolierte Plan-031-Staging-Lauf ist vor Deploy/Browser-Akzeptanz am Gate `Verify feature Product CI` gescheitert. Der aktuelle Product-Head ist damit **CI-grün, aber für diesen Head nicht vollständig live-accepted**.
- **Security**: Das Repo besitzt bereits ein vernünftiges Server-Authority-Modell und dedizierte Threat-/Security-Dokumentation. Der Admin-Bereich ist trotzdem noch nicht als vollständig security-reviewed anzusehen. Besonders AuthN/AuthZ, Tenant-Isolation, Race Conditions, Recovery/Invite/TOTP, SQL-/D1-Grenzen, CSRF/CORS, XSS/CSP, Rate Limits, Secrets und High-Risk-Reauth brauchen einen adversarialen White-/Black-Box-Abschluss.
- **UI**: Der richtige nächste Schritt ist **kein weiterer großer Redesign-Chat**, sondern ein frischer, dedizierter UI-Repro-/Fix-Chat, der vom GitHub-Context-Graph startet und neue Screenshots/Fehlerberichte als aktuelle Evidenz behandelt.

## 2. Verifizierter Remote-Snapshot

| Bereich | Verifizierter Stand |
| --- | --- |
| Organizer/Admin Product Branch | `feature/organizer-admin-platform` |
| Organizer/Admin Product Head | `d299c2cefdf31ee2b497f564a837cbc6445e153f` |
| Letzter Commit | `fix: prevent legacy sheet observer feedback freeze` |
| PR #76 | offen, Draft, ungemergt; Base `mission-rxdb-sync` |
| Product exact-head CI | Run `34043396539` erfolgreich |
| Product Cloudflare check | Run `34043396584` erfolgreich |
| RxDB Source Branch | `mission-rxdb-sync` |
| RxDB Head | `33ab9c0d757da44e0b20b278982a548eafe732aa` |
| PR #74 | offen, Draft, ungemergt |
| Street Engine Branch | `feature/established-street-preparation-engine` |
| Street Engine Head | `501b8058302342358c8eaed5c67e378b02deb0c0` |
| PR #75 | offen, Draft, ungemergt |
| Street exact-head CI | Run `33689250614` erfolgreich |
| Rollback/Base Branch | `mission-release-2026-09-02-manual` |
| Rollback Head | `5e7148d2a32f6237861e7e6a05e022eeb67c91ce` |
| Production Deploy durch diese Replanung | nein |
| Production D1 Änderung durch diese Replanung | nein |

### Admin-Staging

- Branch: `organizer-admin-staging`
- letzter verifizierter Branch-Head beim Audit: `7933563320e911d9912edf3fd4053d476ad2aa17`
- Worker: `flyer-map-admin-staging`
- D1: `flyer-map-admin-staging-db`
- öffentliche URL aus dem bestehenden Handoff: `https://flyer-map-admin-staging.cloudflare-eleven035.workers.dev`
- neuester geprüfter Plan-031-Lauf: Run `34043334179`, Job `101513893332`, **failed**
- exakt verifizierter Failed Step: `Verify feature Product CI`
- alle nachgelagerten Build/D1/Deploy/Browser-Schritte dieses Laufs wurden übersprungen.

Wichtig: Weil der aktuelle Product-Head später exact-head CI-grün ist, darf aus dem fehlgeschlagenen Staging-Gate **nicht** ohne Log-Evidenz gefolgert werden, dass der Product-Code selbst rot war. Ebenso darf aber **nicht** behauptet werden, der aktuelle Head sei live vollständig akzeptiert. Der korrekte Status lautet: **CI-grün; latest full live acceptance für exakt diesen Head noch nachzuholen**.

## 3. Context-Graph und Wissenshierarchie

Jeder neue Chat/Agent muss zuerst diese Kette laden:

1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`
4. `docs/context-organizer-admin.yaml`
5. `docs/context-organizer-admin-live.yaml`
6. `docs/context-field-ui-navigation.yaml`
7. `docs/status/ORGANIZER_ADMIN_LIVE_HANDOFF.md`
8. `docs/plans/active/030-organizer-admin-platform.md`
9. `docs/plans/active/031-field-ui-navigation-rooms-sheets.md`
10. `docs/decisions/ADR-0026-organization-admin-identity-and-authorization.md`
11. `docs/operations/ORGANIZER_ADMIN_STAGING.md`
12. für Street/House zusätzlich `docs/SYNC_REQUIREMENTS_FOR_STREET_ENGINE.md` und die Plan-029-/Map-/Data-Dokumente.
13. danach `docs/context-replan-2026-09-07.yaml` aus diesem Replanning-Branch.

Der Graph ist wichtig, damit ein frischer Chat nicht nur die letzten Fehlermeldungen sieht, sondern **Produktabsicht, Architekturentscheidungen, harte Grenzen, aktive Pläne, abgeschlossene Arbeit und Abhängigkeiten** gemeinsam lädt.

## 4. Organizer/Admin – aktueller Reifegrad

### Was bereits belastbar vorhanden ist

Die Organizer/Admin-Linie hat bereits wesentliche Bausteine:

- Organization als Tenant-Grenze.
- globale Account-Identität mit Organization-scoped Memberships.
- serverseitige Session-/Membership-/Capability-Auflösung für geschützte Mutationen.
- Password-, TOTP-, Recovery-, Session- und Invite-Runtime.
- Security Center UI.
- Campaign-Erstellung und Ownership/Adoption-Arbeit.
- isolierter Organizer Worker für Staging.
- Security Header auf Worker- und statischen Asset-Antworten.
- Root-/Login-/Field-Entry-Logik.
- Field Rooms, Credentials, QR/Join, Kommentare, Launcher-/Navigation und Bottom-Sheet-Arbeit.

### Was noch nicht als Master-Akzeptanz geschlossen ist

`docs/status/CURRENT.md` nennt zurecht weiterhin offene Master-Gates. Besonders kritisch:

- Legacy-Campaign-Adoption mit Audit und negativen Cross-Tenant-/Race-Tests.
- vollständige Account-Security-Matrix: Username/Password, Reset, TOTP-Reset, Recovery-Regeneration, einzelne/alle Sessions widerrufen.
- mehrere Organizer/Admins und concurrent Last-Organizer-Invariant.
- serverbekannte Capability Registry und Named Role Templates.
- own-team / other-team / explizite cross-team Enforcement entlang der kanonischen Beziehungen.
- permanente Campaign-Löschung nur Organizer, mit frischer High-Risk-Reauth und exakter Bestätigung.
- Audit-, Threat-Model-, Rate-Limit- und CSP-Abschluss.
- Root-Organizer-Einstieg ohne normale Field Map zu beschädigen.
- vollständige Lifecycle-/Admin-Console-UX ohne Fake-KPIs.
- vollständige RxDB-/Field-Regressionsuite.

### Warum die aktuelle Linie besondere Regressionstests braucht

Die jüngere Product-Historie enthält viele punktuelle Integrationsfixes in genau den sensiblen Übergängen:

- Field comments und Navigation
- Campaign-Scoping von Kommentaren
- Settings nach Live-Campaign-Modus
- unavailable Field Hub Actions
- Legacy Access für importierte Member Campaigns
- Organizer Campaign Adoption
- Organizer Login innerhalb der SPA
- Default Field Map Entry
- importierter Field-Campaign Access
- Local Field Access während Session Sync
- campaign-scoped Bootstrap Reset
- Join bestehender Campaigns
- Local Data nach Campaign Removal
- Active Campaign State
- Legacy Field Ownership vs. Admin Auth
- Imported Owned Campaigns
- Admin Campaign Ownership
- Await Admin Campaign Refresh
- browser-sicheres PBKDF2
- Legacy Sheet Observer Feedback Freeze

Das ist kein Beweis, dass diese Bereiche aktuell defekt sind. Es ist aber ein starkes Signal, dass **kombinierte End-to-End-Invarianten** wichtiger sind als weitere isolierte Unit-Fixes.

## 5. Field UI / Plan 031

Die gewünschte Produktstruktur ist im Context-Graph klar und darf durch Bugfixing nicht verloren gehen:

- Primärnavigation über `PlatformShell` / Launcher.
- eigenständige Ziele Team, Rooms, Fortschritt, Kommentare, Streets, Gebiet, Einstellungen.
- Rooms/Fortschritt/Kommentare nicht als primäre TeamCenter-Tabs zurückbauen.
- gemeinsame draggable `FieldBottomSheet` mit fixem Handle/Header und scrollbarem Body.
- Street Save/Status/Close endet auf der Map, nicht wieder im Area-Flow.
- `Online anzeigen` steuert Discovery, nicht die Gültigkeit eines direkten Code-/QR-Joins.
- normaler Credential-Reveal darf keine Rotation auslösen.
- Rotation erhält bestehende Memberships.
- gesundes Sync-Signal bleibt leise; Fehler müssen sichtbar/actionable sein.
- deutsches Onboarding; Token Redemption darf nicht brechen.
- `.platform-grid-button` bleibt Brainrot-Long-Press-Ziel.

### UI-Bug-Strategie

Die UI-Bugs sollten **in einen neuen dedizierten UI-Chat** geschickt werden, nicht in den alten langen Chat. Vorgehen:

1. neuen Chat mit `docs/prompts/2026-09-07-ui-fix-agent.md` starten;
2. danach die aktuellen Bugs als frische Evidenz senden – idealerweise Screenshot/Video, Route, Campaign-/User-Modus, Gerät/Viewport, Schritte, erwartet, tatsächlich;
3. der Agent verifiziert jeden Bug auf der aktuellen Remote-/Staging-Version und übernimmt alte Chat-Aussagen nur, wenn sie reproduziert werden.

Damit beginnt der UI-Chat mit dem **aktuellen Graphen und Produktvertrag**, nicht mit einer Woche alter Fehlerhistorie.

## 6. RxDB / D1 Sync – aktueller Stand

PR #74 bleibt die kanonische separate Sync-Linie.

Architektur:

- D1 ist kanonische Serverdatenbank.
- RxDB/Dexie hält lokale operative Campaign-Daten.
- Worker validiert Push/Pull und bleibt Sicherheitsgrenze.
- Durable Object ist Invalidierungs-/Realtime-Fanout, nicht kanonischer Datenspeicher.
- Migration `0017_rxdb_sync_changes.sql` ist Teil des Kandidaten.
- Collections umfassen Campaign, Team, Area, Task und House Task.
- Konflikt-/Revision-/Write-Token-/atomare Write-Semantik sind bereits Gegenstand der Linie.
- Reconnect/offline Catch-up ist vorgesehen; kein permanenter Backup-Loop und kein unkontrolliertes Auto-Push auf normalen Requests.
- Fresh-client/bootstrap, multi-object, concurrent und reconnect Fälle sind getestet.

### Noch nötige Audit-Perspektive

Auch bei grünem CI fehlen für Release-Vertrauen adversariale Beweise gegen:

- manipulierte Client-Revisions-/Write-Token-Werte;
- Cross-Campaign-/Cross-Team Push;
- reordered/duplicate/lost Pull-/Push-Ereignisse;
- Cursor-/Tombstone-/Resync-Randfälle;
- stale overwrite oder Resurrection;
- Split-Brain nach langer Offline-Phase;
- DO-Reconnect- und Invalidierungsstürme;
- malformed/oversized Payloads;
- Partial Transaction Failures;
- lokale Storage-Quota/Corruption;
- die Integration des endgültigen Street-/House-Reconcile-Vertrags.

Dafür existiert ein eigener Prompt in diesem Replanning-Paket.

## 7. Street/House Engine – tatsächlicher Status

### Isolierte Engineering-Linie

PR #75 ist architektonisch ernsthaft aufgebaut:

- JSTS `2.12.1` serverseitig für LineString/Polygon-Clipping.
- modularer Turf `7.4.0` für Smart-Street Snapping/A-B-Slicing.
- serverseitige, begrenzte Overpass-Phasen für Roads und Buildings.
- keine Browser-Overpass-Neuberechnung.
- deterministische SHA-256 Street-Task-Identität.
- versionierter Algorithmus `street-v2-jsts-2.12.1-turf-7.4.0`.
- getrennte `street_status` / `house_status`.
- erfolgreicher Street-Publish bleibt gültig, wenn Houses scheitern.
- House-Retry lädt nur Buildings; Street-Retry nur Roads.
- Worked-Task Policy A: Reprepare blockiert action-required statt bearbeitete Auto-Tasks zu zerstören.
- atomare guarded Publish-Grenzen pro Phase.
- Migration `0015_area_task_preparation_split.sql` vorbereitet, nicht remote angewendet.

### Integrationslücke zur Sync-Linie

Der Vertrag `docs/SYNC_REQUIREMENTS_FOR_STREET_ENGINE.md` fordert bei Integration in PR #74 insbesondere:

- konkurrierende Reconcile-Implementierung entfernen/ersetzen;
- bytegenaue SHA-256 Identity vereinheitlichen;
- gemeinsamen `reconcilePreparedStreetTasks`-Pfad nutzen;
- `sourceKey` / `fragmentKey` weiterreichen;
- D1 Change Feed, Tombstones, Generation Guards und RxDB Replay auf dieselben Deltas ausrichten;
- user-owned Felder bei stabiler ID bewahren;
- Street-/House-Phasenzustände und selektive Retries in Read/Replay testen.

### Produktwahrheit

Die Nutzerbeobachtung „nur ein kleines Gebiet mit ungefähr zehn Straßen funktionierte zuverlässig“ ist **nicht durch den grünen Engine-CI widerlegt**. CI beweist deterministische Verträge auf Testdaten; es beweist nicht automatisch robuste Overpass-/Geometrie-/Volumenverarbeitung für reale große Gebiete.

Daher ist die Engine aktuell so einzustufen:

- **Architektur/isoliertes Engineering: fortgeschritten bis grün**.
- **Integration in den aktuellen Gesamtprodukt-Head: nicht vollständig bewiesen**.
- **breite reale Gebietsakzeptanz: offen / nach Nutzerbeobachtung unzureichend**.

Der nächste Street-Schritt muss eine **forensische Failure-Corpus-Arbeit** sein, keine weitere Woche blindes Patchen: für echte fehlgeschlagene Areas jeden Stage-Übergang messen – Request-Bounds, Overpass HTTP/429/5xx/Timeout, Bytes/Elemente, Normalisierung, Eligibility, JSTS Topologie, Clipping, Fragmentanzahl, House-Volumen, D1 Guard/Publish, Phase State, Client Read/Render.

## 8. Security – aktueller Stand und Risiko

### Positive vorhandene Grundlage

- Server/Worker ist Autorität; Client-IDs sind Selektoren, keine Berechtigungsbeweise.
- Tenant- und Membership-Modell ist dokumentiert.
- Credentials/TOTP/Recovery/Sessions/Roles/Audit gehören nicht in RxDB.
- Security Header sind vorhanden.
- CSRF/Origin-/Session-/Rate-Limit-Grundsätze sind dokumentiert.
- isoliertes Staging ist von Production getrennt.

### Warum ein tiefer Audit trotzdem Pflicht ist

Admin-Systeme kombinieren mehrere besonders riskante Klassen: globale Identität, Organization-Mitgliedschaften, Campaign Ownership, Invite/Recovery, TOTP, Sessions, Role/Capability, Legacy-Adoption, D1-Foreign-Keys und Field-Legacy-Zugriff. Die größte Gefahr ist hier weniger „ein einzelner offensichtlicher SQL-Injection-Bug“ als **eine Kette aus fehlender serverseitiger Re-Resolution, IDOR/BOLA, Race, Scope-Verwechslung oder Recovery-/Session-Lifecycle-Fehlern**.

Der Security-Agent soll deshalb mindestens untersuchen:

- Authentication und Account Enumeration.
- Password KDF, Credential Handling, Reset/Invite/Recovery/TOTP.
- Session Fixation, Rotation, Revocation, Cookie Flags, replay.
- CSRF, CORS, Origin/Referer, method/content-type gates.
- AuthZ / IDOR / BOLA / BFLA / confused deputy.
- Organization/Campaign/Team Tenant Isolation.
- Last-Organizer- und Ownership-/Adoption-Races.
- SQL Injection, dynamische SQL-Fragmente, parameterized queries, D1 Transactions/FKs.
- Stored/Reflected/DOM XSS, CSP, HTML/URL handling.
- SSRF/Server-side Fetch, insbesondere externe Quellen.
- Secrets/Tokens in URL, Log, Audit, LocalStorage, IndexedDB, RxDB, Artifacts.
- Brute force/credential stuffing relevant rate limits.
- Request-size/JSON/decompression/resource-exhaustion/DoS.
- WebSocket/DO-Authorization und Reconnect.
- Cache/headers/error leakage.
- Supply-chain und CI/Workflow boundaries.
- black-box + white-box + negative/fuzz/race testing.

Kein seriöser Audit darf „0 Sicherheitslücken garantiert“ behaupten. Das Ziel ist: keine bekannten Critical/High Findings, reproduzierbare Evidenz für geschlossene Findings und dokumentiertes Restrisiko.

## 9. Priorisiertes Risiko-Register

| Priorität | Risiko | Begründung | Gate |
| --- | --- | --- | --- |
| P0 | Produkt-Head nicht auf exakt aktuellem Head live-accepted | neuester Plan031 Staging-Lauf rot vor Deploy | neuen exact-head Staging-Lauf grün bekommen |
| P0/P1 | Street/House funktioniert nicht robust auf realen größeren Areas | direkte Nutzerbeobachtung trotz CI-grünem Engine-Branch | Failure Corpus + reale Akzeptanzmatrix |
| P1 | AuthZ/Tenant/Recovery/Session-Lücken im Admin-System | hohe Privilegien + Legacy-Bridges + viele Lifecycle-Pfade | adversarial Security Audit + Fixes |
| P1 | UI-/Access-Regressions | hohe Fix-Dichte in Session/Access/Nav/Sheets | fresh E2E Repro-Matrix |
| P1 | Street-Engine ↔ Sync-Vertrag nicht vollständig als Gesamtintegration bewiesen | separate PR-Linien | einheitlicher Reconcile/Feed/Replay-Test |
| P1 | Sync Randfälle unter Offline/Multi-client/Chaos | verteiltes System | adversarial sync stability suite |
| P2 | Mobile/real-device Abweichungen | Browser-CI ersetzt kein echtes iOS/Android/WebGL | echte Geräteakzeptanz vor Release |

## 10. Empfohlene Ausführungsreihenfolge

1. **Re-Planning-Branch nur als Dokumentation benutzen.** Keine Produktlogik hier implementieren.
2. **Aktuellen PR-76-Head exakt live akzeptieren** oder den echten Staging-Gate-Fehler beheben. Keine weitere Feature-Arbeit auf ungeprüfter Basis.
3. **Fresh UI Bug Campaign** in separatem Chat/Branch durchführen; gemeldete Bugs reproduzieren, minimal fixen, Regressionstests ergänzen, exact-head staging prüfen.
4. **Admin Security Audit** parallel als read-heavy Review starten; Critical/High Findings priorisieren. Schreibende Security-Fixes seriell und koordiniert auf eigener Branch-Linie.
5. **Street/House Recovery** mit stärkstem Reasoning-Modell und realem Failure Corpus. Erst den ersten tatsächlichen Fehlerpunkt beweisen, dann korrigieren. Danach PR-75/PR-74-Vertrag sauber integrieren.
6. **Sync Security/Stability Audit** gegen den finalen Street-/House-Vertrag ausführen.
7. **Combined isolated staging acceptance**: Admin + Field + Sync + Street/House + offline/reconnect + multi-client + negative authorization.
8. Erst danach Release-Readiness bewerten. **Kein Production Deploy/Migration ohne separate ausdrückliche Freigabe.**

## 11. Definition of Done für die nächste Entwicklungsphase

Die nächste Phase ist nicht „fertig“, nur weil Unit Tests grün sind. Sie ist fertig, wenn:

- exact remote head dokumentiert ist;
- Test/Typecheck/Audit/Build grün sind;
- isoliertes Staging exakt diesen Head ausführt;
- kritische UI-Flows browserseitig akzeptiert sind;
- aktuelle Nutzerbugs reproduziert und geschlossen oder als echter externer Blocker dokumentiert sind;
- Admin Critical/High Security Findings geschlossen sind;
- Street/House Failure Corpus auf repräsentativen kleinen/mittleren/großen Areas erfolgreich ist oder jeder Restfehler evidence-backed eingegrenzt ist;
- Sync unter offline/reconnect/multi-client/duplicate/reorder/tombstone/resync negativ getestet ist;
- keine Production-Daten, Production-Worker oder Rollback-Branch verändert wurden;
- PR #74/#75/#76 nicht ohne separate Freigabe gemergt/Ready gesetzt wurden.

## 12. Klare Empfehlung zu den nächsten Chats

- **UI-Bugs:** in einen neuen Chat mit `docs/prompts/2026-09-07-ui-fix-agent.md`, anschließend Bugs/Screenshots hineinschicken.
- **Gesamtplanung:** separater Planner-Chat mit `docs/prompts/2026-09-07-new-planner-chat.md`.
- **Admin Security:** separater Security-Review-Chat mit `docs/prompts/2026-09-07-admin-security-audit.md`.
- **Street/House:** stärkstes verfügbares Reasoning auf `docs/prompts/2026-09-07-street-house-engine-recovery.md`.
- **Sync:** eigener Audit-Chat mit `docs/prompts/2026-09-07-sync-security-stability-audit.md`.

So bleibt jeder Chat fachlich sauber, während `docs/context-map.yaml`, die Domain-Overlays und `docs/context-replan-2026-09-07.yaml` den gemeinsamen, verlustfreien Wissensgraphen bilden.
