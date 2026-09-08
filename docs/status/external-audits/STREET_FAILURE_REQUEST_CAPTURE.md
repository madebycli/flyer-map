# STREET FAILURE REQUEST CAPTURE

## Source

- Repository: `madebycli/flyer-map`
- Branch: `integration/main-street-runtime`
- Source-SHA: `63d9cfce5b87749912a87b3d8436c1e977809ab4`
- Draft-PR: `#84`
- Datum: `2026-09-08`
- Status: `BLOCKED`

## Ergebnis

Der authentifizierte fehlschlagende Preparation-Request konnte in diesem Chat nicht aufgezeichnet werden.

Fehlende Voraussetzung: Es steht hier keine autorisiert nutzbare, bereits angemeldete Sitzung auf der persistenten Admin-Staging-Domain zur Verfügung. Eine bestehende Browser-Sitzung von Master wird nicht in diesen Chat übernommen. Entsprechend wurden weder Ersatzkonto noch synthetische Session noch Auth-Bypass verwendet.

Es wurde kein Button-Klick ausgeführt und kein authentifizierter Request ausgelöst.

## HTTP-/Network-Befund

Zielrequest:

`POST /api/campaigns/:campaignId/areas/:areaId/preparation`

Beobachtete Felder:

- UTC-Zeit: `UNBEKANNT`
- HTTP-Status: `UNBEKANNT`
- Browser-Netzwerkfehler: `UNBEKANNT`
- Content-Type: `UNBEKANNT`
- Sicherer Fehlercode: `UNBEKANNT`
- Sichere Fehlermeldung: `UNBEKANNT`
- CF-Ray: `UNBEKANNT`
- Dauer: `UNBEKANNT`
- Idempotency-Header vorhanden/fehlend: `UNBEKANNT`

## Folgeantworten

Keine authentifizierte POST-Antwort beobachtet, daher wurden keine Folge-GETs ausgewertet.

- Preparation `status`: `UNBEKANNT`
- `errorCode`: `UNBEKANNT`
- `roadCount`: `UNBEKANNT`
- `houseCount`: `UNBEKANNT`

## Lokale Network-Aufzeichnung für Master

1. Die persistente Admin-Staging-Seite im bereits angemeldeten Browser öffnen.
2. DevTools öffnen und im Tab `Network` die Aufzeichnung aktiv lassen.
3. Das bereits betroffene Testgebiet öffnen, ohne Geometrie oder Campaign zu ändern.
4. Genau einmal auf „Straßen und Häuser vorbereiten“ klicken.
5. Den Request `POST /api/campaigns/:campaignId/areas/:areaId/preparation` auswählen.
6. Nur folgende Werte notieren:
   - UTC-Zeit
   - HTTP-Status oder Browser-Netzwerkfehler
   - Content-Type
   - sicheren Fehlercode und sichere Fehlermeldung
   - CF-Ray
   - Dauer
   - nur ob ein Idempotency-Header vorhanden oder fehlend ist, niemals dessen Wert
7. Falls der POST erfolgreich ist, nur bereits entstehende Folge-GETs beobachten und deren Status sowie die sicheren Felder `status`, `errorCode`, `roadCount`, `houseCount` notieren.
8. Keine Cookies, Authorization-Header, Passwörter, TOTP, Accountdaten, Geometrien oder vollständige HAR-Dateien teilen.

## Annahmen

- Keine.
- Insbesondere wurde keine Fehlerursache abgeleitet.

## Blocker

- Keine autorisiert nutzbare, bereits angemeldete Browser-Sitzung in diesem Chat.
- Keine Einsicht in Masters lokale DevTools-/Network-Aufzeichnung.

## Änderungen

- `docs/status/external-audits/STREET_FAILURE_REQUEST_CAPTURE.md`

## Tests

Keine, reine Aufzeichnung.

## Output

Sanitisierter Statusbericht: `BLOCKED`, da die erforderliche authentifizierte Network-Beobachtung nicht möglich war.
