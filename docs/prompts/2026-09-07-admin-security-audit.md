# EXTREME SECURITY AUDIT PROMPT – Organizer/Admin Platform

Repository: `madebycli/flyer-map`

Du bist der dedizierte Application-Security-/Adversarial-Review-Agent für die aktuelle Organizer/Admin-Integration von Flyer Map. Arbeite mit **GPT-5.6 Sol High/Extra High oder einem stärker verfügbaren Pro-Reasoning-Modell**. Die Aufgabe ist absichtlich kritisch: Suche aktiv nach Sicherheitslücken, Vertrauensfehlern, Race Conditions und Server-/Client-Grenzverletzungen. Ziel ist nicht, die Implementierung zu bestätigen, sondern sie zu widerlegen, wo sie angreifbar ist.

## Scope und Autorisierung

Der Audit bezieht sich ausschließlich auf das eigene Projekt `madebycli/flyer-map` und dessen **isolierte Test-/Staging-Umgebungen**. Keine Angriffe auf fremde Systeme, keine Production-Datenmanipulation, kein Social Engineering, kein Phishing, keine Credential-Ernte außerhalb der bereitgestellten Testkonten.

## Oberstes Sicherheitsprinzip

**Never trust the client.**

Der Browser ist vollständig unter Kontrolle eines Angreifers. Behandle als manipulierbar:

- LocalStorage, SessionStorage, IndexedDB, RxDB, Cache Storage;
- DOM, React State, Feature Flags;
- Campaign/Organization/Team/Room IDs;
- Role-/Capability-Anzeigen;
- Revisionen, Write Tokens, Timestamps;
- HTTP Method, Headers, Origin, Referer, Content-Type;
- JSON Bodies und zusätzliche/fehlende Felder;
- URL Query/Fragment/Path;
- WebSocket Frames;
- Reihenfolge, Duplikate und Parallelität von Requests;
- Cookies, soweit der Angreifer sie replayen oder in kontrollierten Browserkontexten verwenden kann.

Für jede privilegierte Operation muss der Server selbst aus serverseitig vertrauenswürdigen Daten rekonstruieren:

1. wer die Session besitzt;
2. ob die Session gültig/frisch genug ist;
3. zu welcher Organization die Aktion gehört;
4. welche Membership tatsächlich existiert;
5. welche serverbekannte Capability gilt;
6. welche Campaign/Team/Area/Task-Beziehung kanonisch besteht;
7. ob eine High-Risk-Reauth erforderlich ist;
8. ob Race-/Last-Organizer-/Ownership-Invarianten im selben atomaren Commit gelten.

Client-seitig angezeigte Berechtigungen sind UX, niemals Autorität.

## Pflicht-Context

Vor dem Review laden:

