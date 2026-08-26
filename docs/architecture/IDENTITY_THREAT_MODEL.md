---
id: architecture-identity-threat-model
type: architecture
status: proposed
last_updated: 2026-08-26
related: [architecture-identity-permissions, architecture-security, architecture-organizations, ADR-0015]
source_of_truth_for: [future-admin-account-threat-model]
---

# Organization Admin identity threat model — Proposed

## Status

Proposed review document for ADR-0015. It does not authorize account/authentication implementation.

## Assets to protect

Highest sensitivity:
- raw administrator passwords during verification/reset;
- password verifier parameters and salts;
- TOTP seeds and enrollment QR/URI;
- submitted TOTP codes;
- recovery codes;
- authenticated session secrets;
- Worker-held encryption/pepper keys;
- Organization Admin authority and capability assignments.

Integrity-sensitive:
- Organization membership;
- account enabled/disabled state;
- TOTP/recovery enrollment state;
- last accepted TOTP step;
- session revocation/expiry;
- audit history;
- last-effective-Admin invariant.

Confidential but lower sensitivity:
- usernames;
- Organization/Campaign membership metadata;
- security-event metadata that contains no secret values.

## Trust boundaries

1. Browser UI to Cloudflare Worker over HTTPS.
2. Worker validation/authentication logic to D1.
3. Worker to Cloudflare secret/secrets binding containing encryption keys.
4. Worker to Rate Limiting binding.
5. Authenticated account session cookie crossing browser/Worker boundary on every request.
6. Existing Campaign access-link/session model interacting with future Organization account authorization.

No browser state is authoritative for Admin permission decisions.

## Threat actors

- unauthenticated remote attacker;
- credential-stuffing/password-spraying attacker;
- attacker who knows one valid username;
- authenticated low-privilege Campaign/Team participant;
- compromised administrator browser/session;
- XSS-capable attacker on the application origin;
- attacker with a read-only D1 dump;
- attacker who can modify D1 but does not possess Worker secrets;
- operator/developer accidentally exposing secrets through logs/diagnostics;
- malicious/compromised administrator attempting tenant-boundary or last-admin abuse.

Full compromise of the Cloudflare account/Worker secret store is catastrophic and outside what application-layer encryption can fully contain, but blast-radius controls should still prevent secret logging and cross-tenant data confusion.

## Threats and required mitigations

### SQL injection

Threat:
- username/password/TOTP/recovery/form content alters D1 query structure.

Required controls:
- prepared/parameterized D1 statements only;
- static SQL structure;
- schema validation before queries;
- regression tests with SQL/meta-character input;
- never build identifiers/ORDER BY/table names from user input without hardcoded mapping.

Release gate:
- injection-like account input persists/compares only as inert data and cannot alter schema/query behavior.

### HTML/JS injection and XSS

Threat:
- username/display/audit/support text executes in Admin/field UI and steals session or enrollment secrets.

Controls:
- React/text output encoding by default;
- no `dangerouslySetInnerHTML` for account-controlled fields;
- restrictive CSP;
- no account session token in web storage;
- enrollment surfaces never mix user-controlled HTML with TOTP/recovery secret display.

Release gate:
- script/HTML-like username/form values remain visible inert text.

### Password database compromise

Threat:
- D1 verifier dump enables fast offline password cracking.

Controls:
- reviewed slow password verifier with unique salt and version/cost metadata;
- cost meets accepted security floor, not free-tier convenience;
- upgrade/rehash path;
- password quality policy and known-compromised-password handling may be added if a suitable privacy-preserving/runtime-compatible mechanism is chosen.

Residual risk:
- user-chosen weak passwords remain guessable; TOTP limits account compromise after password recovery but does not excuse weak hashing.

### Password brute force / credential stuffing

Threat:
- repeated remote login attempts.

Controls:
- Cloudflare Rate Limiting binding at route + canonical account keys;
- durable per-account failure/backoff if needed because edge rate limiting is permissive/locality-scoped;
- generic login errors;
- TOTP second factor;
- audit/monitor repeated failures without logging password.

Release gate:
- automated tests prove throttling/backoff paths and no username enumeration through obvious response differences.

### Username enumeration

Threat:
- attacker learns which Admin accounts exist through error text, timing or recovery flows.

Controls:
- generic failure messages/status where practical;
- comparable password-verification path for missing user, for example fixed dummy verifier parameters, subject to benchmark;
- recovery/reset endpoints avoid disclosing account existence.

### TOTP seed disclosure from D1

Threat:
- database read attacker obtains second factor seed and generates future codes.

Controls:
- AES-GCM encryption using key from Worker secret binding;
- random nonce and key version;
- authenticated additional data binds credential/account id;
- no plaintext seed in D1/logs/audit.

Residual risk:
- simultaneous Worker-secret + D1 compromise reveals seeds. Key rotation and least-privilege Cloudflare access reduce operational exposure.

