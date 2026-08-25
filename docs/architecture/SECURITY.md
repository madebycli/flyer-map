---
id: architecture-security
type: architecture
status: accepted
last_updated: 2026-08-25
related: [architecture-data, product, product-roadmap, architecture-organizations, architecture-identity-permissions, architecture-live-teams, ADR-0009, plan-012-platform-app-expansion]
source_of_truth_for: [authorization, privacy-baseline, current-access-model, future-security-boundaries]
---

# Security and Privacy

## Baseline

The client is untrusted.

Every protected request is authorized and every state-changing payload is validated by the Cloudflare Worker. React/UI visibility is never the authorization boundary.

Campaign ids, future Organization ids and domain ids are selectors only. They are never credentials.

## Current Campaign access model

Current roles:
- `admin`;
- `team-editor` scoped to one Team;
- `viewer`.

| Capability | Admin | Team Editor | Viewer |
| --- | --- | --- | --- |
| Read Campaign snapshot/version | yes | yes | yes |
| Campaign settings/map focus | yes | no | no |
| Manage Teams | yes | no | no |
| Create/edit/delete Areas | yes | own Team only | no |
| Create/edit/delete Tasks/status | yes | own Team Areas only | no |
| Modify another Team | yes | no | no |
| Create/revoke Campaign Access Links | yes | no | no |

The Worker enforces scope on every write.

## Current access grants and sessions

Access grant token:
- cryptographically strong random bytes;
- plaintext returned only when created;
- D1 stores SHA-256 hash, role/scope/metadata only.

Invite links carry tokens in URL fragments. Browser redeems the fragment and removes it from the URL.

Successful redemption creates a separate opaque session secret in a `Secure; HttpOnly; SameSite=Lax` cookie. D1 stores only its hash.

Revoking the backing grant invalidates backed sessions on their next protected request.

## Current Team Editor scope

Team Editor grant creation verifies scoped Team exists. Access resolution also verifies the Team still exists.

## Current bootstrap / operator recovery

Legacy Campaigns are never assigned to the first visitor.

Initial bootstrap/recovery remains protected by the server-only configured secret flow described by current accepted ADR/docs.

Campaign id alone never creates ownership.

## Request protections

Current and future protected routes require:
- valid authorized server-side session/credential state;
- payload schema/size/domain validation;
- revision/conflict handling rather than silent overwrite;
- same-origin/CSRF protections where applicable;
- secrets verified server-side only.

## Future Organizations and accounts

Multi-organization administration is planned but not implemented by current Campaign roles.

Before implementation, accepted ADR(s) must define:
- Organization identity/membership/session behavior;
- username/password/TOTP account security;
- role/capability semantics;
- legacy Campaign Admin migration.

Mandatory properties:
- Organization is tenant boundary;
- no cross-Organization reads/writes/statistics/comments/activity;
- multiple Organization Admins supported;
- safe admin handover/recovery;
- Campaign Admin is not silently treated as Organization Admin;
- membership/revocation enforced server-side;
- privileged admin/permission/security actions audited.

See `docs/architecture/ORGANIZATIONS.md` and `docs/architecture/IDENTITY_PERMISSIONS.md`.

## Future username/password/TOTP security

Requested administrator login model:
- username;
- password;
- authenticator-app TOTP;
- no SMS requirement;
- no mandatory email identity.

Security requirements:
- raw passwords never stored or logged;
- reviewed password hashing strategy with unique salts and appropriate cost;
- no home-grown password cryptography;
- TOTP secrets generated securely and protected at rest;
- TOTP codes/secrets never logged;
- login creates/rotates opaque revocable sessions;
- login/TOTP endpoints rate-limited;
- narrow server-side TOTP time tolerance;
- security-sensitive recovery/reset audited;
- last effective Organization Admin cannot be accidentally removed without safe transfer/recovery.

## Injection resistance

All user-controlled input is inert data.

Mandatory:
- never concatenate username/password/code/comment/form input into SQL;
- use D1 prepared/parameterized queries;
- never pass user input to `eval`, dynamic code execution, shell execution or raw HTML rendering;
- safely encode output;
- prefer a restrictive CSP;
- validation helps correctness but security must not depend on blacklisting suspicious strings.

If an attacker types SQL, HTML, JavaScript or other code-like text into a username/password/form field, it must remain data and never execute.

## Future capability authorization

Future configurable permissions must be evaluated server-side on every privileged operation.

Rules:
- deny by default;
- Organization boundary cannot be overridden;
- UI toggles do not grant permission;
- permission changes are audited;
- authentication and authorization remain separate steps.

## Live Field Group security

Future live groups/QR/team codes must not become backdoors around persistent access policy.

Requirements:
- discoverability limited to authorized Campaign context;
- no public internet directory;
- random/non-sequential temporary codes;
- expiry/revocation;
- rate limiting/brute-force resistance;
- optional join passwords handled as secrets, not plaintext storage;
- QR contains minimum required join material;
- Field Group join never grants Admin automatically;
- temporary group credentials are distinct from persistent Team/Admin invites.

See `docs/architecture/LIVE_TEAMS.md`.

## Comments, activity, sessions and statistics

Future collaboration/reporting endpoints enforce server-side scope.

Automations cannot bypass caller/system authorization.

Statistics/session highlighting derives from Task/domain events, not continuous GPS surveillance.

## GPS and presence privacy

The product does not upload/persist continuous device location history by default.

One-shot browser location may orient the map.

Future live groups may expose limited operational presence where useful, but must not require exact live GPS trails or permanent device fingerprinting.

## Secrets

Never commit or paste into normal project communication:
- Cloudflare API tokens;
- bootstrap/recovery secrets;
- plaintext production Access Links/tokens;
- session secrets;
- passwords;
- TOTP secrets/codes;
- private Campaign/Organization exports.

A D1 database id is configuration, not a credential.

## Data minimization

Collect only data needed for explicit product/security requirements.

Field Sessions may store operational values such as date, duration, participant count and Task events. They should not become individual movement surveillance.

Future Organization identity should not collect email/phone merely because account systems often do so if username/password/TOTP meets the accepted product/security design.
