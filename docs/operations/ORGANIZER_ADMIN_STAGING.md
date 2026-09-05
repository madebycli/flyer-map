---
id: operations-organizer-admin-staging
type: operations
status: active
last_updated: 2026-09-05
related: [plan-030-organizer-admin-platform, ADR-0026, plan-028-rxdb-local-first-mission-sync]
---

# Organizer/Admin Staging

## Zweck

Organizer/Admin verwendet eine vollständig isolierte Cloudflare-Testlinie. Production-D1/Worker und RxDB-Staging dürfen für Organization-/Credential-Migrationen niemals wiederverwendet werden.

## Geschützte Ressourcen

Production:

- committed `wrangler.jsonc`;
- Entry Point `./worker/indexFc52.ts`;
- D1 `0113e775-1e43-4d96-8b97-51fdeec7355b`;
- Rate-Limit Namespaces `91714001`, `91714002`, `91714003`.

RxDB-Staging:

- Worker `flyer-map-staging`;
- D1 `bcec3432-18ec-42a2-970a-64d52c8263d5`.

## Dedizierte Admin-Staging-Ziele

- Branch `organizer-admin-staging`;
- Worker `flyer-map-admin-staging`;
- D1 `flyer-map-admin-staging-db`;
- Organizer Entry Point `worker/indexOrganizer.ts`;
- Organization Password KDF DO `OrganizationPasswordKdfDurableObject`;
- separate Staging Rate-Limit Namespaces `91914001`, `91914002`, `91914003`, `91914004`;
- `ORGANIZATION_TOTP_KEY` nur als Worker Secret;
- Bootstrap nur hash-basiert serverseitig.

## Kanonischer Release-Gate: V9

Workflow: `.github/workflows/admin-staging-release-v9.yml`.

Der Workflow muss einen exakten grünen Feature-Commit über `AUDITED_SOURCE_SHA` auditieren und erlaubt gegenüber diesem Source-Baum ausschließlich die drei Staging-Harness-Dateien als Abweichung:

- `.github/workflows/admin-staging-release-v9.yml`;
- `.staging/admin-v9-release.sh`;
- `.staging/admin-v9-browser.mjs`.

Staging-spezifische Secrets/Digests dürfen nur in der isolierten Workflow-/Runner-Konfiguration vorkommen. Der Klartext des finalen einmaligen Bootstrap-Testschlüssels darf niemals ins Repository oder Artifact.

## Erster vollständig grüner Lauf

V9 Run `33924415528` / #23 auf Staging-Head `6414aad45489cd2800e7dcf2f9e6bc917e4106b2` war vollständig erfolgreich und auditierte Runtime-Source `c62385a8c400f68753d1f1f811e2315551153885`.

Belegt wurden:

- exact-source derivation;
- Tests, Typecheck, Dependency Audit, Production Build;
- Admin-D1-/Production-/RxDB-Isolation;
- Migrationen nur auf `flyer-map-admin-staging-db`;
- Candidate-Version-Pinning über `Cloudflare-Workers-Version-Overrides`;
- 5-fache Candidate-Konvergenz;
- Bootstrap -> Password -> TOTP -> `/me`;
- Campaign A+B + Fresh-Browser-Persistenz;
- Clean-Browser Admin Invite + Token-Scrubbing + MFA;
- Mobile Chromium 390x844 ohne Overflow;
- Cleanup auf 0 Organization-Testdaten und fehlerfreie Foreign Keys;
- finaler ungepinnter public-worker Safety-Gate.

## Static Asset Security Headers

Cloudflare Workers Static Assets können HTML direkt vor dem Worker bedienen. Deshalb reicht die Härtung in `worker/indexOrganizer.ts` für `/start` und andere statische Antworten nicht aus.

`public/_headers` setzt für alle statischen Assets:

- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `Cross-Origin-Opener-Policy: same-origin`.

V9 prüft die Header sowohl für statisches `/start` als auch für Worker-generierte API-Antworten. Dieses Gate nicht abschwächen.

## Release-Ablauf

1. Feature-Head, PR #76 und exact-head CI neu verifizieren.
2. Committed Production Wrangler gegen `indexFc52.ts`, Production-D1 und 91714001-3 prüfen.
3. Exakte Staging-Derivation gegen den auditierten Source-Head prüfen.
4. `npm ci`, Tests, Typecheck, Dependency Audit, Production Build.
5. Isolierte Admin-Konfiguration materialisieren; Production-/RxDB-D1 IDs fail-closed ausschließen.
6. Migrationen ausschließlich auf `flyer-map-admin-staging-db` anwenden.
7. Candidate deployen und exakte Worker-Version für API/Browser-Smokes pinnen.
8. API-Smoke und Chromium-Acceptance vollständig ausführen.
9. Testdaten remote bereinigen und Foreign Keys prüfen.
10. Finalen Worker ohne Diagnostics und mit finalem Bootstrap-Digest deployen.
11. Version-Pin entfernen und die echte öffentliche `workers.dev`-URL prüfen.
12. Erst nach grünem Final-Safety-Gate `test-url.txt` und `final-safety.json` erzeugen.

## Final Public Safety

Der ungepinnte finale Worker muss mindestens erfüllen:

- `GET /start` 2xx/3xx;
- unauthenticated `/api/organization/me` = 401;
- `HEAD /api/organization/me` = 405, niemals SPA HTML 200;
- fremder Origin auf Organization-Schreibroute = 403;
- rotierte Smoke-Bootstrap-Credentials = 403;
- statische und API Security Header vollständig;
- bereinigte Admin-D1 und keine Foreign-Key-Verletzung.

## Credential-Regel für Benutzer-Test

Der finale Teststand ist nach V9 bewusst leer. Für den ersten Organizer wird ein einmaliger Bootstrap-Testschlüssel verwendet. Das Repository enthält nur dessen SHA-256. Der Klartext darf erst nach einem vollständig grünen Final-Run über einen privaten Übergabekanal an den Tester gegeben werden. Nach erfolgreichem Bootstrap ist der Schlüssel verbraucht.

## Production-Gate

Ein grünes Admin-Staging ist keine Production-Freigabe. Production-D1-Migrationen 0017/0018/0019, Production-Worker-Wechsel, PR-Merge oder Ready-for-Review benötigen weiterhin einen separaten ausdrücklichen Auftrag.
