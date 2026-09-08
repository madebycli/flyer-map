# Street Multi-Device

## Basis

- Draft-PR: #84
- Ausgangs-Head: `c2bf0bf0ef12704ce52612181dbb574837d77749`
- Ergänzung: `tests/mainStreetMultiDevice.test.ts`

## Testmatrix

| Szenario | Status | Evidenz |
| --- | --- | --- |
| Initialer Bootstrap | PASS | Street-spezifischer bestehender RxDB-Test und neuer Checkpoint-Test laden Street- und House-Dokumente vollständig |
| Offline-Änderung | PASS | `streetNetworkIntegration.test.ts` hält Client B offline, schreibt House lokal und synchronisiert nach Reconnect |
| Reload / Reconnect | PASS | Neuer Test simuliert einen spät wiederkehrenden Client vom persistierten Checkpoint, bestehender Real-RxDB-Test prüft Reconnect |
| Lost Response | PASS | `rxdbP0Semantics.test.ts` prüft Wiederholung ohne doppelte kanonische Mutation |
| Konflikt | PASS | `rxdbP0Semantics.test.ts` und RxDB-Push-Adapter prüfen stale assumed-master Konflikte |
| Tombstone | PASS | Bestehende P0-RxDB-Semantik prüft Delete/Tombstone-Synchronisation |
| Checkpoint | PASS | Neuer Street-/House-Test beweist identischen High-Water-Checkpoint für zwei Clients und beide Collections |
| Leader-Wechsel | PASS | `rxdbP0Semantics.test.ts`: zwei `multiInstance: true` Tabs wählen einen Replication-Leader, Handover dupliziert keine Writes |
| Sichtbare Konvergenz | PASS | Bestehender Test mit zwei echten `MissionRxdbSync`-Instanzen plus neuer late-client Checkpoint-Test |

## Rest-Risiken

Der neue Test läuft bewusst auf der Worker-/RxDB-Protokollebene und dupliziert nicht den bereits vorhandenen vollständigen Zwei-RxDB-Test. Ein echter Browser-Tab-Handover mit IndexedDB bleibt UI-/Browser-Evidenz und wird nicht als neuer Node-Test nachgebaut.

## Geänderte Dateien

- `tests/mainStreetMultiDevice.test.ts`
- `docs/status/external-audits/STREET_MULTI_DEVICE.md`

## Sicherheitsgrenzen

Kein Merge und kein Deploy.
