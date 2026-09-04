---
id: operations-organizer-admin-staging
type: operations
status: active
last_updated: 2026-09-04
related: [plan-030-organizer-admin-platform, ADR-0026, plan-028-rxdb-local-first-mission-sync]
---

# Organizer/Admin Staging

## Zweck

Organizer/Admin benötigt eine vollständig isolierte Cloudflare-Testlinie. Sie darf weder Production-D1/Worker noch das bestehende RxDB-Staging für Organization-/Credential-Migrationen wiederverwenden.

## Geschützte Ressourcen

Production:

- Worker-Konfiguration im Repository: `wrangler.jsonc`;
- Entry Point: `./worker/indexFc52.ts`;
- D1: `0113e775-1e43-4d96-8b97-51fdeec7355b`;
- Rate-Limit Namespaces: `91714001`, `91714002`, `91714003`.

RxDB-Staging:

- Worker: `flyer-map-staging`;
- D1: `bcec3432-18ec-42a2-970a-64d52c8263d5`.

Diese Ressourcen dürfen von Admin-Staging nicht als Organization-D1 oder Organizer-Worker benutzt werden.

## Dedizierte Admin-Staging-Ziele

- Branch: `organizer-admin-staging`;
- Worker: `flyer-map-admin-staging`;
- D1-Name: `flyer-map-admin-staging-db`;
- Organizer Entry Point: `worker/indexOrganizer.ts`;
- Organization Password KDF Durable Object: `OrganizationPasswordKdfDurableObject`;
- eigene Rate-Limit Namespaces, getrennt von Production und RxDB-Staging;
- `ORGANIZATION_TOTP_KEY` ausschließlich als Worker Secret;
- Bootstrap-Secret ausschließlich serverseitig/hash-basiert, nie in Repository, URL oder öffentlichen Logs.

## Aktueller Handoff-Hinweis

Auf `organizer-admin-staging` existiert eine Workflow-Generation `admin-staging-release-v6.yml`. Sie wurde gegen einen älteren Organizer-Head gebaut und enthält eine inzwischen falsche Annahme: sie erwartet vor der Staging-Materialisierung, dass die committed `wrangler.jsonc` bereits `./worker/indexOrganizer.ts` als `main` verwendet.

Die kanonische Production-Konfiguration wurde danach absichtlich auf `./worker/indexFc52.ts` zurückgesetzt. Deshalb darf die V6-Fassung nicht blind erneut deployed werden.

## Erforderlicher Fix vor dem nächsten Staging-Deploy

1. Frischen `feature/organizer-admin-platform` Head und erfolgreiche CI verifizieren.
2. Staging-Branch ausschließlich von diesem geprüften Head aktualisieren.
3. Committed `wrangler.jsonc` zuerst gegen die Production-Baseline prüfen (`indexFc52.ts`, Production-D1, nur Production Rate-Limit 91714001-3).
4. Eine **separate temporäre/deploy-spezifische Admin-Konfiguration** materialisieren, die ausschließlich für Admin-Staging:
   - `worker/indexOrganizer.ts` nutzt;
   - `flyer-map-admin-staging-db` bindet;
   - `OrganizationPasswordKdfDurableObject` bindet und migriert;
   - eigene Organization-Login- und bestehende Rate-Limit Namespaces benutzt;
   - niemals Production-/RxDB-Staging-D1 referenziert.
5. Migrationen 0018/0019 ausschließlich auf der isolierten Admin-D1 anwenden.
6. Vor echtem Deploy Tests, Typecheck, Dependency Audit, Build und Wrangler Dry Run ausführen.
7. Reales Runtime-Smoke durchführen: `/start`, Bootstrap, Passwort-Challenge, TOTP, `/me`, Logout, erneuter Login. Secrets maskieren und private temporäre Antworten nicht als Artifact hochladen.
8. Disposable Smoke-Identity/Organization nach Prüfung entfernen oder eine explizit definierte Testidentität sicher behandeln.
9. Finale Konfiguration ohne Diagnostics/Smoke-Bootstrap-Secret deployen.
10. URL und isolierte Resource-IDs erst nach erfolgreicher Safety-Prüfung als Teststand dokumentieren.

## Safety Checks

Jeder Admin-Staging-Workflow muss fail-closed prüfen:

- Admin-D1-ID ist weder Production-D1 noch RxDB-Staging-D1;
- Worker-Name ist `flyer-map-admin-staging`;
- generierte Admin-Konfiguration enthält die Organization-KDF-DO-Bindung;
- generierte Admin-Konfiguration enthält keine geschützte D1-ID;
- Production `wrangler.jsonc` bleibt im Commit unverändert;
- keine Secrets in `set -x`, JSON-Artifacts, HTML-Artefakten oder GitHub-Logs;
- `/api/organization/me` ist ohne Session 401;
- Organization-Schreibrequest mit fremdem Origin wird abgewiesen;
- alte/rotierte Bootstrap-Credentials funktionieren im finalen Stand nicht;
- finale Worker-Antworten tragen die vorgesehenen Security Header.

## Production-Gate

Ein erfolgreiches Admin-Staging ist **keine** Production-Freigabe. Production-D1-Migrationen 0017/0018/0019, Production-Worker-Wechsel, PR-Merge oder Ready-for-Review benötigen einen separaten ausdrücklichen Auftrag.
