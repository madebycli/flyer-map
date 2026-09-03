---
id: status-current
type: status
status: active
last_updated: 2026-09-03
---

# Current Project State

## Mission Release Override

Die reale Distribution-Mission hat Vorrang vor langfristiger Plattformarbeit. Mission-kritisch ist der Flow:

```text
Admin -> Teams/Gebiet -> manuelle Streets/Houses
-> Street-/House-Status -> RxDB Pull/Push + D1 Change Feed
-> reaktiver Campaign-Read-Stand -> MapLibre
-> gemeinsamer sichtbarer Stand auf weiteren Geräten
```

Der Rollback-Branch `mission-release-2026-09-02-manual` bleibt unverändert. Der RxDB-Kandidat liegt auf `mission-rxdb-sync`; Draft-PR #74 gegen die Rollback-Basis bleibt offen, Draft und ungemergt. Kein Production-Deploy und keine Production-D1-Migration ohne expliziten Auftrag.

## RxDB Mission Sync: verifizierter Stand

- Rollback-Basis: `mission-release-2026-09-02-manual` auf `5e7148d2a32f6237861e7e6a05e022eeb67c91ce`.
- Verifizierter Anwendungscode-Baseline-Head: `aa0031cd88970bf7ca8b4256066663cde640f5ad`.
- Canonical CI Push-Run `33789550729`: success.
- Canonical PR-CI-Run `33789557529`: success.
- Tests, Typecheck, Dependency Audit und Production Build sind auf diesem Code-Baseline-Head grün.
- Isoliertes Staging: `mission-rxdb-staging`, getesteter Head `4fc12270ff948ba246dd0c804076720cc65f37b8`.
- Staging-Deploy-Run `33789841058`: success; isolierte Staging-D1-Prüfung/Migration, Wrangler Dry Run, Worker-Deploy und URL-Check grün.
- Reales Chromium-Zwei-Browser-Gate `33789841106`: success.
- Der Benutzer hat anschließend den zuvor fehlerhaften sichtbaren Street-Flow auf realen Geräten manuell bestätigt: „geht wieder“.

RxDB 17/Dexie hält fünf normalisierte Collections (`campaigns`, `teams`, `areas`, `streetTasks`, `houseTasks`). D1 bleibt kanonisch; der Worker bleibt die einzige Autoritäts- und Sicherheitsgrenze. Pull/Push läuft über authentifizierte Worker-Routen und den monotonen D1 Change Feed. Campaign-Durable-Object/WebSocket-Nachrichten sind nur Invalidierungs-Hinweise; kanonische Daten werden danach per HTTP/RxDB gezogen. Ein Campaign-Checkpoint fängt verlorene Signale auf.

## Geschlossene P0-Sync-/Renderer-Fehler

### 1. Prepared-Street-Realtime-Lifecycle

`worker/areaTaskPreparation.ts` hatte den Realtime-Callback nach erfolgreichem D1-/Change-Feed-Commit als losgelöste Promise gestartet. Dadurch konnte der `waitUntil()`-Job enden, bevor `notifyCampaignSync()` zum Durable Object/WebSocket abgeschlossen war. D1 und Change Feed waren dann korrekt, aber ein bereits geöffneter Client konnte den Wakeup verpassen.

Fix: `options.onCommitted?.()` wird innerhalb des `waitUntil()`-getragenen Preparation-Promises `await`et. Ein Realtime-Fehler nach durablem D1-Commit bleibt best effort und rollt den Commit nicht zurück. Regressionen liegen in `tests/areaTaskPreparationRuntime.test.ts` und `tests/streetSyncLifecycleContract.test.ts`.

Client-Diagnostik für diesen Pfad:

```text
[rxdb-sync] realtime-change
[rxdb-sync] pull-complete
[rxdb-sync] manual-refresh-start
[rxdb-sync] manual-refresh-complete
```

Direktes `console.*` im Worker bleibt durch `tests/securityStaticGuards.test.ts` verboten, außer im auditierten Worker-Logger.

### 2. MapLibre „Daten aktuell, Linie alt“

Der entscheidende reale Befund war: Eine serverseitig/RxDB-seitig bereits gelöschte Straße blieb auf dem zweiten Gerät als Linie sichtbar, war dort aber nicht mehr anklickbar. Damit waren Server, RxDB und App-State aktuell; nur die MapLibre-Grafik war stale.

