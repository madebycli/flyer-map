---
id: plan-028-rxdb-local-first-mission-sync
type: plan
status: active
last_updated: 2026-09-03
related: [architecture-data, architecture-offline-sync, architecture-security, architecture-stack, architecture-map, quality, ADR-0022, ADR-0023, ADR-0024, ADR-0025]
---

# Plan 028: RxDB Local-first Mission Sync

## Ziel

Die manuelle Mission erhält eine fehlertolerante lokale RxDB-Replik, damit ungefähr 50 bis 60 Geräte Street- und House-Status zuverlässig teilen können. D1 bleibt kanonisch, der Worker bleibt die einzige Autoritäts- und Sicherheitsgrenze. Der Rollback-Branch `mission-release-2026-09-02-manual` bleibt unverändert.

## Verifizierte Basis

- Rollback-Head: `5e7148d2a32f6237861e7e6a05e022eeb67c91ce`.
- Arbeitsbranch: `mission-rxdb-sync`.
- Verifizierter Anwendungscode-Baseline-Head: `aa0031cd88970bf7ca8b4256066663cde640f5ad`.
- Canonical Push-CI `33789550729`: success.
- Canonical PR-CI `33789557529`: success.
- Draft-PR #74 bleibt offen, Draft, ungemergt und basiert auf `mission-release-2026-09-02-manual`.
- Isolierter Staging-Testhead: `4fc12270ff948ba246dd0c804076720cc65f37b8`.
- Staging-Deploy `33789841058`: success.
- Reales Zwei-Browser-Chromium-Gate `33789841106`: success.
- Benutzer hat anschließend den sichtbaren Street-Sync auf realen Geräten manuell bestätigt.
- Kein Production-Deploy, keine Production-D1-Migration und kein Merge wurden ausgeführt.

## Architekturentscheidung

### A: RxDB Free Core mit Worker Pull/Push, gewählt

Browser: RxDB 17 mit Dexie/IndexedDB, fünf normalisierte Collections (`campaigns`, `teams`, `areas`, `streetTasks`, `houseTasks`).

```text
React/MapLibre <- materialisierter RxDB Read Model <- RxDB HTTP-Replikation
                                                   |
                                               Worker-Auth
                                                   |
                                            D1 + Change Feed
                                                   |
                                    best-effort DO/WebSocket Hint
```

D1 und HTTP Pull/Push bleiben kanonisch. Das Durable Object enthält keine kanonischen Dokumente und keine Secrets; es sendet nur monotone Invalidierungs-Hinweise. Ein Campaign-Checkpoint dient als Safety-Net für verlorene Hinweise.

### B: M5-Queue gezielt reparieren und erweitern, verworfen

Browser: bestehender Snapshot-Cache plus handgeschriebene IndexedDB-Queue; Worker: weitere Snapshot-Polls und individuelle Retry-/Leader-Logik.

Dieser Weg wurde verworfen, weil er Checkpoints, Pull-Isolation und Multi-Tab erneut als eigene Sync-Infrastruktur implementieren würde. Die Legacy-M5-Queue ist auf der RxDB-Linie nur noch Import-/Sicherungs-Kompatibilität, kein zweiter Shared-Data-Schreiber.

## Datenfluss und Sicherheitsgrenzen

```text
UI mutation
-> RxDB / typed domain mutation
-> authenticated Worker route
-> server-side authorization + domain validation
-> D1 canonical commit + monotonic rxdb_sync_changes entry
-> post-commit Campaign notify (hint only)
-> second client Pull
-> RxDB collection update
-> Campaign materialization
-> MapView props
-> MapLibre GeoJSON source setData
```

Der Browser darf keine Autorisierung, Rolle oder kanonische Wahrheit bestimmen. Konflikte und Tombstones bleiben entitätsspezifisch. Direkte Worker-Console-Logs sind durch den Security Guard verboten, außer im auditierten Logger.

## Umsetzungsschritte

1. **Umgesetzt:** Architektur-, Sicherheits- und Regressions-Tests für Pull-unabhängig-von-Push, Feld-/Statuskonkurrenz, Debounce, Offline-Reconnect und Auth.
2. **Umgesetzt:** RxDB-Schemas, lokale Datenbank und reaktive Materialisierung zum bestehenden `CampaignSnapshot`. MapLibre konsumiert den materialisierten Read Model-Wert.
3. **Umgesetzt:** additive Migration `0017_rxdb_sync_changes.sql`, monotoner paginierter Tombstone-fähiger Change Feed und same-transaction Feed-Writes.
4. **Umgesetzt:** authentifizierte RxDB-Pull-/Push-Routen über bestehende Domain- und Autorisierungslogik.
5. **Umgesetzt:** Legacy-M5-Daten als kontrollierter Einmalimport; kein zweiter Shared-Data-Schreiber.
6. **Umgesetzt:** Campaign-/Team-Drafts mit trailing commit/flush; Street-/House-Status unmittelbar.
7. **Umgesetzt:** hibernierende Campaign-Durable-Object-WebSocket-Invalidierung plus Campaign-Checkpoint als Safety-Net.
8. **Umgesetzt:** Worker-Lifecycle-Korrektur für serverseitig vorbereitete Street-Daten. `onCommitted` wird innerhalb des `waitUntil()`-getragenen Jobs `await`et, damit ein Realtime-Hinweis nicht nach durablem Commit durch vorzeitiges Worker-Ende verloren gehen kann. Regressionen: `tests/areaTaskPreparationRuntime.test.ts`, `tests/streetSyncLifecycleContract.test.ts`.
9. **Umgesetzt:** MapLibre-Live-Renderer-Korrektur. Zehn `isStyleLoaded()`-Early-Returns wurden aus React-Live-Effekten entfernt, da sie gültige RxDB/App-State-Updates dauerhaft verwerfen konnten. Initiale `style.load`-Hydrierung bleibt erhalten. Regression: `tests/mapRendererLiveSync.test.ts`.
10. **Umgesetzt auf Staging:** komplette isolierte Staging-Pipeline einschließlich Test, Typecheck, Audit, Build, Staging-D1-Ledger/Integrity, Wrangler Dry Run, Staging-Migration und Worker-Deploy.
11. **Umgesetzt:** reales Zwei-Browser-Chromium-Gate für sichtbare Streets ohne Seitenreload: create `1->2`, status bleibt `2`, delete `2->1`, jeweils Source und gerenderte MapLibre-Features synchron; 0 Main-Frame-Navigationen.
12. **Offen:** echte Android-Chromium- und iPhone-Safari-Off-/Reconnect-Smokes.
13. **Offen:** bewusste Production-Release-Entscheidung, reviewed Production-Migration 0017 und Production-Deploy nur nach expliziter Freigabe.

