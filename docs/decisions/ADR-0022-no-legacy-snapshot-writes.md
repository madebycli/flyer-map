---
id: ADR-0022
type: decision
status: accepted
date: 2026-09-01
---

# ADR-0022: Kein Legacy-Snapshot-Write nach M5

## Status

Accepted. Nach Abschluss der M5-Transition ist der vollständige Snapshot kein allgemeiner Schreibpayload mehr.

## Kontext

Der Campaign-Snapshot bleibt das gemeinsame Lese- und UI-Modell. Er wird außerdem als lokaler Startup-Cache sowie als Konflikt- und Sicherheitskopie verwendet. Eine vollständige Snapshot-Ersetzung als allgemeiner Schreibweg vermischt diese Rollen, kann veraltete lokale Zustände in die kanonische D1-Wahrheit zurückschreiben und umgeht die fachlich engen M5-Mutationen.

Die M5-Queue und die spezialisierten Collection/Pickup-Mutationen sind bereits der autoritative Schreibweg für normale Änderungen. Der serverseitige Create-Pfad ist davon getrennt, weil eine neue Campaign noch keinen bestehenden Zustand ersetzt.

## Entscheidung

1. `POST /api/campaigns` bleibt der einmalige serverseitige Initial-Create. Er akzeptiert nur einen validierten Snapshot mit `revision: 0` und delegiert an `createInitialCampaignState`. Dieser Pfad claimt eine noch nicht vorhandene Campaign und fügt den initialen Campaign-, Team-, Area- und Task-Zustand atomar ein. Er löscht nichts, aktualisiert keine bestehende Campaign und vergibt in diesem Schritt keinen Access Grant.
2. `GET /api/campaigns/:id/snapshot` und `GET /api/campaigns/:id/version` bleiben geschützte Read-Model-Endpunkte.
3. `PUT /api/campaigns/:id/snapshot` ist abgeschaltet und antwortet vor Payload-Verarbeitung und Access-Auflösung mit HTTP 410, Code `legacy_snapshot_write_retired` und einer klaren Migrationserklärung. Der Endpunkt beansprucht keine Revision und schreibt nicht nach D1.
4. Alle normalen Campaign-, Team-, Area-, Street-, House-, Collection- und Pickup-Änderungen laufen über explizite M5- oder spezialisierte Mutationen. Es gibt keinen Mutationstyp `snapshot.replace` und keine erneute pauschale Snapshot-Replacement-Abkürzung.
5. Der lokale Snapshot-Cache bleibt ein Read-/Startup-/Recovery-Modell. Erkennt der Store bei leerer Queue eine Abweichung, legt er den lokalen Zustand in der bestehenden Konfliktkopie ab, zeigt den kanonischen Serverzustand an und meldet den Konflikt sichtbar. Eine automatische Server-PUT-Recovery findet nicht statt. Ausstehende Queue-Einträge bleiben der maßgebliche Schreibweg.

## Konsequenzen

Vorteile:
- fachliche Änderungen sind im Mutationstyp, Target, Scope und Worker-Handler sichtbar;
- D1 erhält keine veralteten Komplett-Snapshots mehr über einen generischen Endpoint;
- lokale Konflikt- und Startup-Daten bleiben wiederherstellbar, ohne kanonische Daten automatisch zu überschreiben;
- die historische Team-FK-Entscheidung aus Migration 0002 bleibt unverändert, ist aber nicht mehr von einem laufenden Snapshot-Replacement abhängig.

Kosten und Grenzen:
- ein altes oder externes Client-Release, das noch den Snapshot-PUT aufruft, erhält bewusst 410 und muss auf M5-Mutationen aktualisiert werden;
- `POST /api/campaigns` ist nur Initial-Create und ersetzt keine bestehende Campaign;
- fehlende additive D1-Schemas bleiben spezifische fail-closed Fehler und werden durch diesen Slice nicht remote migriert;
- eine zukünftige breite Operation braucht einen eigenen fachlichen Mutationstyp mit eigener Autorisierung, Konflikt- und Persistenzsemantik.

## Verworfen

- den Snapshot-PUT als versteckten Recovery-Weg beizubehalten: dadurch bliebe der grobe Schreibvertrag aktiv und lokale Zustände könnten weiterhin kanonische Daten ersetzen;
- den Snapshot als Mutationstyp zu queueen: dadurch würde die fachliche Enge der M5-Mutationen wieder verloren;
- die bestehende Campaign beim `POST /api/campaigns` zu ersetzen: Create und Update würden semantisch vermischt und der Initial-Create könnte Daten löschen.
