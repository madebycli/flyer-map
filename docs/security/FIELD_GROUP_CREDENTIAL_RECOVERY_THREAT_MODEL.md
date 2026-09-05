
# Field Group Credential Recovery Threat Model

## Scope

Plan 031 adds manager-only re-display of the currently active Field Group Room Code and QR token. Join lookup remains hash-based. The additional recoverable copy is AES-256-GCM ciphertext only and is never client-persisted.

## Assets and trust boundaries

- `FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY` is a dedicated Worker secret, separate from Organization TOTP or bootstrap material.
- D1 stores lookup hashes plus IV/ciphertext, never plaintext.
- Browser receives plaintext only after canonical server-side manager authorization and with `Cache-Control: no-store`.
- Campaign, Group and Team ids are selectors, never credentials.

## AAD and tenant binding

AES-GCM additional authenticated data binds version, Campaign id, Group id, credential id and credential kind. Copying ciphertext between tenants, groups, credential rows or kinds therefore fails authentication.

## Key lifecycle

The first accepted format is key version 1 with exactly 32 random bytes encoded as base64url. Staging configures the key independently. Production key provisioning and Production migration remain outside Plan 031. Key loss makes reveal fail closed but does not make lookup hashes reversible.

## Legacy active Rooms

Rooms created before migration 0020 have hash-only credentials. They remain joinable while valid, but reveal returns `credential_recovery_unavailable`. A manager may explicitly rotate to create a new recoverable current credential pair. Reveal never rotates implicitly.

## Rotation, revoke, close and expiry

Rotation revokes old lookup rows and deletes their recoverable ciphertext before adding the new current pair. Existing memberships are unchanged. Revoke, close and expiry remove recoverable ciphertext for the revoked pair. No old plaintext can be reconstructed through the reveal endpoint afterward.

## Corruption and tampering

Invalid key material, malformed IV/ciphertext, wrong AAD or AES-GCM authentication failure returns a generic fail-closed recovery error. Secret material is never copied into errors, audit events or logs.

## Rollback

Rolling back application code leaves additive ciphertext rows inert. Migration 0020 must not be rolled back by destructive Production DDL. A code rollback cannot turn ciphertext into join authority because joins continue to resolve only against active lookup hashes.

## Authorization abuse cases

- Admin: may reveal active Rooms in the Campaign.
- Team Editor: may reveal only Rooms belonging to the canonical server-side Team scope.
- Viewer and temporary Field Group member: denied.
- Foreign Campaign/Team/Group selectors never widen access.
