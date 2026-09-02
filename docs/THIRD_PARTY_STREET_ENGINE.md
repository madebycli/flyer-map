---
id: third-party-street-engine
type: architecture
status: accepted
last_updated: 2026-09-02
related: [ADR-0026, architecture-stack, quality]
source_of_truth_for: [street-engine-dependencies, street-engine-licenses]
---

# Third-Party Review: Street Engine

## Runtime-Abhängigkeiten

| Paket | Pin | Lizenz | Einsatz | Quelle |
| --- | --- | --- | --- | --- |
| `jsts` | `2.12.1` | `(EDL-1.0 OR EPL-1.0)` | Serverseitige robuste Topologie für LineString/Polygon-Intersection | [JSTS Repository](https://github.com/bjornharrtell/jsts) |
| `@turf/helpers` | `7.4.0` | MIT | Kleine GeoJSON-Konstruktoren für Client- und Testpfade | [Turf helpers](https://github.com/Turfjs/turf/tree/master/packages/turf-helpers) |
| `@turf/distance` | `7.4.0` | MIT | Geodesische Segmentdistanzen für validierte A/B-Positionen | [Turf distance](https://github.com/Turfjs/turf/tree/master/packages/turf-distance) |
| `@turf/boolean-point-in-polygon` | `7.4.0` | MIT | Boundary-aware Point-in-Polygon-Invariant | [Turf boolean-point-in-polygon](https://github.com/Turfjs/turf/tree/master/packages/turf-boolean-point-in-polygon) |
| `@turf/nearest-point-on-line` | `7.4.0` | MIT | Smart-Street-Snap auf vorbereitete LineStrings | [Turf nearest-point-on-line](https://github.com/Turfjs/turf/tree/master/packages/turf-nearest-point-on-line) |
| `@turf/line-slice-along` | `7.4.0` | MIT | Exakte A/B-Teilstrecke auf einer geprüften Straße | [Turf line-slice-along](https://github.com/Turfjs/turf/tree/master/packages/turf-line-slice-along) |

Die Versionen sind in `package.json` gepinnt. Das Projekt installiert nicht das große `@turf/turf`-Bundle.

## Referenz- und Differential-Optionen

| Projekt | Lizenz | Entscheidung | Quelle |
| --- | --- | --- | --- |
| OpenStreetMap iD | ISC | Nur Referenz für etablierte OSM-Tagging-/Identitätskonventionen, kein Editor und keine Runtime-Abhängigkeit | [iD Repository](https://github.com/openstreetmap/iD) |
| osmtogeojson | MIT | Nur mögliche Differential-Testreferenz für OSM-GeoJSON-Normalisierung, kein zweiter Produktionspfad | [osmtogeojson Repository](https://github.com/tyrasd/osmtogeojson) |
| Overpass Turbo | GPL-3.0 | Nur Query-/Datenexplorationsreferenz, nicht Bestandteil des Workers oder Browsers | [Overpass Turbo Repository](https://github.com/tyrasd/overpass-turbo) |

## Lizenz- und Betriebsregeln

- Inkompatible Lizenzannahmen werden nicht durch Copy/Paste von Quellcode umgangen.
- JSTS wird ausschließlich über seine veröffentlichte Paketgrenze importiert; die EDL/EPL-Auswahl bleibt in dieser Dokumentation sichtbar.
- OSM-/Overpass-Daten bleiben mit Provenance und der bestehenden Attribution-/Tagging-Policy verbunden.
- Private Area-Geometrien und Rohdaten werden nicht in Diagnostics oder Logs geschrieben.
- Ein späteres Upgrade von JSTS oder Turf erfordert neue Bakeoff-/CI-Ergebnisse und eine erneute Dokumentationsprüfung.