## Geschlossene P0-Incidents

### Realtime-Hinweis nach Area Preparation

Vor dem Fix waren D1 und Change Feed korrekt, ein offener Client konnte aber den DO/WebSocket-Wakeup verpassen. Ein Seitenreload holte die durable Wahrheit nach. Ursache war eine detached `onCommitted`-Promise außerhalb der effektiven Worker-Lebensdauer. Der Callback bleibt jetzt im `waitUntil()`-Promise.

### MapLibre zeigt alte Street-Linie trotz aktueller Daten

Realer Diagnosepunkt: gelöschte Straße war auf dem zweiten Gerät noch als Linie sichtbar, aber nicht mehr anklickbar. Deshalb war RxDB/App-State bereits korrekt; nur die Kartenquelle war stale.

Die Live-Effekte hatten `if (!map || !map.isStyleLoaded()) return;`. Ein temporäres `false` verwarf den betreffenden React-Update-Zyklus vollständig. Jetzt wird bei vorhandener Map-Instanz immer die entsprechende `sync*`-Funktion ausgeführt. Der Fix deckt nicht nur Streets, sondern alle gleich gebauten dynamischen Quellen/Filter ab.

## Akzeptanzkriterien

- [x] ein fehlender oder konfliktierter Team-Push blockiert keinen Street-Pull.
- [x] Konflikte bleiben auf die betroffene Entität/Feldgruppe begrenzt und konvergieren kanonisch.
- [x] normaler MapLibre-Renderer aktualisiert reaktiv ohne zweiten Renderer und ohne Seitenreload.
- [x] serverseitige Street-Commits können den Realtime-Hinweis nicht mehr durch einen detached Worker-Callback verlieren.
- [x] Team-/Campaign-Text und Farb-Bursts werden koalesziert.
- [x] RxDB-Push umgeht keine Worker-Autorisierung oder Domain-Prüfung.
- [x] keine zwei Shared-Data-Sync-Engines schreiben gleichzeitig.
- [x] DO-Realtime bleibt optionaler Hint; D1, Change Feed und HTTP Pull/Push bleiben kanonisch.
- [x] isolierte Staging-D1 enthält die benötigten Migrationen und wurde auf Integrität geprüft.
- [ ] Production-Migration 0017 bleibt bis zur expliziten Release-Freigabe **unapplied**.
- [x] reales Zwei-Browser-Chromium-Gate für sichtbaren Street-Create/Status/Delete ohne Reload.
- [ ] reales Android Chromium Offline-/Reconnect-Smoke.
- [ ] reales iPhone Safari Offline-/Reconnect-Smoke oder ausdrücklich akzeptiertes Restrisiko.

### 50–60-Geräte-Sanity-Modell

Die deterministische Suite modelliert 60 Clients über 8 Stunden, 5.000 geänderte Dokumente, Pull-Batches von 100, Push-Batches von 20 und einen 45-Sekunden-Campaign-Checkpoint. Das ist ein Traffic-/Fan-out-Modell aus implementierten Grenzen, keine Produktionslastmessung. Die DOs bleiben hibernierend; es gibt keinen kanonischen Snapshot im Signal.

## Staging vs. Production

Die Staging-Freigabe für Testzwecke ist abgeschlossen: Migrationen, D1-Integrität, Worker-Deploy und Browser-Gate sind grün. Diese Evidence darf nicht als Production-Freigabe umgedeutet werden.

Production bleibt unverändert, bis ausdrücklich entschieden wurde:

1. Production-Migration 0017 reviewen und über den freigegebenen Migrationspfad anwenden.
2. Production-Worker mit dem eingefrorenen Release-Head deployen.
3. Release-URL/Health prüfen.
4. PR #74 nur auf ausdrücklichen Auftrag aus Draft herausbewegen oder mergen.

## Risiken und offene Gates

- Mobile Browser/WebGL/Offline-Verhalten muss real auf Android und iPhone geprüft werden.
- Staging-only Deploy-/Recovery-/Browser-Gate-Dateien leben derzeit auf `mission-rxdb-staging`. `UNKLAR`: Ob die Staging-Branch nach Abschluss wieder exakt auf den kanonischen Source-Head zurückgesetzt werden soll, muss vor einer Änderung entschieden werden.
- Automatische Area Preparation nach normalen Area-Mutationen ist auf der Mission-Linie absichtlich deaktiviert. Nicht als Regression behandeln.
- Der bereits grüne Staging-Zwei-Browser-Test ersetzt nicht die echten Mobile-Smokes.