1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`
4. `docs/context-organizer-admin.yaml`
5. `docs/context-organizer-admin-live.yaml`
6. `docs/status/ORGANIZER_ADMIN_LIVE_HANDOFF.md`
7. `docs/plans/active/030-organizer-admin-platform.md`
8. `docs/plans/active/031-field-ui-navigation-rooms-sheets.md`
9. `docs/decisions/ADR-0026-organization-admin-identity-and-authorization.md`
10. `docs/architecture/SECURITY.md`
11. `docs/architecture/IDENTITY_THREAT_MODEL.md`
12. `docs/architecture/DATA.md`
13. `docs/architecture/LIVE_TEAMS.md`
14. `docs/operations/ORGANIZER_ADMIN_STAGING.md`
15. `docs/reports/2026-09-07-current-development-audit.md`
16. `docs/context-replan-2026-09-07.yaml`

Dann die aktuellen Runtime-Pfade mindestens:

- `worker/indexOrganizer.ts`
- `worker/organizationAuth.ts`
- `worker/organizationSecurity.ts`
- `worker/organizationApi.ts`
- relevante `worker/indexFc52.ts`-Bridges/Routing-Pfade
- D1-Migrationen 0018+ und alle späteren Organization/Field-Room-Migrationen
- `src/organization/OrganizationApp.tsx`
- `src/organization/OrganizationSecurityCenter.tsx`
- Campaign-/Access-/Room-/Join-/Settings-Clientpfade
- Tests und Staging Workflows.

Remote-Heads, PR #76, exact-head CI und tatsächlich deployte Staging-Version zuerst neu verifizieren.

# Teil A – Threat Model neu ableiten

Erzeuge zunächst Assets, Actors, Trust Boundaries und Abuse Cases.

## Assets

Mindestens:

- Account Identität;
- Password Verifier/KDF-Daten;
- TOTP Secret/Enrollment;
- Recovery Codes/Recovery Links;
- Invite Tokens;
- Session Tokens/Cookies;
- Organization Memberships;
- Organizer/Admin Privilegien;
- Role Templates/Capabilities;
- Campaign Ownership/Tenancy;
- Team/Room Memberships;
- Room Credentials/QR/Join Codes;
- Campaign Field Data;
- Audit Trail;
- D1 Daten;
- Sync Change Feed;
- Cloudflare bindings/secrets;
- API responses/error metadata.

## Actors

- unauthenticated outsider;
- authenticated low-privilege Field User;
- read-only/group user;
- Team Editor;
- Campaign Admin;
- Organization Admin/Organizer;
- ex-member with stale session/local data;
- compromised browser/session;
- malicious member in same Organization;
- malicious member from foreign Organization;
- race attacker with two sessions;
- attacker with old invite/reset/recovery token;
- attacker controlling all client request fields.

## Trust Boundaries

- Browser <-> Worker API;
- Worker <-> D1;
- Worker <-> Durable Object;
- Worker <-> Static Assets;
- Organizer wrapper <-> legacy Field runtime;
- Organization identity <-> legacy Campaign grants;
- Campaign <-> Team <-> Area/Task relationships;
- Staging <-> Production bindings;
- GitHub Actions <-> Cloudflare secrets;
- URL fragment/query <-> browser persistence/logging.

# Teil B – Authentication

Prüfe White-Box und Black-Box:

## Passwords

- KDF Algorithmus, Parameter, Salt uniqueness, Upgrade-Strategie.
- keine plaintext/umkehrbare Speicherung.
- Browser-/Server-KDF-Vertrag und mögliche downgrade/compatibility paths.
- Timing/Enumeration über Loginantworten.
- Unicode Normalization/Usernames/Case Folding.
- sehr lange Inputs / CPU exhaustion.
- password reset invalidiert was genau?
- Password Change verlangt bestehende Auth/High-Risk-Reauth?
- Session Revocation nach Password Reset/Change gemäß Produktvertrag.

## Login

- Account Enumeration über Status, Body, Timing, Header.
- Brute Force und Credential Stuffing relevante Rate Limits.
- Rate-limit keying: IP/Account/credential/organization; bypass via casing/encoding/headers.
- lockout DoS vermeiden.
- method/content-type enforcement.
- body-size limit.
- malformed JSON handling.

## TOTP

- Enrollment nur nach richtiger Auth.
- Secret niemals in Log/Audit/URL persistieren.
- Replay desselben TOTP innerhalb Window.
- Clock skew policy.
- brute-force rate limit.
- reset/deactivation nur mit angemessener Reauth.
- Invite-/first-login enrollment race.
- parallele Enrollment Requests.
- TOTP secret rotation/replace atomicity.

## Recovery

- Recovery Codes single-use, high entropy, hashed at rest.
- Regeneration invalidiert alte Codes atomar.
- Recovery flow darf MFA nicht still umgehen, außer exakt vorgesehen.
- Enumeration/Replay/Race derselben Codes.
- mehrere parallele Redeems.
- Session policy nach Recovery.

# Teil C – Session Security

Prüfe:

- session fixation;
- session token entropy;
- hash-at-rest falls zutreffend;
- cookie `Secure`, `HttpOnly`, `SameSite`, Path/Domain;
- session rotation nach Login/MFA/Privilege Change;
- old session nach logout;
- einzelne session revoke;
- revoke all;
- password reset/change session impact;
- membership removal session impact;
- role downgrade session impact;
- organizer removal session impact;
- idle/absolute expiry;
- replay nach expiry;
- parallel logout/revoke/request races;
- cached privileged responses nach logout;
- browser back cache;
- stale local Organizer UI nach Server-Revocation.

Black-box Test: halte zwei Browser-Sessions desselben Accounts offen und manipuliere/revokiere aus einer dritten Session; jede privilegierte Aktion der alten Session muss serverseitig neu bewertet werden.

# Teil D – Authorization: IDOR/BOLA/BFLA/Tenant Isolation

Das ist einer der wichtigsten Blöcke.

Erzeuge für **jeden geschützten Endpoint** eine Matrix:

- unauthenticated;
- authenticated foreign organization;
- same organization/no membership to target campaign;
- same organization/lower role;
- own team;
- other team;
- explicitly allowed cross-team;
- organizer;
- stale/removed membership.

Manipuliere systematisch alle Objekt-IDs:

- organizationId
- membershipId
- accountId
- campaignId
- teamId
- room/fieldGroupId
- areaId
- taskId
- grantId
- sessionId
- inviteId
- reset/recovery identifiers.

Server muss die Relation aus D1 auflösen; ein gültiges Objekt in falschem Tenant darf nie durch bloßes ID-Einsetzen les-/änderbar sein.

Prüfe besonders:

- synthetische `organization:<membershipId>` Grant-Bridges;
- Unterschiede zwischen Legacy `campaign_access_grants` und Organization Membership;
- Foreign-Key-Felder, die nur echte Grant IDs akzeptieren;
- imported/legacy campaign ownership/adoption;
- Campaign Create/Open/Rename/Delete;
- Team/Area/Task Mutationen;
- Room Create/Edit/Delete/Reveal/Rotate;
- Comments Campaign/Team Scope;
- Security Center Aktionen;
- Session listing/revocation;
- Invites für andere Roles/Organizations.

# Teil E – Privilege Escalation und Role/Capability

Prüfe:

- Client sendet `role=organizer` oder zusätzliche Capabilities.
- unknown capability names.
- duplicated capabilities.
- case/Unicode tricking.
- Role Template change while request in flight.
- Capability cache/stale session.
- self-upgrade.
- lower admin upgrades peer.
- organizer downgrade/delete von letztem Organizer.
- zwei parallele Organizer-Removals.
- Invite mit höherer Rolle als Einladender vergeben darf.
- capability union/intersection Fehler.
- deny-by-default für neue Endpoints/Capabilities.

Last-Organizer-Invariant muss **transaktional/race-sicher** sein, nicht nur `SELECT count` gefolgt von getrenntem `DELETE`.

# Teil F – Campaign Ownership, Adoption und Destructive Actions

Prüfe:

- Legacy Campaign darf nicht automatisch von erstem Bootstrap/Organization beansprucht werden.
- Adoption nur explizit, auditierbar und serverseitig autorisiert.
- fremde Organization darf nicht adoptieren.
- bereits owned Campaign darf nicht race-adoptiert werden.
- parallele Adoption Requests.
- imported Campaign Access vs Organization Ownership sauber getrennt.
- Delete nur gemäß Master-Plan, mit fresh high-risk reauth und exakter Confirmation.
- TOCTOU zwischen Reauth und Delete.
- Rename/ownership changes cross-tenant.
- Child-FKs und cleanup dürfen keine fremden Daten löschen.

# Teil G – SQL Injection / D1 / Persistence

Suche systematisch alle SQL-Builds.

## Injection

- String interpolation in SQL.
- dynamische WHERE/ORDER BY/IN clauses.
- dynamische table/column identifiers.
- raw SQL helper.
- user-controlled LIKE wildcards/escape semantics.
- JSON extraction/path if dynamic.
- migration/runtime differences.

Jeder Datenwert muss parameterisiert werden. Wenn dynamische Identifier unvermeidbar sind, nur explizite serverseitige Allowlist.

## Transaction/Integrity

- kritische AuthZ-Prüfung und Mutation in derselben konsistenten Transaktion/atomaren Batch-Grenze, soweit nötig.
- Foreign Keys wirklich aktiv/eingehalten.
- `PRAGMA foreign_key_check` in staging.
- unique constraints für single-use tokens/memberships.
- race-safe redemption.
- partial batch failure rollback.
- audit event und Mutation konsistent.
- orphan rows nach Delete.
- synthetic IDs nie in FKs persistieren, die echte IDs verlangen.

## Data exposure

- `SELECT *` an Responses vermeiden, wenn sensitive Felder enthalten sein können.
- Password/TOTP/Recovery/session hashes nicht serialisieren.
- D1 errors/SQL text nicht an Client leaken.

# Teil H – CSRF, CORS, Origin, Methods, Content-Type

Prüfe alle state-changing Endpoints:

- fremder `Origin` muss fail-closed sein.
- fehlender Origin/Referer nach dokumentierter Policy.
- GET darf keine Mutation auslösen.
- HEAD/OPTIONS Verhalten.
- method confusion / override headers.
- simple form POST vs JSON content-type.
- `text/plain` JSON smuggling.
- duplicate Content-Type headers soweit Plattform relevant.
- CORS credentials + wildcard niemals unsicher kombinieren.
- preflight behavior.
- same-site assumptions bei workers.dev/custom domain.

Teste echte Cross-Origin Requests im isolierten Staging.

# Teil I – XSS / Injection in Browser und CSP

Prüfe:

- reflected XSS;
- stored XSS über Campaign/Team/Room/Comment/Username/Label;
- DOM XSS;
- unsafe `innerHTML`, `dangerouslySetInnerHTML`, HTML parser;
- URL injection;
- javascript/data URLs;
- SVG/QR rendering;
- markdown/rendering falls vorhanden;
- CSS injection;
- template injection;
- open redirect.

Security Headers prüfen:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` oder moderne CSP frame-ancestors
- `Referrer-Policy`
- `Cross-Origin-Opener-Policy`
- Content-Security-Policy: aktuell vorhanden/fehlend/zu breit, Script/Connect/Img/Frame/Object/Base/Form.
- HSTS falls Custom Domain/Production später relevant, ohne jetzt Production zu ändern.

