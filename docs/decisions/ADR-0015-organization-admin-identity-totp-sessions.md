---
id: ADR-0015
type: decision
status: proposed
date: 2026-08-26
---

# ADR-0015: Organization Admin username/password/TOTP identity and sessions

## Status

Proposed only. Account tables, login, password hashing, TOTP enrollment and account-session runtime code remain release-blocked until this ADR and the linked threat model are reviewed and explicitly accepted.

## Context

Plan 012 requires multiple Organization administrator accounts using username + password + authenticator-app TOTP, with no mandatory email identity and no SMS requirement.

Security requirements already accepted at product/architecture level:
- authentication never replaces authorization;
- raw passwords/TOTP codes/secrets are never logged;
- no user input is concatenated into SQL;
- D1 access is prepared/parameterized;
- sessions are opaque, server-revocable and cookie protected;
- login/TOTP endpoints are rate limited;
- TOTP replay should be prevented where feasible;
- last effective Organization Admin cannot be accidentally removed;
- security changes are audited without secrets.

## Runtime/security references verified 2026-08-26

Cloudflare Workers currently:
- has a 128 MB memory limit per isolate;
- supports WebCrypto including PBKDF2 and AES-GCM;
- supports Node `crypto` broadly, but `argon2`/`argon2Sync` are not supported;
- provides a Worker Rate Limiting binding for application-controlled limits.

References:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

OWASP currently prefers Argon2id, then scrypt when Argon2id is unavailable. The OWASP scrypt minimum memory parameters are too close to the Worker's total 128 MB isolate ceiling to assume safe operation in the existing runtime. OWASP also documents PBKDF2-HMAC-SHA-256 with a high iteration count as an established fallback. Therefore the project must benchmark the candidate design rather than silently selecting a weak cost.

## Proposed account identity

### Username

Initial conservative direction:
- username is not an email address requirement;
- 3 to 40 characters;
- store both original display form and canonical lookup form;
- canonical lookup uses trim + Unicode normalization + lowercase;
- implementation should strongly consider limiting initial usernames to a simple visible character set such as ASCII letters/digits plus `._-` to reduce spoofing/confusable/support problems;
- uniqueness is Organization-global unless a later product decision explicitly chooses per-Organization login namespaces.

Username is public-ish identifier data, not a credential secret.

### Account id

Account uses an application-owned random id independent of username. Renaming a username must not replace account identity or audit references.

## Proposed password verifier

### Candidate v1 algorithm

Candidate for Worker-native implementation:
- PBKDF2-HMAC-SHA-256 through WebCrypto;
- minimum 600,000 iterations unless a newer accepted OWASP floor is higher at implementation time;
- unique cryptographically random salt per password, at least 16 bytes;
- 32-byte derived verifier;
- store algorithm/version/iterations/salt/verifier as structured fields;
- constant-time verifier comparison;
- successful login may rehash when stored parameters are below current policy.

This is proposed because Argon2 is unavailable in the current Worker runtime and OWASP-level scrypt memory parameters conflict with the 128 MB per-isolate limit.

### Mandatory benchmark gate

Before accepting this algorithm, benchmark the exact production-compatible Worker implementation.

The project must not lower the work factor merely to fit a Free-plan CPU budget.

If the secure PBKDF2 configuration is not operationally viable, acceptable next decisions are:
1. require a Worker plan/runtime budget that supports the secure cost;
2. use a separately reviewed password-hashing service/runtime through a private binding;
3. postpone account authentication.

Weak fast hashing such as plain SHA-256 is not an option.

## Proposed TOTP design

For authenticator-app compatibility:
- TOTP secret generated with cryptographically secure randomness;
- at least 160 bits of secret entropy;
- 30-second time step;
- 6 digits for standard authenticator compatibility unless product testing justifies 8;
- narrow server tolerance, proposed current step plus at most one adjacent step each side;
- persist the last successfully accepted time-step/counter and reject replay of that or older accepted step where clock handling permits;
- strict attempt limiting;
- enrollment secret/QR is shown only during explicit enrollment and never logged.

### TOTP secret at rest

Proposed:
- encrypt each TOTP secret before D1 storage with AES-256-GCM;
- encryption key comes from a Cloudflare Worker secret/secrets binding, never D1 or client code;
- random unique nonce per encryption;
- D1 stores ciphertext, nonce, key version and non-secret TOTP metadata;
- authenticated additional data should bind ciphertext to account/credential identity;
- key rotation supports decrypt-old/encrypt-new by key version;
- plaintext secret exists only transiently in Worker memory during enrollment/verification.

