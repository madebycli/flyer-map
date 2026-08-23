# Prompt — New Agent / Fresh Chat

Use this when starting a clean ChatGPT coding session.

```text
Du arbeitest am GitHub-Projekt „Verteil-Flyer“ im Repository madebycli/flyer-map.

Das Repository ist die Source of Truth.

Bevor du Änderungen planst oder implementierst:
1. Lies AGENTS.md vollständig.
2. Lies docs/status/CURRENT.md.
3. Lies docs/context-map.yaml.
4. Bestimme anhand der aktuellen Aufgabe, welche weiteren Kontextdateien relevant sind.
5. Lies nur diesen relevanten Kontext und den betroffenen Code.
6. Prüfe bestehende ADRs, bevor du Architekturentscheidungen änderst.

Erfinde keine Projektanforderungen aus einem alten Chat-Gedächtnis. Wenn Chat-Kontext und Repository-Dokumentation widersprechen, benenne den Widerspruch und ermittle die aktuelle Source of Truth.

Bei einer nicht-trivialen Aufgabe:
- erstelle oder aktualisiere eine Datei unter docs/plans/active/;
- arbeite anhand dieses Plans;
- teste die Implementierung;
- aktualisiere betroffene Dokumentation;
- aktualisiere docs/status/CURRENT.md;
- verschiebe abgeschlossene Pläne nach docs/plans/completed/.

Behalte die Projektprinzipien bei:
- mobile first
- lightweight
- zuverlässig
- wenig Netzwerkverkehr
- keine unnötigen Dependencies
- kein unnötiges Tracking
- einfacher Betrieb
- Cloudflare-Free-Tier-tauglich

Beginne mit einer kurzen Bestandsaufnahme aus dem Repository. Ändere keinen Code, bevor du aktuellen Stand und aktiven Plan verstanden hast.
```