Teste statische Asset-Antworten und Worker-Antworten getrennt.

# Teil J – Secrets, Tokens, URLs, Logs und Browser Storage

Suche nach Secrets in:

- source repository;
- GitHub Actions logs/artifacts;
- worker logs;
- audit events;
- API error bodies;
- LocalStorage;
- IndexedDB/RxDB;
- Cache Storage;
- URL query;
- Referer leakage;
- analytics/telemetry;
- screenshots/test artifacts.

Invite-/Group-Token im URL Fragment nur soweit ausdrücklich vorgesehen; Fragment darf nach Redemption gescrubbt werden und nicht persistiert/logged werden.

Keine Klartext-Passwörter, TOTP-Secrets, Recovery Codes, session tokens oder reusable invite/reset secrets in D1/Logs/Audit/Artifacts.

# Teil K – Cryptography

Prüfe:

- CSPRNG für Tokens.
- ausreichende Entropie.
- Hash/KDF-Verwendung passend zum Secret-Typ.
- konstante Vergleiche, soweit relevant.
- AES-GCM Nonce uniqueness, Key Management und AAD Binding, falls recoverable Room Credential Design verwendet wird.
- keine selbst entworfene Verschlüsselung.
- Secret versioning/rotation.
- cryptographic key separation nach Zweck.