Database compromise alone should therefore not reveal TOTP seeds.

## Proposed recovery codes

Because email/SMS recovery is intentionally not required, strongly recommend one-time recovery codes at TOTP enrollment:
- multiple cryptographically random high-entropy codes;
- display once for offline storage by the administrator;
- persist only salted/derived hashes or keyed derivations, never plaintext;
- each code is single-use and revoked after successful use;
- using a recovery code creates an audit event and requires TOTP re-enrollment before normal privileged use;
- generating a new recovery set invalidates the old set.

Whether recovery codes are mandatory is an explicit acceptance decision.

## Proposed authenticated sessions

After password + TOTP succeeds:
- generate at least 32 random bytes for an opaque session secret;
- browser receives only an `HttpOnly; Secure` cookie using a `__Host-` name, `Path=/`, no `Domain`, and an appropriate SameSite policy;
- D1 stores only a SHA-256 or keyed hash of the session secret plus account id, created/expiry/revoked metadata and rotation/security version;
- rotate session after successful authentication and after sensitive account-security changes;
- logout/revocation is server-side;
- never put account session secrets in localStorage/sessionStorage;
- privileged routes re-evaluate active Organization membership/effective capabilities instead of trusting client claims.

Exact idle/absolute expiry remains to be accepted after admin UX testing.

## Login flow

Proposed two-step server-side flow:
1. username + password is verified against the password verifier;
2. TOTP/recovery factor is verified;
3. only after both factors succeed is a fully authenticated account session issued.

An intermediate challenge must be short-lived, opaque and server-revocable. It must not itself grant Organization/Admin APIs.

Failure responses should remain generic enough to avoid useful username/account enumeration.

## Rate limiting

Use Cloudflare Worker Rate Limiting bindings as one defense layer:
- login route-level limiter;
- canonical-username/account keyed limiter after safe lookup/canonicalization;
- TOTP/recovery challenge limiter;
- sensitive recovery/reset limiter.

The binding is permissive/eventually consistent and locality-scoped, so high-value account lockout/failure state may also require durable account-side counters/backoff. Exact combined policy must be tested before acceptance.

Do not rely only on source IP because shared mobile/NAT/privacy networks make IP-only limits both bypassable and harmful.

## CSRF / Origin / XSS

Because authenticated state uses cookies:
- authenticated writes require Origin/CSRF protection appropriate to same-origin architecture;
- keep restrictive CSP/output encoding;
- all username/form values render as inert text;
- account secrets never enter HTML except the one-time TOTP/recovery enrollment surface explicitly requiring display.

## Multiple Admin safety

- support multiple independent Admin accounts;
- no shared password/TOTP seed;
- never allow removal/disable/demotion of the last effective Organization Admin without an explicit safe transfer/recovery flow;
- TOTP reset/recovery, admin promotion/demotion and password reset are audited;
- one Admin never needs another Admin's password or TOTP secret to transfer authority.

## D1 implementation rules when eventually authorized

- additive migrations only;
- all SQL prepared/parameterized;
- password/TOTP/session/recovery material never interpolated into SQL strings;
- raw password, TOTP code, TOTP seed, recovery code and session secret never logged;
- sensitive compare paths use timing-safe comparison where runtime representation permits;
- no account table or migration before this ADR is accepted.

## Explicit non-goals

- no SMS 2FA;
- no mandatory email identity;
- no JWT-only stateless Admin authorization;
- no password in localStorage;
- no shared Organization Admin credential;
- no raw TOTP seed in D1;
- no lowering secure password-hash cost merely to meet current free-tier CPU.

## Open acceptance decisions

1. Confirm conservative username character/canonicalization policy.
2. Benchmark PBKDF2-HMAC-SHA-256 at the required secure cost on the actual Worker configuration and decide the runtime/plan path if it exceeds budget.
3. Confirm whether recovery codes are mandatory.
4. Choose authenticated session idle and absolute expiry.
5. Define account recovery if every Admin loses both TOTP and recovery codes.
6. Define legacy Campaign Admin/access-link migration interaction.

## Required threat-model review

`docs/architecture/IDENTITY_THREAT_MODEL.md` must be reviewed alongside this ADR. Implementation cannot start based on this ADR alone.
