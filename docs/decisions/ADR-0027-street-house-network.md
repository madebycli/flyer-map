# ADR-0027: Kanonisches Street-/House-Netz

Status: accepted for implementation by the explicit recovery task.

## Problem und Befund
Main lädt Roads und Buildings in einem Job, verwirft House-Zuordnungen und
interpretiert eine stabile Street-ID als unverändertes Objekt einschließlich
Generation. Die Routing-Adjazenz prüft jedes Straßenpaar und nur Endpunkte.
Die Baseline-Tests bestätigen dieses Verhalten, nicht die neue Produktsemantik.

## Optionen
1. Bestehende monolithische Tasks weiter aufteilen: wenig Schemaänderung,
   aber zahlreiche Statusobjekte, teure Reprepares und keine robuste Fortsetzung.
2. Topologische Kanten mit Coverage-Intervallen, House-Measures und D1-Jobs:
   additive Metadaten, begrenzte Arbeitsschritte, ein kanonischer Feed.

Gewählt: Option 2. Komplexität mittel bis hoch, aber keine zusätzliche Cloud-
Infrastruktur. Indexierte räumliche Kandidaten vermeiden Haus-mal-Straße-Scans.
JSTS 2.12.1 (EPL/EDL) löst serverseitiges Clipping; modulare Turf 7.3.1 (MIT)
berechnet Snap, Längen und Slices; RBush 4.0.1 (MIT) indexiert Kandidaten.
Keine API-Schlüssel und kein bezahlter Geometrie-SaaS erforderlich.

## Invarianten
- Nur ein Reconcile-Einstieg, zentrale SHA-256-Identität, bestehender Namespace.
- Knoten berücksichtigen OSM-Topologie; Brücken kreuzen nicht automatisch.
- Generationen werden erst als Ganzes kanonisch publiziert. Getrennte Fetch-
  Phasen sind recoverbar; House-Fehler bedeutet keine vollständige Ready-Generation.
- Statusintervalle sind disjunkt und zusammengeführt, unabhängig von A/B-Richtung.
- User-owned Labels, Status und Zeitpunkte bleiben bei Reprepare erhalten.
- Completion übernimmt offene Häuser. Later/not-deliverable bleiben unverändert.
- House-Änderungen dürfen keine automatische Full-Street-Completion erzeugen.
- Autorisierung verwendet die vorhandenen kanonischen Campaign-/Area-/Team-Grenzen.

## Migration und Rollback
Additive Migration, keine Production-Ausführung. Alte bearbeitete Tasks bleiben
erhalten. Neue Metadaten sind für alte Leser optional. Rollback: vorherigen Code
deployen, keine Tabellen löschen. Vor Rollback neue Network-Schreibaktionen
anhalten; alte Clients dürfen Coverage nicht über einen Full-Street-Status ersetzen.
SYNC-CURSOR-001 und Admin-Audit-Findings bleiben separate Release-Blocker.

Diese Entscheidung ersetzt die monolithische Vorbereitung aus ADR-0021 für die
neue Network-Generation. Historische manuelle Aufgaben bleiben kompatibel.