### TOTP online guessing and replay

Threat:
- six-digit code brute force or reuse in same time window.

Controls:
- strict challenge attempt limits;
- narrow clock tolerance;
- record/reject last accepted TOTP time-step where feasible;
- short-lived intermediate password challenge;
- never log codes.

Release gate:
- accepted code cannot be replayed for a second session within the protected step window.

### Lost TOTP device / recovery takeover

Threat:
- legitimate Admin locked out or attacker abuses reset to remove MFA.

Controls:
- one-time high-entropy recovery codes strongly recommended;
- multiple independent Organization Admins;
- TOTP reset is privileged/audited;
- no support workflow can reveal existing TOTP seed/password;
- define catastrophic recovery separately before release.

Open decision:
- recovery when all Admins lose TOTP + recovery codes.

### Session theft / fixation

Threat:
- captured session secret impersonates Admin.

Controls:
- opaque high-entropy random session id;
- HttpOnly Secure `__Host-` cookie;
- no localStorage/sessionStorage credential;
- rotate at login and sensitive security changes;
- server-side expiry/revocation;
- invalidate sessions on account disable/security version changes as defined;
- HTTPS only.

Release gate:
- supplied/pre-login session value cannot survive successful authentication as the new Admin session.

### CSRF

Threat:
- another origin causes authenticated Admin writes via cookies.

Controls:
- SameSite cookie policy;
- validate Origin for state-changing Admin requests;
- CSRF token/double-submit or equivalent if future browser flows require cross-site exceptions;
- GET never performs privileged mutation.

### Tenant boundary bypass

Threat:
- Admin from Organization A supplies Organization/Campaign ids belonging to B.

Controls:
- every privileged Worker operation resolves account session, active membership and target Organization relationship server-side;
- ids remain selectors, never authorization proof;
- deny by default;
- D1 queries scoped with Organization/campaign relation where appropriate;
- dedicated cross-tenant authorization tests.

Release gate:
- authenticated foreign-tenant ids return forbidden/not-found without data mutation/leak.

### Capability escalation

Threat:
- UI or request payload grants caller a capability it does not possess.

Controls:
- capability changes require server-side `permission.manage`/`admin.manage` checks after the permission ADR is accepted;
- caller cannot assign authority greater than policy allows;
- last Admin invariant;
- audit changes.

### Last Admin removal / lockout

Threat:
- final effective Admin disabled/demoted/deleted leaving Organization unrecoverable.

Controls:
- transactional server-side invariant check;
- explicit transfer/recovery flow;
- concurrency test with two simultaneous demotion/removal requests.

### Secret leakage through logs/support

Threat:
- password/TOTP/session/recovery/enrollment data appears in Worker logs, errors, GitHub, support diagnostics or chat.

Controls:
- structured allowlist logging only;
- never log raw request body on auth routes;
- redact Authorization/Cookie/security headers;
- support diagnostics schema has no secret fields;
- error messages use safe codes, not serialized sensitive objects.

Release gate:
- automated/log review with sentinel secret values finds no secret output.

### Timing and comparison attacks

Threat:
- secret equality comparison leaks information.

Controls:
- timing-safe comparison for verifier/session/recovery derived values where runtime representation permits;
- do not compare raw password/TOTP strings as stored secrets;
- generic failure path reduces external signal.

### Concurrency/replay

Threat:
- two requests reuse one recovery code/TOTP step, or concurrently remove last Admin.

Controls:
- D1 transactional/conditional claim patterns;
- single-use recovery claims;
- TOTP last-step update coordinated with session issuance;
- invariant tests under concurrent requests.

## Privacy boundary

Admin authentication must not introduce:
- GPS tracking;
- permanent browser/device fingerprinting;
- third-party analytics containing usernames/security identifiers by default;
- password/TOTP values in telemetry.

Security metadata such as coarse failed-login counts and last security-event timestamps may be retained according to the future audit-retention policy.

## Required release tests before account feature can ship

At minimum:
- password-hash cost benchmark in actual Worker-compatible environment;
- SQL injection payload regression tests for every auth/account write path;
- XSS/inert-output tests for username/admin form values;
- login throttling and generic-error tests;
- password + TOTP both required for new session;
- TOTP replay rejection;
- recovery code single-use;
- session fixation/rotation/logout/revocation;
- CSRF/Origin rejection;
- account disable invalidates sessions according to policy;
- cross-Organization isolation;
- permission escalation denial after permission system exists;
- last Admin concurrent-removal protection;
- sentinel-secret logging test/review;
- D1 dump does not contain raw password, TOTP seed, recovery code or session secret.

## Review blockers

This threat model remains proposed until ADR-0015 resolves:
- password hashing runtime benchmark/path;
- recovery-code requirement;
- session lifetime;
- catastrophic Admin recovery;
- legacy access-link/account coexistence.
