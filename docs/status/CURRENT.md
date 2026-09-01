---
id: status-current
type: status
status: active
last_updated: 2026-09-01
---

# Current Project State

## Mission Release Override

Die reale Distribution-Mission startet am 2026-09-02. Bis nach der Mission gilt auf `plan-feature-complete-platform` ein Distribution-P0-Fokus. Collection/Pickup, FC5.3 und langfristige Plattformarbeit dürfen den Release-Pfad nicht verlängern.

Mission-kritischer Produktfluss:

```text
Admin -> Teams/Gebiet -> serverseitige Area Preparation -> Streets/Houses
-> Street-/House-Status -> M5 Queue/Sync -> gemeinsamer Stand auf weiteren Geräten
```

Der normale Launcher ist für die Mission auf `Team`, `Fortschritt`, `Einstellungen` und bei berechtigtem Zugriff `Gebiet` reduziert. Bestehende Einsätze-, Activity-, Automation-, Comment- und Collection-Runtimes werden nicht gelöscht und keine Datenhistorie wird verändert. Sicherheits-, Sync-, Konflikt-, Access- und Area-Preparation-Fehler bleiben sichtbar.

PR #72 bleibt Draft gegen `ui-app-launcher-sheet`. Kein Merge, kein Ready-for-Review und kein manueller Deploy ohne expliziten Auftrag.

## Baseline

Verteil-Flyer bleibt eine mobile-first normale Website mit React, TypeScript, Vite, MapLibre GL JS 5.7.1, OpenFreeMap Bright, Cloudflare Workers und D1. M4 Access/Session und die resiliente M5 Mutation Queue bleiben die gemeinsame Grundlage. Keine native App, keine installierbare PWA, kein Service Worker, keine Background Sync API und keine kontinuierliche GPS-Historie.

## Verifizierter Remote-D1-Stand

Der vorherige Claim `remote nur 0001-0003` ist überholt.

Am 2026-09-01 wurde der kontrollierte D1-Rollout über GitHub Actions Run `33540449723` erfolgreich abgeschlossen. Verifiziert wurden:

- Migration Registry 0001 bis 0014 vollständig angewendet;
- Time-Travel-Recovery-Point und SQL-Export vor dem Rollout;
- Foreign-Key-Check vor und nach dem Rollout sauber;
- bestehende Baseline Counts unverändert erhalten;
- kritisches Schema von 0013 und 0014 vorhanden;
- versionierte Preview und Branch-Alias lieferten passende Assets und erfolgreiche Health-Checks.

Die beim Rollout erhaltenen Baseline Counts waren:

```text
campaigns: 53
teams: 32
areas: 39
tasks: 77
access_grants: 62
sessions: 66
mutations: 188
```

Damit ist Migration 0014 für die serverseitige automatische Area-Vorbereitung remote vorhanden. Historische Plan-/ADR-Texte, die den damaligen Zustand `prepared only` beschreiben, bleiben historische Evidence und sind nicht als aktueller Deployment-State zu lesen.

## M4 Admin-Handoff

Der bestehende Campaign-Access-Flow bleibt der Mission-Admin-Weg. Ein bestehender Admin kann in `Einstellungen -> Zugriff` einen neuen Grant mit Rolle `admin` erzeugen und den einmalig angezeigten Zugangslink weitergeben.

Sicherheitsvertrag:

- Invite Token ist kryptographisch zufällig;
- D1 speichert nur den SHA-256-Hash des Invite Tokens;
- Redemption erzeugt eine separate opaque Session in `Secure; HttpOnly; SameSite=Lax`;
- D1 speichert nur den Session-Hash;
- jeder geschützte Request löst Grant und Revocation erneut serverseitig auf;
- Grant-Revocation invalidiert bestehende Sessions auf dem nächsten geschützten Request;
- normaler Admin-Handoff benötigt kein GitHub, Cloudflare, Wrangler, Deployment Secret oder D1-Zugriff.

Username/Password/TOTP und Organization-Migration bleiben nach der Mission.

## M5 finaler Schreibvertrag

Der Campaign-Snapshot bleibt Read Model, UI-Modell, Startup-Cache und Konflikt-/Sicherheitskopie.

- `POST /api/campaigns` ist ausschließlich Initial-Create mit Revision 0;
- `GET snapshot` und `GET version` bleiben Read-Pfade;
- `PUT /api/campaigns/:id/snapshot` antwortet HTTP 410 `legacy_snapshot_write_retired` und schreibt nicht nach D1;
- normale Campaign-, Team-, Area-, Street-, House-, Collection- und Pickup-Änderungen laufen über explizite M5- oder spezialisierte Mutationen;
- unbestätigte M5-Änderungen liegen dauerhaft in IndexedDB;
- kurze Netzfehler werden mit begrenztem Backoff wiederholt;
- gleiche Mutation-ID plus gleicher Fingerprint ist idempotent;
- Conflict, 401/403 und invalide Mutationen bleiben sichtbar und werden nicht heimlich überschrieben;
- bei leerer Queue wird ein abweichender lokaler Snapshot als Konfliktkopie bewahrt, statt ihn automatisch zum Server hochzuladen.

## Automatische Distribution-Area-Vorbereitung

ADR-0021 ist der normale Mission-Pfad:

- erfolgreicher, nicht wiederholter `area.create` oder `area.update-geometry` Write kann Worker-seitig Vorbereitung planen;
- canonical Area-Geometrie und BBox werden serverseitig ermittelt;
- bounded OSM-Daten werden serverseitig geladen und normalisiert;
- Straßenfragmente werden als normale persistente Street Tasks gespeichert;
- Gebäude werden als normale persistente House Tasks gespeichert;
- automatische Tasks besitzen app-eigene IDs und eine serverseitige Preparation-Generation;
- manuelle Streets bleiben mit `areaPreparationGeneration = null` erhalten;
- Publish von Tasks, Ready-State und Campaign-Revision erfolgt guarded/atomar;
- gleiche Ready-Geometrie ist No-op, frisches Pending dedupliziert und veraltete Generationen dürfen nicht publishen;
- Fehler veröffentlichen keine partiellen Tasks;
- autorisierter Retry ist möglich;
- automatische Tasks dürfen normal ihren Status ändern, aber nicht über normale Client-Mutationen gelöscht werden;
- nach begonnenem automatischem Work wird eine Geometrieänderung kontrolliert mit `area_has_started_work` blockiert.

Der normale Area Sheet startet `missing` genau einmal, pollt `pending` nur solange das Sheet offen ist, refresht bei `ready` einmal den normalen Campaign-Snapshot und bietet bei `failed` einen autorisierten Retry. Nach lokaler Area-Erstellung oder Geometrieänderung toleriert der Poller den kurzen M5-Persistenz-Race mit höchstens fünf weiteren `404 area_not_found`-Reads im Zwei-Sekunden-Takt; andere Fehler bleiben explizit retrybar. `Straße manuell hinzufügen` bleibt Fallback. Die alten Smart-Street-/Smart-House-Auswahlbuttons sind kein normaler Produkteinstieg mehr.

## Map und Task-Darstellung

- gespeicherte Areas, Streets und Houses laufen über feste MapLibre GeoJSON Sources/Layers;
- House Tasks werden ab dem definierten House-Zoom sichtbar und per rendered-feature hit test ausgewählt;
- Street-Auswahl hat Priorität vor House, danach Area;
- Statuswerte sind `open`, `completed`, `later`, `not-deliverable`;
- erledigte Streets und House-Outlines verwenden eine reine um 25 Prozent abgedunkelte Teamfarbe;
- GPS nutzt MapLibre Geolocate mit live/refining Fixes und Follow-Verhalten, ohne persistierte GPS-Historie;
- persönliche Kamera bleibt lokal und wird durch Remote-Sync nicht zurückgesetzt.

## Automatisierte Qualitäts-Evidence

Der Runtime-Head vor dem Mission-Trim war:

```text
129bc30cc408cfb2fd840390faaa6e37c5164148
CI #823 / run 33523056178: success
```

Diese Suite enthält Regressionen für Access/Revocation, Authorization, M5 Queue/Idempotency, Legacy-Snapshot-410, Area Preparation, automatische Task-Persistenz, House-Renderer, Statusfarben, mobile Sheets, Security Guards und Production Build.

Jeder neue Mission-Commit muss wieder auf seinem exakten Head durch CI verifiziert werden. Ein vorher grüner Head reicht nicht als Release-Evidence für einen späteren Head.

## Offene reale Mission-Gates

Automatisierte Tests ersetzen folgende Abnahmen nicht:

1. echter Admin-A -> Admin-B-Handoff in einem frischen Browser/Gerät einschließlich weiterer Admin-Link-Erzeugung und Revocation;
2. echter Area-End-to-End-Flow auf der Release-Preview: Team -> Gebiet -> pending -> ready -> persistente Streets/Houses;
3. zweites autorisiertes Gerät sieht Statusänderungen;
4. kurzer Netzverlust während Street-/House-Statusänderung und erfolgreiche Wiederkehr;
5. reales Android Chromium Smoke;
6. reales iPhone Safari Smoke, falls kein iPhone verfügbar ist, muss das ausdrücklich als akzeptiertes Restrisiko dokumentiert werden;
7. finalen Mission-Head und dessen stabile Release-URL einfrieren und danach Feature Freeze.

Cloud-/CI-Tests oder ein Browser ohne echte Mobile/WebGL-Eigenschaften dürfen nicht als Ersatz für diese Gates behauptet werden.

## Für die Mission ausdrücklich verschoben

- FC5.3 Collection Road Sections;
- Collection/Pickup Stats;
- Collection Actor Attribution/Highlight/Revert;
- vollständige Organizations-Migration;
- Username/Password/TOTP;
- generische Capability-/Permission-Matrix;
- Action Templates und langfristige Analytics;
- vollständiger Desktop-Admin-Neubau;
- neue Support-/Appearance-Features;
- sonstige Roadmap-Features ohne direkten Distribution-P0-Nutzen.

## Nächster Schritt

1. Mission-Trim auf exaktem neuen Head durch CI verifizieren.
2. Versioned Preview und Branch-Alias für diesen Head verifizieren.
3. echten Distribution E2E und Admin-Handoff durchführen.
4. Android/iPhone Mission Smoke durchführen.
5. danach Mission-Head und Release-URL einfrieren, Feature Freeze.
6. Erst nach der Mission zu Plan 017/FC5.3 und langfristiger Plattformarbeit zurückkehren.
