# PLAN: Smart Marking mit echten Zwischenzielen

Stand 2026-09-13, aktiv: begrenzter Kandidat umgesetzt, lokale Regressionen bestanden, exakte Kandidaten-CI und Geräteabnahme ausstehend. Ergänzt PLAN-035. Evidence-Freeze: `fix/street-engine-smart-marking@3ad3fc755bbdcfa03a1b1110312a0f3ab198af31`, Draft PR92, Base `integration/main-street-runtime@f4facd6ef354c5ba6de861519b696bce6f46a209`. Keine neue Deployment-Evidence.

## Befund und begrenzter Fix

`useNetworkWorkspace.accept` verwirft bei Punkt 3 die bestehende A/B-Auswahl. MapView besitzt schon Start-/Zwischen-/End-GeoJSON, Kreise mit weißem Rand und Labels; der Hook liefert keine Zwischenpunkte. Die API kennt nur A/B. Generation und Pfad werden geprüft, zwischenzeitliche Coverage-Änderungen jedoch nicht. `setCoverage` teilt Intervalle korrekt; das konkrete 8–25-Prozent-Beispiel wird zusätzlich gesichert. Adresslose Buildings sind bereits ausgeschlossen. Address-Nodes werden bisher per Map still nach letzter ID dedupliziert, auch bei widersprüchlichen Daten.

## Vertrag und Aufgaben

1. Höchstens 32 sichtbare Punkte, mindestens sechs im normalen Test. Jeder benachbarte Punkt bildet einen eigenen serverseitig nachgerechneten Leg. Mehrdeutigkeit pro Leg auflösen, bevor ein weiterer Punkt gesetzt wird. Frühere Vorschau und alle Punkte bleiben sichtbar. Letzten Punkt oder noch unaufgelösten Tipp rückgängig machen; vollständiger Reset und Abbruch. Statusaktionen erst bei vollständiger Route, gegen Doppelklick geschützt.
2. Ein Intent, ein Status, eine atomare Revision für alle Legs. Bestehende Start/End/selectedPath-Felder bleiben; additive via/paths beschreiben die Zwischenziele. Maximal 500 Arcs insgesamt und bestehendes 32.000-Byte-Limit. Kein geometrischer Direktstrich zwischen entfernten Punkten.
3. SHA-256 des kanonisch sortierten Zustands aller betroffenen Straßen (Generation, Geometrie, Network/Coverage) als erwarteter Zustand. UI friert die Auswahlbasis ein. API prüft vor dem atomaren Schreiben, ohne neue D1-Abfragen. Statusänderung auf derselben Straße führt konservativ zu einem sichtbaren Konflikt, auch bei nicht überlappenden Bereichen. Bereits gespeicherte alte Intents bleiben replayfähig; alte noch nicht gespeicherte Intents ohne Zustandsbeleg brauchen eine neue Auswahl. Kein stiller Legacy-Overwrite.
4. Dieselbe Vorschau aus persistiertem Intent bei Offline/Reload. Folgeaktionen bauen auf der sichtbaren optimistischen Coverage auf; blockierte Vorgänger erlauben keine verdeckte Übernahme. Kein automatisches Rebasen auf fremde Arbeit.
5. Widersprüchliche Address-Node-IDs müssen wie widersprüchliche Building-IDs abbrechen; keine stille letzte Quelle. Bestehende Regel bleibt: verwertbare Hausnummer direkt oder zugeordnet nötig; ein adressiertes Nebengebäude kann ein echtes Postziel sein. Ein fehlender Straßenname allein verwirft eine verwertbare Hausnummer nicht.

## Dateien, Abnahme und Grenzen

`src/domain/networkSelection.ts` für begrenzten Intent-/Routing-/Zustandsvertrag, `worker/streetNetwork/api.ts`, `src/map/useNetworkWorkspace.tsx`, `NetworkWorkspacePanel.tsx`, `worker/streetNetwork/addresses.ts`. Vorhandene MapLibre-Punktlayer verwenden. Keine neue Tabelle, Migration, Abhängigkeit oder Collection-Funktion.

Regressionen: sechs Punkte einschließlich Umweg/Umkehr; pro-Leg-Mehrdeutigkeit; Undo/Reset; sichtbare Anker bei noch offener Straßenwahl; atomarer Mehrpunkt-Intent mit Replay, manipuliertem Zwischenziel und veralteter Coverage; exaktes Intervallbeispiel rückwärts, Wiederöffnen und Zusammenführen; House-Filter und widersprüchliche IDs. Bestehende 10k-DO-Querybudget- und RxDB-Tests erhalten. Gesamtsuite, Typecheck, Audit, Build, Remote-Readback und SHA-genaue CI.

Gemeinsame Abschnittssemantik und Bedienung sind eine Anforderung für den späteren Collection-Adapter. Es wird kein Abholservice, keine Collection-Area und keine neue Aktionsart gebaut. Distribution-Hausausnahmen gemäß ADR-0027 bleiben erhalten; Straßen-Coverage und Hausfortschritt sind unterschiedliche explizite Bezugsgrößen. Collection-Parität und mobile Sichtbarkeit sind dadurch noch nicht abgenommen.

Rollback: Code-Revert zusammengehöriger UI/API-Verträge. Vorhandene Coverage bleibt lesbar; neue Mehrpunkt-Intents niemals durch einen alten A/B-Writer abspielen. Deshalb bei Rollback neue Schreibzugriffe sperren oder wartende Intents sichtbar zur Neuauswahl blockieren. Keine Queue löschen.

## Offene Abnahme

Echtes iPad/iPhone/Android, MapLibre-Sichtbarkeit, Reload/Zweitclient auf Staging sowie live erfolgreicher Preparation-Job fehlen. PLAN-035 Pause/Resume, 20k, Quellfehler-Livezuordnung und Graph-Rereads bleiben offen. `STREET_ENGINE_LIVE_READY=FALSE`, `D1_ATTRIBUTION_CONFIRMED=FALSE`, `MAP_RENDER_P0=OPEN`.