Ursache: Zehn React-Live-Effekte in `src/map/MapView.tsx` verwendeten `if (!map || !map.isStyleLoaded()) return;`. Während MapLibre Source-/Style-Arbeit konnte `isStyleLoaded()` kurzfristig `false` liefern. Der betreffende React-Prop-Stand wurde dann vollständig verworfen und bis zum Seitenreload nicht nachgeholt.

Fix: Die Live-Effekte prüfen nur noch, ob die Map-Instanz existiert, und rufen die jeweiligen `sync*`-Funktionen direkt auf. Die `style.load`-Hydrierung aus den neuesten Refs bleibt erhalten. Der Fix gilt konsistent für Areas, Streets, Houses, Smart-House-/Collection-Daten und Filter. Regression: `tests/mapRendererLiveSync.test.ts`.

Das reale Chromium-Gate prüft seitdem nicht nur Netzwerk/Pull, sondern die sichtbare MapLibre-Quelle in Browser B ohne Navigation/Reload:

```text
initial:   source=1 rendered=1
created:   source=2 rendered=2
completed: source=2 rendered=2
deleted:   source=1 rendered=1
reloads:   0
```

Damit ist der konkrete Street-Create/Status/Delete-Renderer-Fehler automatisiert und manuell geschlossen.

## D1-/Deployment-Grenze

Migration `0017_rxdb_sync_changes.sql` ist in der **isolierten Staging-D1** angewendet/verifiziert. Das ist keine Production-Freigabe. Für **Production** bleibt 0017 unangetastet, bis ein explizit freigegebener Release-/Migrationsschritt erfolgt.

Die bereits früher kontrolliert verifizierte Production-D1-Basis bis Migration 0014 bleibt davon unberührt. Keine in diesem RxDB-Fixlauf ausgeführte Aktion hat Production deployed oder Production D1 verändert.

## Mission-Policy für Areas

Automatische Area-Vorbereitung nach normaler `area.create`-/`area.update-geometry`-Mutation ist auf dieser Mission-Linie absichtlich deaktiviert. Das darf nicht als Bug „repariert“ werden. Explizite Area-Preparation bleibt ein eigener Pfad. Manuelle Streets/Houses und deren Status sind der Mission-Flow.

## Sicherheitsvertrag

- Browser ist nicht vertrauenswürdig; Worker/D1 sind autoritativ.
- Access, Rollen, Revocation und Domain-Validierung bleiben serverseitig.
- Sessions sind opaque und `Secure; HttpOnly; SameSite=Lax`; D1 speichert Session-Hashes.
- Konflikte, Auth-Fehler und terminale Sync-Probleme dürfen nicht still überschrieben werden.
- Kein Service Worker, keine Background Sync API, keine kontinuierliche GPS-Historie.

## Noch offene reale Release-Gates

1. Android Chromium Offline-/Reconnect-Smoke mit dem aktuellen RxDB-Head.
2. iPhone Safari Offline-/Reconnect-Smoke; falls kein iPhone verfügbar ist, Restrisiko ausdrücklich dokumentieren.
3. Danach eine bewusste Release-Entscheidung für Production einschließlich reviewed Production-Migration 0017 und Production-Deploy.
4. Erst nach expliziter Freigabe PR #74 aus Draft/Release-Pfad weiterbewegen. Nicht automatisch mergen oder Ready-for-Review markieren.

Die Staging-Zwei-Browser-/Renderer-Gates sind grün und ersetzen die echten Mobile-Smokes nicht.

## Nächster Produktkontext, noch nicht beauftragt

Ein neuer/sauberer URL-Aufruf soll später optional in ein Projekt-Onboarding mit Projektname sowie erstem Admin-Benutzernamen/Passwort führen. Dieser Punkt war wegen des Street-P0 blockiert und ist **noch keine Implementierungsfreigabe**. Sicherheitsanforderung: Passwort niemals in LocalStorage, IndexedDB, RxDB, URL oder App-State; nur serverseitige Verifier und HttpOnly-Session. Für die Architektur existieren mehrere mögliche Wege und der Benutzer hat noch keinen gewählt. Vor Umsetzung mindestens zwei Varianten vorlegen und wählen lassen.
