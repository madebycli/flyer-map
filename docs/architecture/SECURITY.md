---
id: architecture-security
type: architecture
status: accepted
last_updated: 2026-08-24
related: [architecture-data, product, ADR-0009]
source_of_truth_for: [authorization, privacy-baseline]
---

# Security and Privacy

## Baseline

The client is untrusted. Every protected request is authorized and every state-changing payload is validated by the Cloudflare Worker. React button visibility is a UX convenience, never the authorization boundary.

A Campaign id in `?campaign=` or an API route is a selector only. It is not a secret and is never proof of authorization.

## M4 access model

The MVP uses revocable Campaign-scoped access grants rather than mandatory user accounts.

Roles:
- `admin`;
- `team-editor`;
- `viewer`.

Permission matrix:

| Capability | Admin | Team Editor | Viewer |
| --- | --- | --- | --- |
| Read snapshot/version | yes | yes | yes |
| Rename/configure Campaign | yes | no | no |
| Set/remove Campaign map focus | yes | no | no |
| Manage Teams | yes | no | no |
| Create/edit/delete scoped Areas | yes | own Team only | no |
| Reassign Area ownership | yes | no | no |
| Create/edit/delete Tasks/status | yes | own Team's Areas only | no |
| Modify another Team's data | yes | no | no |
| Create/revoke Access Links | yes | no | no |

The Worker enforces this matrix on every write. M4 retains complete-snapshot PUTs, so Team Editor authorization loads the previous server snapshot and compares it to the proposed snapshot before persistence. Campaign settings, Teams, foreign Areas/Tasks and ownership reassignment are rejected server-side.

## Invite tokens and sessions

Each access grant contains a cryptographically random bearer token generated from 32 random bytes. The plaintext token is returned only when the grant is created and is never persisted in D1.

D1 stores:
- Campaign scope;
- role;
- optional Team scope;
- SHA-256 token hash;
- optional label;
- `created_at`;
- `revoked_at`.

Invite links put the bearer token in the URL fragment rather than the query string. Fragments are not sent as part of ordinary HTTP requests. The browser extracts the token, posts it once to the Worker redemption endpoint and removes the fragment from the visible URL.

Successful redemption creates a separate opaque random session secret. The Worker sets it in a `Secure; HttpOnly; SameSite=Lax` cookie and stores only its SHA-256 hash in D1.

Every protected request joins the session to its backing access grant and requires `revoked_at IS NULL`. Revoking a grant therefore invalidates both the original invite link and all sessions backed by that grant on their next request.

A credential scoped to one Campaign cannot authorize another Campaign.

## Existing pre-M4 Campaigns

M3 Campaigns have no owner credential. They are never assigned to the first browser that asks.

The first Admin grant for an existing Campaign can be created only through the explicit M4 bootstrap endpoint while:
- a deployment-only `M4_BOOTSTRAP_SECRET` is configured;
- the caller supplies that secret;
- the Campaign already exists;
- the Campaign currently has zero access grants.

After bootstrap, a second bootstrap attempt for the same Campaign is rejected. The deployment secret is not committed and should be removed/rotated after all intended legacy Campaigns are bootstrapped.

## New Campaigns

A newly created Campaign receives a fresh Admin grant and session as part of the creation flow. The initial Admin invite token is returned once so the creator can retain/share a recovery access link. Knowing the new Campaign id alone still does not authorize later reads or writes.

## Request protections

- protected Campaign snapshot and version endpoints require a valid session;
- Viewer PUT requests are rejected with 403;
- invalid/missing credentials return 401;
- cross-Campaign credentials fail authorization;
- payloads are size-bounded and schema/geometry/ownership validated before persistence;
- optimistic revision conflicts return 409;
- browser state-changing requests are same-origin restricted when an Origin header is present;
- browser cookies use `SameSite=Lax` in addition to same-origin API use.

## GPS and camera privacy

The MVP does not upload or persist continuous device location.

The browser may use location locally to orient the map. No movement history is created by Verteil-Flyer. Personal camera center/zoom/bearing is stored only in that browser and is not sent to D1 merely because the user moves the map.

The shared Campaign map focus is configuration, not a GPS history.

## Secrets

Never commit:
- Cloudflare API tokens;
- bootstrap secrets;
- plaintext production invite/access links;
- session secrets;
- private Campaign exports.

A real D1 `database_id` is deployment configuration and may appear in `wrangler.jsonc`; it is not a database credential. Never invent a fake one.

Use Cloudflare secrets for `M4_BOOTSTRAP_SECRET` and any later server-only secret.

## Data minimization

Access grants do not require a person's name, email address, phone number or device identifier. Optional labels are operational labels chosen by the Admin, such as “Team Nord Tablet”.

Do not collect personal identity data unless a later product requirement demonstrates a concrete need.

See ADR-0009 for the durable access-link/session decision and its tradeoffs.
