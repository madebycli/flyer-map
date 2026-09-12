# Plan 034: StreetEngine, systemweite D1-Reads und Sync

Status: aktiv, Analysecheckpoint 2026-09-12. Runtime-Fixes sind noch nicht
freigegeben.

## Ziel und belastbarer Stand

Der vollständige Audit- und Umsetzungsplan steht in
[STREET_ENGINE_D1_AUDIT.md](../../status/STREET_ENGINE_D1_AUDIT.md). Er wurde
auf dem Branch fix/street-engine-smart-marking als Dokumentationscommit
e6641486e40806001c50bcf488df438093bb46b1 geschrieben.

Der letzte vollständig verifizierte Runtime-Stand davor ist
3e1dfb409cb63381b9a7154cd3a941252da95263. PR #92 ist weiterhin offen, Draft
und ungemergt.

## Analyseergebnis

- Die gemeldeten ungefähr 4,5 Millionen D1-Rows-Read sind nicht live
  attribuiert. Die stärksten Kandidaten sind unpaged Cold-Bootstraps,
  wiederholte Campaign-Snapshots, breite House-Zielpfade und
  Collection-Member-Reads.
- Der StreetEngine-Fehler ist durch die Screenshots auf 40 Prozent,
  Gebäude laden, Buildings-Cursor 0 eingegrenzt. Die konkrete Upstream- oder
  Job-Fehlerklasse fehlt noch.
- Der bestätigte lokale Street-Hotspot ist das erneute vollständige Lesen
  der Edge-Stagingdaten pro 250er-House-Slice.
- Smart House ist im Haupt-App-Pfad noch nicht end-to-end verdrahtet.
  Smart Marking bleibt ausdrücklich user-directed.
- Gebiet zeichnen und Gebiet editieren sollen denselben kompakten
  Street-Style-Header erhalten: Zurück, Abbrechen, Approved/Freigegeben,
  Punktzahl n/max und Bestätigen nur bei gültiger Geometrie.
- Kommentare werden als echter Toggle umgesetzt. Der breite sichtbare
  Kommentare-schließen-Button entfällt; Snap, Mindesthöhe, Position und
  Breite werden mit dem Field-HUD gemeinsam festgelegt.

## Nächste freigegebene Reihenfolge

1. Bestehende Job-, D1- und Network-Evidence read-only sichern.
2. Buildings-Cursor-0-Fehler klassifizieren.
3. D1-Read-Instrumentation und realistische lokale Kardinalitätstests
   ergänzen.
4. Unpaged Snapshots, Bootstrap, House-Zielpfad und Collection-Reads
   begrenzen.
5. Preparation-Idempotenz, Retry, Lease und Edge-Read-Amplifikation
   reparieren.
6. Sync-, Zwei-Client- und Real-Device-Gates schließen.
7. Gemeinsamen Area-Geometry-Header, Kommentar-Toggle und danach Smart
   Street/Smart House umsetzen.
8. Erst danach CI, Admin-Staging und Geräteabnahme auf einem exact-head.

## Grenzen

Keine Produktionsänderung, kein Merge, kein Force-Push, keine Remote-D1-
Migration oder Remote-D1-Schreiboperation und kein großer Lasttest wurde
durchgeführt. Fehlende Live-Metriken und Geräte-Evidence bleiben offene
Blocker.
