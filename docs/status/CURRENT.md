---
id: status-current
type: status
status: active
last_updated: 2026-09-04
---

# Current Project State

## Aktive isolierte Linie: Organizer/Admin Platform

Plan 030 ist die aktuell fortzusetzende Produktlinie. Sie wird ausschließlich auf `feature/organizer-admin-platform` gegen `mission-rxdb-sync` entwickelt. Draft-PR #76 bleibt Draft und ungemergt. PR #74/#75 bleiben getrennt; der Rollback-Branch `mission-release-2026-09-02-manual` bleibt unangetastet. Kein Production-Deploy und keine Production-D1-Migration ohne separate ausdrückliche Freigabe.

Am 2026-09-04 wurde als letzter vor diesem Dokumentations-Handoff verifizierter Feature-Head `fb437e2f23fc7c851ecd219cfb6ff38991bb95b2` (`fix: restore production worker isolation`) geprüft. CI-Run `33874224651` / #1077 ist auf genau diesem Head erfolgreich. Ein neuerer Head muss bei Wiederaufnahme immer erneut gegen GitHub verifiziert werden.

### Harte Production-Isolation

Die kanonische `wrangler.jsonc` bleibt Production-sicher:

- `main`: `./worker/indexFc52.ts`;
- Production-D1: `0113e775-1e43-4d96-8b97-51fdeec7355b`;
- Production Rate-Limit Namespaces: `91714001`, `91714002`, `91714003`;
- kein `ORGANIZATION_LOGIN_LIMITER` in der committed Production-Konfiguration;
- `worker/indexOrganizer.ts` ist nur der Organizer/Admin-Wrapper und darf nur in einer ausdrücklich isolierten Admin-Staging-/später freigegebenen Deploy-Konfiguration als Entry Point verwendet werden.

`tests/pickupReadRuntime.test.ts` schützt diese Worker-Kette als Regression: Production zeigt auf `indexFc52.ts`; der Organizer-Wrapper importiert `indexFc52.ts`. Diese Grenze nicht erneut durch ein scheinbar bequemes Wrangler-Umschalten aufweichen.

### Bereits vorhandene Organizer/Admin-Bausteine

Aktuell im Feature-Branch vorhanden und vor weiterer Arbeit zu verifizieren:

- additive Organization-/Identity-Migrationen `0018_organization_admin_platform.sql` und `0019_organization_security_hardening.sql`;
- Organization Auth/API/Security Runtime unter `worker/organization*.ts`;
- `worker/indexOrganizer.ts` als isolierter Wrapper;
- Password-KDF über `OrganizationPasswordKdfDurableObject`, damit PBKDF2 nicht unkontrolliert im normalen Worker-Request-Budget läuft;
- `/start`, `/login`, `/admin`, `/new`, `/admin/campaign/:id` unter `src/organization/*`;
- TOTP-/Recovery-/Session- und Security-Center-Bausteine;
- Organization-spezifische Tests (`tests/organization*.test.ts`) sowie bestehende Field-/RxDB-Regressionssuite.

Das Vorhandensein einer Datei bedeutet noch nicht, dass jedes Master-Akzeptanzkriterium vollständig geschlossen ist. Der nächste Agent muss positive und negative Server-Tests sowie die reale Browser-E2E-Matrix gegen den aktuellen Head prüfen.

### Noch offene Organizer/Admin-Release-Gates

Vor einem Test-Link als „fertig“ bzw. vor Production-Readiness müssen insbesondere vollständig verifiziert oder ergänzt werden:

1. sichere, explizite Legacy-Campaign-Adoption ohne Auto-Claim;
2. Admin-/Organizer-Invite-Enrolment im sauberen Browser inklusive Passwort, TOTP und Recovery-Codes;
3. Organizer-Verwaltung von Admins und Schutz des letzten aktiven Organizers;
4. Role Templates aus serverbekanntem Capability-Registry-Vertrag und serverseitige Durchsetzung von own-team vs. cross-team Rechten;
5. Security-Flows: Username-/Passwortänderung, sichere Reset-Links, TOTP-Reset, Recovery-Regeneration, Sessions anzeigen/einzeln/alle widerrufen und High-Risk-Reauth;
6. Organizer-only permanente Campaign-Löschung mit frischer Reauth und exakter Bestätigung;
7. Audit-/Security-Ereignisse und fail-closed Tenant-Grenzen;
8. gewünschter Organizer-Einstieg von `/`, ohne den normalen Field-Map-Flow zu übernehmen;
9. vollständiger Campaign-Admin-Console-/Responsive-UX-Stand ohne Fake-Daten;
10. Regression: kompletter RxDB-/Field-Flow bleibt grün;
11. separates Admin-Staging mit eigenem Worker, eigener D1, eigenen Rate-Limit Namespaces und Organization-KDF-DO;
12. echtes Browser-E2E: Bootstrap/Login/TOTP/Recovery, Campaign erstellen, Logout, Cookie-Clear, erneuter Login und Multi-Campaign-Persistenz.

Der aktuelle detaillierte Übergabeprompt liegt in `docs/prompts/CONTINUE_ORGANIZER_ADMIN_LATEST.md`. Die Organizer/Admin-Kontext-Erweiterung liegt zusätzlich in `docs/context-organizer-admin.yaml` und ist für diese Linie nach den drei normalen Entry-Points zu laden.

## Admin-Staging-Grenze

Der Branch `organizer-admin-staging` und die dortige Workflow-Generation sind eine isolierte Testlinie, aber die zuletzt vorhandene V6-Workflow-Fassung basiert auf einem älteren Organizer-Head und nahm zeitweise an, dass die kanonische `wrangler.jsonc` auf `indexOrganizer.ts` zeigt. Diese Annahme ist nach der Production-Isolation-Regressionskorrektur falsch. Vor dem nächsten Deploy muss der Staging-Workflow aus dem aktuellen Feature-Head neu abgeleitet werden: committed Production-Konfiguration unverändert lassen und nur für Admin-Staging eine explizite Organizer-Entry-Point-Konfiguration materialisieren. Details: `docs/operations/ORGANIZER_ADMIN_STAGING.md`.

## Verifizierte RxDB-Mission-Basis – nicht regressieren

Der RxDB-Kandidat liegt auf `mission-rxdb-sync`; Draft-PR #74 bleibt offen, Draft und ungemergt. Die Mission-Linie hat bereits einen verifizierten Multi-Device-Sync-/MapLibre-Renderer-Stand. D1 bleibt kanonisch; RxDB/Dexie hält die lokalen operativen Campaign-Daten, Worker/D1 bleiben Autoritäts- und Sicherheitsgrenze. Campaign-Durable-Object/WebSocket-Nachrichten sind nur Invalidierungs-Hinweise; kanonische Daten werden per HTTP/RxDB gezogen.

Geschlossene P0s, die bei Organizer/Admin-Arbeit nicht zurückkehren dürfen:

- Prepared-Street Realtime-Callback wird innerhalb des `waitUntil()`-getragenen Preparation-Promises awaited;
- MapLibre-Live-Sync verwirft keine React-Updates nur weil `isStyleLoaded()` temporär false ist;
- sichtbare Street-Create/Status/Delete-Synchronisierung wurde im Zwei-Browser-Gate ohne Reload geprüft;
- automatische Area-Vorbereitung bleibt auf der Mission-Linie absichtlich nicht der normale automatische Flow; manuelle Streets/Houses bleiben unterstützt.

Migration `0017_rxdb_sync_changes.sql` wurde nur in isoliertem RxDB-Staging angewendet. Production bleibt ohne 0017, 0018 oder 0019, bis ein separater Release-/Migrationsauftrag das ausdrücklich freigibt.

## Arbeitsregel bei Wiederaufnahme

GitHub ist Source of Truth. Zuerst `AGENTS.md`, diese Datei, `docs/context-map.yaml`, danach `docs/context-organizer-admin.yaml`, Plan 030, ADR-0026 und den aktuellen Handoff-Prompt lesen. Danach Remote-Heads, PR #76 und CI selbst verifizieren. Nicht blind auf in Dokumenten genannte SHAs vertrauen; sie sind Übergabemarker, keine unveränderlichen Wahrheiten.