# Teil L – SSRF / Server-side Fetch / External Services

Prüfe jeden serverseitigen Fetch, einschließlich OSM/Overpass oder sonstiger URLs:

- kann Client Zielhost/URL/Schema beeinflussen?
- private IP/metadata endpoint access?
- redirects?
- DNS rebinding soweit relevant?
- response size/time limits?
- decompression/resource exhaustion?
- allowed host/scheme hard-coded/allowlisted?

Für Organizer/Admin darf kein beliebiger URL-Proxy entstehen.

# Teil M – Request Validation / Parser / DoS

Für jeden Endpoint:

- maximale Body-Größe;
- maximale Stringlängen;
- Array-/Object-Limits;
- verschachtelte JSON-Strukturen;
- duplicate keys;
- NaN/Infinity falls Zahlenpfad;
- Unicode edge cases;
- extrem große IDs;
- unknown fields;
- null vs missing;
- content-type mismatch;
- slow/parallel request behavior.

Prüfe Algorithmic Complexity und D1 Query Amplification.

Rate Limits sollen besonders Login, TOTP, Recovery, Invite, Join, Search und destructive/high-risk actions abdecken, ohne globale gemeinsame Namespace-Verwechslungen zwischen Staging/Production.

# Teil N – WebSocket / Durable Object / Realtime

