# MASTER PROMPT – Nächste Entwicklungsphase von `madebycli/flyer-map`

Du übernimmst die nächste Entwicklungsphase des bestehenden GitHub-Projekts `madebycli/flyer-map`.

## Arbeitsmodus

Arbeite **direkt am bestehenden Repository weiter**. Nicht neu anfangen, nichts resetten, keine Architektur aus Chat-Erinnerung rekonstruieren. GitHub/Repository ist die einzige Source of Truth für Branches, Heads, PRs, CI, Dateien, Implementierungsstand und Staging.

Dieser Prompt ist ein Ausführungsauftrag, kein Auftrag für eine reine Planung. Du sollst analysieren, reproduzieren, implementieren, testen, committen, pushen, exact-head CI prüfen und isoliertes Staging akzeptieren. Höre nicht mitten in einem lösbaren Fehler auf. Wenn ein Gate fehlschlägt, lies die echten Logs, finde die Ursache und arbeite weiter. Stoppe nur bei einem echten externen Permission-/Billing-/Secret-/Device-Blocker, den du nicht selbst auflösen darfst oder kannst.

## Verlustfreier Context-Bootstrap

Lies zuerst in dieser Reihenfolge:

1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`
4. `docs/context-organizer-admin.yaml`
5. `docs/context-organizer-admin-live.yaml`
6. `docs/context-field-ui-navigation.yaml`
7. `docs/status/ORGANIZER_ADMIN_LIVE_HANDOFF.md`
8. `docs/plans/active/030-organizer-admin-platform.md`
9. `docs/plans/active/031-field-ui-navigation-rooms-sheets.md`
10. `docs/decisions/ADR-0026-organization-admin-identity-and-authorization.md`
11. `docs/operations/ORGANIZER_ADMIN_STAGING.md`
12. `docs/SYNC_REQUIREMENTS_FOR_STREET_ENGINE.md`, wenn der Pfad auf dem relevanten Street-Branch vorhanden ist
13. `docs/reports/2026-09-07-current-development-audit.md`
14. `docs/context-replan-2026-09-07.yaml`

Folge danach den Kanten und `load_when`-Hinweisen des Graphen für jede Domäne, die du anfasst. **Keine geplante oder bereits implementierte Funktion darf stillschweigend verloren gehen.**

## Phase 0 – Remote-Wahrheit neu verifizieren

Bevor du Code änderst:

- verifiziere `feature/organizer-admin-platform` Remote-Head;
- verifiziere `mission-rxdb-sync` Remote-Head;
- verifiziere `feature/established-street-preparation-engine` Remote-Head;
- verifiziere `mission-release-2026-09-02-manual`;
- verifiziere PR #74/#75/#76: open/Draft/unmerged, aktuelle Base/Head-SHAs;
- verifiziere exact-head CI des aktuellen Product-Heads;
- verifiziere den neuesten Organizer-/Plan-031-Staging-Run und dessen echten Failed/Passed Step;
- verifiziere, welche Version aktuell unter dem isolierten Staging-Link läuft.

Die in Dokumenten genannten SHAs sind nur Übergabemarker. Remote gewinnt immer.

## Phase 0.5 – Feature Preservation Ledger

Erzeuge vor Implementierung eine kurze Arbeitsmatrix aus Context-Graph + Plan 030 + Plan 031 + Street/Sync-Vertrag:

- Feature/Invariant
- Source-Dokument
- aktueller Codepfad
- verifiziert implementiert / teilweise / offen
- zugehörige Tests
- darf dieser Workstream es ändern?

Nutze diese Matrix während der Arbeit als Regressionsschutz. Besonders schützen:

- map-first Field UX;
- Campaign-/Team-/Area-/Task-Daten;
- bestehende manuelle Status-/Completion-Daten;
- Offline-Verhalten;
- Access-Link-/Join-Flows;
- Organization-/Campaign-Tenant-Isolation;
- Room Credential Rotation ohne Membership-Verlust;
- Field Launcher Struktur;
- Street Save/Close -> Map;
- D1 als kanonische Sync-Grenze;
- Stable Street IDs und Tombstones;
- Production-Isolation.

## Phase 1 – aktuellen Product-Head wieder live exakt akzeptieren

Der aktuelle Product-Head war zum Snapshot `d299c2cefdf31ee2b497f564a837cbc6445e153f` und exact-head CI-grün. Der neueste beobachtete Plan-031-Staging-Lauf `34043334179` scheiterte jedoch am Step `Verify feature Product CI`, bevor Build/Deploy/Browser-Akzeptanz liefen.

Reverifiziere das zuerst. Wenn das Gate inzwischen durch einen neueren Run geschlossen ist, dokumentiere den echten erfolgreichen Run. Wenn nicht:

1. lies den exakten Workflow-Code und Logs;
2. unterscheide Race/Timing im CI-Gate von einem echten Product-Fehler;
3. implementiere den kleinsten sicheren Staging-/Gate-Fix, falls nötig;
4. ändere keine Product-Semantik, um einen Harness zu beschwichtigen;
5. starte/verwende einen exact-head isolierten Staging-Lauf;
6. akzeptiere erst dann den Head als Live-Basis.

Kein Product-Feature-Stacking auf einer nicht exakt live-verifizierten Basis.

## Phase 2 – Fresh UI Bug Campaign

Die eigentlichen aktuellen UI-Bugs kommen aus einem separaten frischen UI-Chat über `docs/prompts/2026-09-07-ui-fix-agent.md`. In dieser Master-Phase koordinierst du nur die Integration und Regression-Gates.

Für jeden gemeldeten UI-Bug:

- aktuelle Route/Modus/Viewport reproduzieren;
- Screenshot/Video/User-Evidence mit aktuellem Head korrelieren;
- Root Cause vor Fix identifizieren;
- minimalen Fix implementieren;
- Regressionstest ergänzen;
- angrenzende Access-/Session-/Campaign-Scoping-Invarianten prüfen;
- mobile 390x844 und Desktop prüfen;
- nach mehreren Bugs einen kombinierten Journey-Test laufen lassen, damit Fix A nicht Fix B zurückdreht.

Produktabsicht aus Plan 031 nicht durch kurzfristige Workarounds zurückbauen.

## Phase 3 – Organizer/Admin Security Closure

Starte parallel einen tiefen read-heavy Audit mit `docs/prompts/2026-09-07-admin-security-audit.md`.

Priorität der Findings:

1. Critical: unmittelbare Tenant-/Account-Übernahme, Auth Bypass, Secret Disclosure, Server-RCE-artige Wirkung oder vergleichbar.
2. High: IDOR/BOLA/BFLA, Cross-Tenant Mutation/Read, Recovery-/Invite-/Session-Takeover, Last-Organizer/Ownership Race, starke Injection-/XSS-Kette.
3. Medium: defense-in-depth, Rate Limit Bypass, Informationslecks, unvollständige Header/CSP, schwächere Validierung.
4. Low: Härtung/Observability/Minor Misconfiguration.

Schreibende Security-Fixes nur seriell auf kontrollierter Product-/Security-Branch-Linie. Nach jedem Critical/High:

- exploit/repro test zuerst;
- Fix;
- negative Regression;
- Cross-Tenant variant;
- same-tenant lower-role variant;
- session/recovery variant, falls relevant.

Kein Client-State darf eine Privilegentscheidung treffen. Der Server muss Session, Organization Membership, Campaign Relationship, Capability und ggf. frische Reauth selbst auflösen.

## Phase 4 – Street/House Engine Recovery statt Patch-Schleife

Nutze `docs/prompts/2026-09-07-street-house-engine-recovery.md` mit dem stärksten verfügbaren Reasoning-Modell.

Wichtig: Der isolierte PR #75 ist engineering-grün, aber die Nutzerakzeptanz größerer realer Gebiete ist nicht grün. Deshalb:

- keine weitere abstrakte Neuschreibung;
- zuerst reale Failures sammeln;
- Stage-by-stage Telemetrie/Diagnostics;
- den **ersten tatsächlich fehlschlagenden Stage** pro Area finden;
- Fehlerklassen clustern;
- Root Cause pro Klasse beheben;
- jede echte Failure-Geometrie als Regression Fixture sichern, soweit lizenz-/datenschutzkonform;
- Overpass, Normalisierung, Eligibility, JSTS, Clipping, Fragmentierung, House-Volumen, D1 Publish, Phase Status, Client Read/Render getrennt beweisen.

Danach den Street-/House-Vertrag sauber mit `mission-rxdb-sync` integrieren. Kein doppelter Reconcile-Pfad, keine zweite ID-Semantik.

## Phase 5 – Sync Security/Stability Closure

Nutze `docs/prompts/2026-09-07-sync-security-stability-audit.md`.

Teste mindestens:

- zwei Browser/Clients;
- offline -> lokale Änderungen -> reconnect;
- konkurrierende Mutationen;
- duplicate/reordered/lost invalidations;
- stale cursor;
- tombstone replay;
- Safety Resync;
- fresh client bootstrap;
- multi-collection atomicity;
- malformed/oversized pushes;
- manipulierte Campaign/Team IDs;
- manipulierte revisions/write tokens;
- long-offline resurrection prevention;
- DO disconnect/reconnect;
- Street/House publish + tombstone + replay.

D1 bleibt Autorität. Der Client darf niemals durch eigene IDs, lokale Rollen, lokale Revision oder lokalen „completed“-State Serverberechtigungen umgehen.

## Phase 6 – Combined Isolated Staging Acceptance

Erst nachdem UI, Security, Street/House und Sync einzeln stabil sind, baue einen kombinierten isolierten Acceptance-Lauf.

Erforderliche Journeys:

- Organizer Bootstrap/Login/MFA/Logout/Login.
- Campaign Create/Open/Rename/Adopt, soweit der aktuelle Plan das freigibt.
- mehrere Organizer/Admins und Role/Capability negative cases.
- Team Create/Edit.
- Room Create/Reveal/Rotate/Join/Discovery.
- Kommentare Campaign/Team Scoping.
- Settings und Launcher Navigation.
- Area Create/Preparation.
- Street automatic preparation auf mehreren Größenklassen.
- House preparation separat und House-failure-with-Street-ready.
- Smart Street A/B Slice auf persistierter Geometrie.
- manual Street status.
- House status.
- zwei Browser Sync.
- offline/reconnect.
- delete/tombstone/resync.
- Session revoke/recovery negative tests.
- Cross-tenant/cross-team negative API tests.

Browser-/CI-Akzeptanz nicht als „echtes iPhone/Android getestet“ bezeichnen. Wenn reale Geräte fehlen, als externes Gate markieren.

## Phase 7 – Release Readiness, nicht Production Release

Am Ende einen Release-Readiness-Bericht erzeugen mit:

- exact Product Head;
- exact Sync Head;
- exact Street/House integrated Head;
- PR states;
- CI Runs;
- Staging Worker/URL/Version;
- D1 staging integrity/FK;
- UI matrix;
- Security findings Critical/High/Medium/Low + Status;
- Sync chaos matrix;
- Street/House corpus results;
- real-device status;
- bekannte Restrisiken;
- Production D1 touched: MUST be `no`;
- Production deploy: MUST be `no`;
- rollback branch touched: MUST be `no`;
- PR #74/#75/#76 merged/Ready: MUST be `no`, solange keine separate Freigabe vorliegt.

## Harte Grenzen

- Kein Production Deploy.
- Keine Production D1 Migration oder Datenänderung.
- Keine Production Secrets Änderung.
- Keine Production Durable Object Änderung.
- Keine Production-Datenkopie in Staging.
- `mission-release-2026-09-02-manual` nicht verändern.
- PR #74/#75/#76 nicht mergen oder Ready setzen.
- Tests/Typecheck/Audit/AuthZ nicht abschwächen.
- Keine `any`-/`@ts-ignore`-/`unknown as`-Ausbreitung als Fixstrategie.
- Keine Client-Autorisierung.
- Keine Credentials/TOTP/Recovery/Session-Secrets in RxDB/IndexedDB/LocalStorage/Logs/Artifacts.
- Keine destruktive Street-Reprepare gegen bereits bearbeitete Auto-Tasks.

## Arbeitsstil

- Keine Zwischenfrage, wenn GitHub/Logs/Code die Antwort liefern können.
- Keine pauschalen Vermutungen; Evidenz vor Fix.
- Nach einem Fehler nicht nur berichten, sondern weiterarbeiten.
- Bei langen Tasks regelmäßige kurze Fortschrittsmeldungen, aber keine künstlichen Stopps.
- Wenn ein echter externer Blocker entsteht: exakte Aktion, exakter fehlender Scope und alle bereits abgeschlossenen Schritte dokumentieren.

## Abschlusskriterium

Höre erst auf, wenn alle **innerhalb der verfügbaren Berechtigungen lösbaren** Gates dieser Phase geschlossen sind und ein konkreter, überprüfbarer Abschlussbericht existiert. „Plan geschrieben“, „CI grün“ oder „kleines Testgebiet funktioniert“ allein sind kein Done.
