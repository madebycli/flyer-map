# Street Browser Smoke

## Basis

- Ausgangs-PR: #84
- Ausgangs-Head: `c2bf0bf0ef12704ce52612181dbb574837d77749`
- Staging: `https://flyer-map-staging.cloudflare-eleven035.workers.dev`
- Staging-Run: `34217845397`, PASS
- CI-Run: `34217850254`, PASS
- Staging-Evidence-Artifact: `10052556260`

## Ergebnis

| Prüfung | Status | Evidenz |
| --- | --- | --- |
| Isolierter Staging-Deploy auf exaktem Head | PASS | Run 34217845397 und Artifact 10052556260 bestätigen Head und URL |
| Production unangetastet | PASS | Artifact: `productionUntouched: true` |
| Secrets rotiert | PASS | Artifact: `secretsRotated: false` |
| `/login` auf Staging erreichbar | PASS | Erfolgreicher Workflow-Schritt lädt `${TEST_URL}/login` mit `curl --fail` nach dem Deploy |
| App-Start im echten Browser | BLOCKED | In dieser Audit-Umgebung steht kein interaktiver Browser zur Verfügung |
| Login-Ansicht visuell | BLOCKED | Kein interaktiver Browser |
| MapLibre-Initialisierung und Console | BLOCKED | Kein Browser-Console-Zugriff |
| Street-/Area-Oberfläche visuell | BLOCKED | Ohne bestehende sichere Zugangsdaten nicht erreichbar geprüft |
| Desktop-Viewport | BLOCKED | Kein interaktiver Browser |
| Mobile 390x844 | BLOCKED | Kein interaktiver Browser |
| JavaScript-Fehler | BLOCKED | Kein Browser-Console-Zugriff |

## Direkter URL-Versuch

Ein zusätzlicher HTTP-Abruf der öffentlichen URL über die verfügbare Web-Fetch-Umgebung konnte die Worker-URL nicht laden. Das ist keine belastbare Aussage über Staging, weil der erfolgreiche isolierte GitHub-Actions-Run unmittelbar zuvor dieselbe URL deployt und `/login` erfolgreich mit `curl --fail` abgerufen hat.

## Screenshots

- BLOCKED: In dieser Umgebung konnte kein echter Browser gestartet werden, daher wurden keine künstlichen oder gefälschten Screenshots erzeugt.
- Staging-Evidenz: https://github.com/madebycli/flyer-map/actions/runs/34217845397
- CI-Evidenz: https://github.com/madebycli/flyer-map/actions/runs/34217850254

## Fehler

Keine reproduzierbare Runtime-Regression aus den verfügbaren nicht-interaktiven Prüfungen. Die visuellen und Console-basierten Browserchecks bleiben ausdrücklich BLOCKED.

## Sicherheitsgrenzen

Kein Merge, kein Production-Deploy, kein Production-D1-Write, kein Secret-Wechsel und keine schreibende Staging-Produktaktion wurden durch diesen Audit ausgeführt.