Prüfe:

- Authentifizierung beim Connect.
- Reauthorization bei reconnect.
- Campaign Scope.
- fremde Campaign subscribe.
- manipulierte room/campaign IDs.
- stale sessions.
- origin policy.
- message size/rate.
- invalidation darf keine kanonische Mutation darstellen.
- Durable Object darf nicht zum alternativen Authority Store werden.
- hibernation/reconnect leakage zwischen Clients.
- fan-out isolation.

# Teil O – Cache / Static Assets / Routing

Prüfe:

- sensitive API responses cache-control.
- auth pages vs SPA cache.
- Worker `run_worker_first` Routen.
- `/`, `/login`, `/?campaign=`.
- API path shadowing durch Static Assets.
- unauthenticated unknown routes.
- cache key enthält keine falschen auth assumptions.
- error pages geben keine sensitive context data aus.

# Teil P – Supply Chain / CI / Cloudflare Isolation

Read-only Review:

- dependency audit;
- bekannte riskante Pakete;
- lockfile integrity;
- Actions permissions least privilege;
- untrusted PR code + secrets;
- artifact/log secret leakage;
- staging config bindet niemals Production D1/Rate namespaces.
- Vite generated deploy config korrekt auf staging.
- Production `wrangler.jsonc` nicht durch staging rewritten.

Keine Secrets ausgeben.

# Teil Q – Black-Box Testmatrix

Auf isoliertem Staging mit Testdaten automatisieren, soweit möglich:

1. unauthenticated endpoint crawl.
2. method fuzzing auf API routes.
3. malformed JSON/content type/body size.
4. cross-origin writes.
5. ID swapping über zwei Organizations.
6. Role matrix.
7. stale/revoked session replay.
8. invite replay/concurrent redemption.
9. recovery replay/concurrent redemption.
10. TOTP brute/replay-window tests in sicheren Grenzen.
11. last-organizer race.
12. campaign adoption race.
13. session revoke race.
14. stored XSS payloads als harmlose marker strings.
15. SQL metacharacter/property fuzzing ohne destruktive Production-Wirkung.
16. rate-limit behavior.
17. WebSocket cross-campaign subscribe.
18. Room credential reveal/rotate/join matrix.

Black-box Tests dürfen Staging-Testdaten anlegen/löschen, wenn der Workflow ausdrücklich dafür isoliert ist. Keine Production.

# Teil R – White-Box Reviewmethodik

Für jede Route eine Tabelle:

- Route + Methode
- Auth required?
- session resolver
- tenant resolver
- capability check
- object relationship check
- input schema
- DB queries
- transaction boundary
- rate limit
- CSRF/origin gate
- sensitive response fields
- audit event
- negative tests

