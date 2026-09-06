---
id: status-current
type: status
status: active
last_updated: 2026-09-06
---

# Current Project State

## Aktive isolierte Linie: Organizer/Admin Platform

Plan 030 und Plan 031 werden ausschließlich auf `feature/organizer-admin-platform` gegen `mission-rxdb-sync` entwickelt. Draft-PR #76 bleibt Draft und ungemergt. PR #74/#75 bleiben getrennt; `mission-release-2026-09-02-manual` bleibt unangetastet. Kein Production-Deploy und keine Production-D1-Migration ohne separate ausdrückliche Freigabe.

### Aktuell verifizierter Product-Head

- Product-Head: `085d09078fc76278b9b60d43ad1c040de322c363`;
- PR #76: offen, Draft, ungemergt, Base `mission-rxdb-sync`;
- exact-head GitHub Actions CI: Run `34025756097`, vollständig erfolgreich;
- Product-Gates im persistenten und disposable Staging: Tests, Typecheck, Dependency Audit und Production Build grün.

### Persistentes manuelles Admin-Staging

- Branch `organizer-admin-staging`;
- Workflow `.github/workflows/admin-staging-persistent.yml`;
- Worker `flyer-map-admin-staging`;
- D1 `flyer-map-admin-staging-db`;
- URL: `https://flyer-map-admin-staging.cloudflare-eleven035.workers.dev`;
- persistenter Nachweis: Run `34025753720` (zusätzlich staging-branch Run `34025152382`);
- Artifact-Digest: `sha256:e0714439aa071e858ebbf83cf6e45540cdde95269b8856e56b3079f68c22f414`.

Dieser Run bestätigt:

- keine Datenänderung zwischen State-before und State-after;
- `PRAGMA foreign_key_check` ohne Fehler;
- `/start=200`, unauthenticated `/api/organization/me=401`, `HEAD=405`, fremder Origin `403`;
- `production_untouched=true`, `no_cleanup=true`;
- Secret-Generierung nur im leeren Zustand und keine Rotation bei bestehender Datenbank.

Der Setup-Key ist stabil an den persistenten Bootstrap-Digest gebunden und nur für den einmaligen `/start`-Bootstrap erforderlich. Sein Klartext liegt nicht im Repository, in Logs oder Artifacts. Der finale Klartext wird ausschließlich privat an den Nutzer übergeben.

Der aktuelle persistente Product-Deploy lief auf `085d09078fc76278b9b60d43ad1c040de322c363` erfolgreich durch, erhielt die manuelle D1 unverändert und rotierte keine bestehenden Secrets.

### Disposable Plan-031-Acceptance

- Workflow `.github/workflows/plan031-live-staging.yml`;
- Worker `flyer-map-admin-acceptance`;
- D1 `flyer-map-admin-acceptance-db`;
- aktueller grüner Run `34025856207`;
- auditiert exakt Product-Head `085d09078fc76278b9b60d43ad1c040de322c363`;
- Artifact: `plan031-live-staging-diagnostics`, ID `9987076941`, Digest `sha256:c22f11f5580d7eba787d3fb0ed45c5bdd60a63dced0d9c37b19bbcf6e060388b`.

Belegt sind die vollständige Room-/Credential-Lifecycle-Matrix, Recovery-Cleanup, additive Migration 0020 mit Recovery-Tabelle und Foreign Keys, Desktop-/Mobile-Browser ohne Overflow, der mobile Launcher mit `expanded` Initial-Snap, Root-/Method-/Origin-Safety und `production_untouched=true`. Die Acceptance-D1 wird nach dem Lauf bereinigt; sie ist nicht die manuelle Persistenz-D1.

### Harte Production-Isolation

Die kanonische `wrangler.jsonc` bleibt Production-sicher:

- `main`: `./worker/indexFc52.ts`;
- Production-D1: `0113e775-1e43-4d96-8b97-51fdeec7355b`;
- Production Rate-Limit Namespaces: `91714001`, `91714002`, `91714003`;
- kein `ORGANIZATION_LOGIN_LIMITER` in der committed Production-Konfiguration;
- `worker/indexOrganizer.ts` bleibt ausschließlich ein isolierter Organizer/Admin-Wrapper.

Production wurde durch das Admin-Staging nicht deployed und die Production-D1 wurde nicht migriert. Migrationen 0017/0018/0019 bleiben Production-unapplied.

## Noch offene Organizer/Admin-Master-Akzeptanz vor Production

Der isolierte laufende Staging-Stand ist grün und testbar. Das ist ausdrücklich noch keine Production-Freigabe. Vor Production müssen die verbleibenden Master-Gates separat und evidence-driven abgeschlossen werden:

1. explizite Legacy-Campaign-Adoption mit Audit und negativen Foreign-/Owned-/Race-Tests;
2. vollständige Account-Security-Matrix: Username/Password, sichere Reset-Links, TOTP-Reset, Recovery-Regeneration, Sessions einzeln/alle widerrufen;
3. mehrere Organizer/Admins inklusive concurrent last-organizer invariant;
4. Named Role Templates + serverbekannte Capability Registry;
5. own-team/other-team/explizite cross-team Durchsetzung an kanonischen Campaign/Team/Area/Task-Beziehungen;
6. Organizer-only permanente Campaign-Löschung mit fresh high-risk reauth und exakter Bestätigung;
7. Audit-/Threat-Model-/Rate-Limit-/CSP-Abschluss;
8. gewünschter Root-Organizer-Einstieg ohne die normale Field Map zu hijacken;
9. vollständige Admin-Console-/Lifecycle-UX ohne Fake-KPIs;
10. komplette RxDB-/Field-Regressionsuite weiter grün halten.

## Arbeitsregel bei Wiederaufnahme

GitHub ist Source of Truth. Zuerst `AGENTS.md`, diese Datei, `docs/context-map.yaml`, danach `docs/context-organizer-admin.yaml`, `docs/context-organizer-admin-live.yaml`, Plan 030, Plan 031, ADR-0026, ADR-0014 und den aktuellen Handoff lesen. Remote-Heads, PR #76, exact-head CI, persistenten Run und aktuellen Acceptance-Run immer neu verifizieren; dokumentierte SHAs sind Übergabemarker.
