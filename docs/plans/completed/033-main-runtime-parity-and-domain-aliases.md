---
id: plan-033-main-runtime-parity-and-domain-aliases
type: plan
status: completed
last_updated: 2026-09-08
related: [architecture, security, data, offline-sync, deployment, ADR-0026]
---

# Plan 033: Main Runtime Parity und Domain-Aliase

## Ziel

Die auf `main` ausgelieferte Organizer-Oberfläche und ihre same-origin API laufen über einen gemeinsamen vollständigen Worker. Genehmigte Domains, die auf diesen Worker und dieselben Bindings zeigen, verwenden dieselben Organization-, Campaign-, Karten- und Sync-Daten. Browser-Sitzungen bleiben je Origin getrennt.

## Anforderungen

- `GET /login` liefert die Organizer-Oberfläche.
- Organization Login, Security und Admin API werden vom Main Worker erkannt.
- `/api/organization/me` liefert ohne Sitzung 401, niemals den generischen API-404.
- Core Campaign, Collection, RxDB, Field Groups, Aktivität und Statistik bleiben im selben Worker enthalten.
- Campaign- und Entitäts-IDs bleiben vom Hostnamen unabhängig.
- Zwei Origins mit getrennten Sitzungen lesen und ändern dieselbe kanonische Campaign in derselben D1.
- Schreibzugriffe bleiben same-origin geschützt, Cookies bleiben `Secure`, `HttpOnly`, `__Host-` und `SameSite=Lax`.
- Keine Production-Aktivierung, Migration oder Secret-Rotation in diesem Plan.

## Architektur

### Gewählt: bestehender vollständiger Organizer-Wrapper als Main Entry

`indexOrganizer.ts` umschließt bereits den aktuellen Field-/RxDB-/Collection-Worker und ergänzt die Organization-Komposition. `wrangler.jsonc` macht diesen vorhandenen Wrapper zum kanonischen Main Entry. Ein kleiner `/api/runtime`-Vertrag meldet nur Version, Umgebung und nicht-sensitive Capability-Flags.

Datenfluss: Domain A oder B -> derselbe Worker-Code -> origin-eigene Session -> serverseitige Organization-/Campaign-Autorisierung -> dieselbe D1, derselbe Change Feed und dieselbe Durable-Object-Koordination.

Vorteile: kleinster Diff, keine zweite Routing-Engine, keine CORS-Brücke, keine Datenkopie, vorhandene Security-Härtung bleibt zentral. Nachteile: Production benötigt vor Aktivierung mehrere bereits vorbereitete Bindings, Secrets und Migrationen. Komplexität: mittel.

### Verworfen: neuer Domain-Gateway plus getrennte API-Worker

Ein Gateway könnte Domains auf UI- und API-Worker verteilen. Das erhöht Bindings, CORS-/Cookie-Risiken, Deploy-Reihenfolge und Kosten, ohne für Domain-Aliase einen Nutzen zu bringen. Komplexität: hoch.

## Dateistruktur

- `worker/indexOrganizer.ts`: kanonische Runtime-Komposition und nicht-sensitiver Runtime-Vertrag.
- `wrangler.jsonc`: vollständige Main-Bindings und Entry Point als Aktivierungskonfiguration.
- `tests/mainRuntimeParity.test.ts`: Routen-, Zwei-Origin-, Shared-State- und Host-Unabhängigkeitsvertrag.
- `docs/decisions/ADR-0028-main-runtime-and-domain-aliases.md`: dauerhafte Architekturentscheidung.
- `docs/status/MAIN_RUNTIME_PARITY_HANDOFF.md`: Evidenz und Production-Checkliste.

## Umsetzungsschritte

1. Main-Remote, offene PRs und aktuelle Runtime-Komposition verifizieren.
2. Vollständigen Worker als Main Entry konfigurieren und `/api/runtime` ergänzen.
3. Organization Route Matrix und unknown-API Fail-Closed testen.
4. Zwei getrennte Origin-Sitzungen gegen eine gemeinsame D1 testen, einschließlich Mutation in beide Richtungen und RxDB-Checkpoint.
5. Konfiguration auf notwendige Bindings, Secrets, Migrationen und `nodejs_compat` prüfen.
6. Tests, Typecheck, Dependency Audit und Production Build ausführen.
7. Dokumentation, Kontextgraph und Handoff aktualisieren.
8. Separaten Draft-PR gegen `main` erstellen und exact-head CI prüfen.

## Abschluss

Draft-PR #80 wurde direkt gegen `main` erstellt. Der Runtime-Head `1c9e567abb2b37d585af5fc98d649485fbe35410` bestand in CI Run `34214219630` Tests, nativen TypeScript-7-Typecheck, Dependency Audit und Production Build. Production blieb unverändert.

## Risiken

- Aktivierung vor Migration 0018 bis 0020 führt zu absichtlich fail-closed 503-Antworten.
- Fehlende KDF-, TOTP- oder Field-Group-Secrets blockieren die zugehörigen Funktionen.
- Custom Domains müssen außerhalb des Codes auf exakt denselben Worker zeigen. Unterschiedliche Worker- oder D1-Bindings würden den Shared-Data-Vertrag brechen.

## Offene Fragen / Unklarheiten

- UNKLAR: Welche Custom Domains Cloudflare bereits auf den Main Worker routet. Das ist externe Infrastruktur und wird in der Aktivierungscheckliste geprüft.
- UNKLAR: Ob die Production-D1 Migrationen 0017 bis 0020 bereits enthält. Die Dokumentation behandelt sie bis zum externen Nachweis als nicht angewendet.

## Nicht-Ziele

- kein Cross-Domain SSO;
- kein permissives CORS;
- keine Datenbank pro Domain;
- keine Änderung historischer Feature- oder Staging-Branches;
- kein Production-Deploy, Merge oder Production-D1-Write.