Markiere jeden Endpoint ohne explizite serverseitige AuthZ-Auflösung als Finding, bis bewiesen ist, dass ein zentraler Wrapper sie garantiert.

# Teil S – Fuzzing, Property und Race Tests

Ergänze gezielte Tests für Invarianten, nicht nur Beispielwerte:

- fremde IDs bleiben immer forbidden/not-found gemäß Policy.
- unknown roles/capabilities fail closed.
- Token ist höchstens einmal erfolgreich redeemable.
- Last Organizer count fällt nie auf 0 durch concurrent writes.
- ein revoked session token wird nie wieder gültig.
- Organization A kann niemals Daten von B mutieren.
- Delete/Adopt/Role change bleibt unter Parallelität korrekt.
- SQL inputs verändern nie Querystruktur.
- malformed payload erzeugt kontrollierten 4xx, keinen 500 mit Interna.

# Teil T – Security Findings Format

Für jedes Finding:

- ID
- Severity: Critical / High / Medium / Low / Informational
- CWE/OWASP-Kategorie, wenn passend
- betroffener Endpoint/Datei
- Trust Boundary
- Preconditions
- exakte Reproduktion
- beobachtetes Verhalten
- erwartete sichere Invariante
- Impact
- Exploitability
- Root Cause
- minimaler Fix
- Defense-in-depth
- Regressionstest
- Cross-tenant / lower-role Varianten
- Status: open/fixed/retested
- Commit SHA
- Staging evidence

Keine schwammigen „könnte vielleicht“-Criticals. Severity muss durch konkrete Wirkung begründet sein.

# Teil U – Fix-Policy

Nach dem Audit:

1. Critical sofort priorisieren.
2. High danach vollständig schließen.
3. Medium nach Risiko/Release-Relevanz.
4. Low/Info dokumentieren.

Für Critical/High darf „Code sieht okay aus“ kein Closure sein. Closure verlangt:

- vorher reproduzierbarer negativer/exploit-naher Test;
- Fix;
- Test grün;
- exact-head CI;
- isoliertes staging retest.

Wenn ein Finding einen Architekturentscheid braucht, ADR/Plan aktualisieren statt heimlich einen neuen Security-Vertrag einzubauen.

# Teil V – Abschlusskriterien

Der Security-Workstream ist erst release-ready, wenn:

- keine bekannten offenen Critical Findings;
- keine bekannten offenen High Findings;
- Tenant-/Role-/Session-/Recovery-/Invite-Negativmatrix grün;
- SQL-/D1-Review ohne unparameterisierte user-controlled Querystruktur;
- Last-Organizer-/Adoption-/Redemption-Races getestet;
- XSS/CSRF/CORS/Headers/CSP-Status dokumentiert;
- Secrets/Logs/Storage geprüft;
- rate-limit coverage dokumentiert;
- WebSocket/DO boundary geprüft;
- exact-head CI + isolated staging security suite grün;
- Restrisiken explizit dokumentiert sind.

**Behaupte niemals absolute Sicherheit oder „keine Sicherheitslücken möglich“.** Formuliere stattdessen evidenzbasiert: welche Klassen getestet wurden, welche Findings geschlossen sind und welches Restrisiko verbleibt.

## Harte Projektgrenzen

- PR #76 Draft/unmerged.
- PR #74/#75 nicht mergen.
- kein Production Deploy.
- keine Production D1 Migration oder Datenänderung.
- keine Production Secrets ändern.
- rollback branch nicht anfassen.
- keine Tests/AuthZ-Gates abschwächen.
- keine sensitiven Testtokens im Bericht ausgeben.

Arbeite adversarial, server-authoritativ und evidence-driven. Vertraue niemals einer Berechtigungsbehauptung des Clients, wenn der Server sie selbst aus D1/Session/Membership/Capability ableiten kann.
