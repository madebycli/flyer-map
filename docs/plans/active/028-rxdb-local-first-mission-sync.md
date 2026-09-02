---
id: plan-028-rxdb-local-first-mission-sync
type: plan
status: active
last_updated: 2026-09-02
related: [architecture-data, architecture-offline-sync, architecture-security, architecture-stack, architecture-map, quality, ADR-0022, ADR-0023, ADR-0024, ADR-0025]
---

# Plan 028: RxDB Local-first Mission Sync

## Ziel

Die manuelle Mission erhält eine fehlertolerante, lokale RxDB-Replik, damit ungefähr
50 bis 60 Geräte Street- und House-Status zuverlässig teilen können. D1 bleibt
kanonisch, der Worker bleibt die einzige Autoritäts- und Sicherheitsgrenze. Der
Rollback-Branch `mission-release-2026-09-02-manual` bleibt unverändert.

## Verifizierte Basis

- Rollback-Head: `5e7148d2a32f6237861e7e6a05e022eeb67c91ce`;
- exakter CI-Run: `33597980789`, erfolgreich;
- Arbeitsbranch: `mission-rxdb-sync`;
- bestehende M5-Queue wird nach der kontrollierten Einmalmigration kein zweiter
  Shared-Data-Schreiber mehr sein;
- keine Remote-Migration, kein manueller Deploy, kein Merge und kein automatisches
  Ready-for-Review.

## Architekturentscheidung

### A: RxDB Free Core mit Worker Pull/Push, gewählt

Browser: RxDB 17 mit Dexie/IndexedDB, fünf normalisierte Collections
(`campaigns`, `teams`, `areas`, `streetTasks`, `houseTasks`).

```text
React/MapLibre <- RxDB-Queries <- RxDB HTTP-Replikation
                                     |
                                 Worker-Auth
                                     |
                              D1 + Change Feed
```

Vorteile: reaktive Daten, persistente lokale Replica, Checkpoints, getrennte
Push-/Pull-Fehler und RxDB-Multi-Tab-Unterstützung. Nachteile: additive
Change-Feed-Migration und klar begrenzte Kompatibilitätsschicht. Komplexität: hoch,
aber für die Last und Offline-Anforderung angemessen.

### B: M5-Queue gezielt reparieren und erweitern, verworfen

Browser: bestehender Snapshot-Cache plus handgeschriebene IndexedDB-Queue;
Worker: weitere Snapshot-Polls und individuelle Retry-/Leader-Logik.

Vorteile: weniger neue Abhängigkeiten. Nachteile: reproduziert den globalen
Queue-Blocker, macht Checkpoints, Pull-Isolation und Multi-Tab zu weiterer eigener
Sync-Infrastruktur. Komplexität: hoch bei niedrigerer Zuverlässigkeit.

RxDB wird gewählt, weil Master diesen Weg ausdrücklich vorgibt und die Prüfung
bestätigt, dass Kern, HTTP-Replikation und Dexie-Storage ohne verpflichtendes SaaS
unter Apache-2.0 nutzbar sind.

## Umsetzungsschritte

1. Architektur-, Sicherheits- und Regressions-Tests für Pull-unabhängig-von-Push,
   Feld- und Statuskonkurrenz, Schreib-Debounce, Offline-Reconnect und Auth ergänzen.
2. RxDB-Schemas, lokale Datenbank und reaktive Materialisierung zum bestehenden
   `CampaignSnapshot` implementieren. MapLibre erhält nur den materialisierten Read
   Model-Wert.
3. Additive Migration `0017_rxdb_sync_changes.sql` erstellen. Der Worker schreibt
   denselben kanonischen D1-Vorgang und einen monotonen, paginierten Tombstone-fähigen
   Change-Feed-Eintrag.
4. Authentifizierte RxDB-Pull- und Push-Routen implementieren. Push nutzt die
   vorhandene Domain- und Autorisierungslogik, nie generischen Dokumentersatz.
5. Legacy-M5-Daten einmalig sichern, sichere Intents übernehmen, unsichere
   strukturelle Intents isolieren und den alten Netzschreiber deaktivieren.
6. Formular-Drafts für Campaign- und Team-Text/Farbe mit 800 bis 1200 ms trailing
   commit, Blur, Enter und Sheet-Close einführen.
7. **Umgesetzt:** Nach nachgewiesener HTTP-Korrektheit ergänzt der Worker eine
   hibernierende Durable-Object-WebSocket-Invalidierung pro Campaign. Sie
   signalisiert nur einen Pull und enthält keine kanonischen Daten; ein einzelner
   Campaign-Checkpoint fängt verlorene Signale auf.
8. Abnahmetests, Skalierungssimulation, Typecheck, Audit und Production-Build
   ausführen. Erst danach pushen, CI auf exaktem Head prüfen und den Preview-Status
   berichten.

## Akzeptanzkriterien

- ein fehlender oder konfliktierter Team-Push blockiert keinen Street-Pull;
- unterschiedliche Team-Felder verschmelzen, gleiches Feld konvergiert
  deterministisch, strukturelle Konflikte bleiben auf die Entität begrenzt;
- der normale MapLibre-Renderer aktualisiert reaktiv ohne zweiten Renderer;
- offline bearbeitete Statuswerte und serverseitige Änderungen konvergieren nach
  Reconnect ohne Reload oder Storage-Löschung;
- Team-/Campaign-Text und Farb-Bursts erzeugen jeweils nur einen finalen Write;
- RxDB-Push kann keine vorhandene Worker-Autorisierung oder Domain-Prüfung umgehen;
- keine zwei Shared-Data-Sync-Engines schreiben gleichzeitig;
- Migration 0017 bleibt vorbereitet, lokal getestet und remote unapplied.
- DO-Realtime bleibt ein optionaler Hint; D1, Change Feed, HTTP Pull/Push und
  serverseitige Autorisierung bleiben kanonisch.

### 50–60-Geräte-Sanity-Modell

Die deterministische Suite modelliert 60 Clients über 8 Stunden, 5.000
geänderte Dokumente, Pull-Batches von 100, Push-Batches von 20 und einen
45-Sekunden-Campaign-Checkpoint: 300 Bootstrap-Pulls, 50 inkrementelle Pulls,
250 Push-Batches, 38.400 leichte Checkpoint-Requests und höchstens 300.000
kleine WebSocket-Invalidierungsframes. Das ist ein Traffic-/Fan-out-Modell aus
den tatsächlich implementierten Grenzen, keine Produktionslastmessung. Die
DOs bleiben hibernierend; es gibt keinen Poll pro Collection und keinen
kanonischen Snapshot im Signal.

## Risiken und offene Gates

- Cloudflare Durable Object WebSocket-Hibernation, DO-Binding/Migration und die
  D1-Migration benötigen vor Release eine explizite Remote-Freigabe;
- echte Zwei-Browser-, Android- und iPhone-Smokes bleiben nach CI zwingend;
- UNKLAR: eine von GitHub erzeugte Branch-Preview kann erst nach Push des neuen
  Branch-Heads verifiziert werden.
