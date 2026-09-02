---
id: ADR-0026
type: decision
status: accepted
last_updated: 2026-09-02
related: [ADR-0012, ADR-0013, ADR-0021, plan-029-established-street-preparation-engine]
source_of_truth_for: [street-preparation-engine, street-geometry-invariants, street-task-identity]
---

# ADR-0026: Established Street Preparation Engine

## Kontext

Die bestehende Area-Preparation ruft OSM bereits serverseitig und begrenzt ab. Die Straßenaufbereitung hatte jedoch eine eigene Clipping-Mathematik und erzeugte für jedes Fragment eine zufällige ID. Das erschwert Reprepare, Feed-Reconciliation und Smart-Street-Referenzen. Die Engine muss die gespeicherte Area-Geometrie exakt respektieren, deterministisch sein und im Browser keine OSM-Aufbereitung ausführen.

## Entscheidung

- JSTS `2.12.1` ist die serverseitige Topologie-Engine für `LineString ∩ Polygon`. Die Engine akzeptiert nur echte lineare Ergebnisgeometrien, zerlegt `MultiLineString` und `GeometryCollection` deterministisch und verwirft leere, ungültige oder nichtlineare Ergebnisse.
- Turf `7.4.0` wird modular verwendet: `@turf/boolean-point-in-polygon` als Boundary-Invariant, `@turf/nearest-point-on-line` für Smart-Street-Snap, `@turf/line-slice-along` für die A/B-Teilstrecke und `@turf/helpers` für GeoJSON-Werte.
- OSM iD bleibt Referenz für etablierte OSM-Identitäts- und Tagging-Praxis. `osmtogeojson` bleibt eine mögliche Differential-Testreferenz. Beide werden nicht als Runtime-Abhängigkeit installiert.
- Die bestehende Overpass-Schicht bleibt ein serverseitiger, gebundener Provider. Der Browser sendet keine Overpass-Anfrage. Die Engine läuft einmal je serverseitig beanspruchter Area-Generation.
- Automatische Street Tasks erhalten eine stabile app-owned ID aus Campaign, Area, OSM-Way und kanonischem Fragment. OSM-Way-IDs bleiben Provenance und werden nie zur Task-Identität.
- Die bestehende geschützte D1-Publish-Grenze bleibt atomar. Vor dem Publish wird gegen vorhandene automatische Straßen reconciled: unveränderte IDs bleiben erhalten, obsolete offene automatische Tasks dürfen entfernt werden, bearbeitete obsolete automatische Tasks blockieren die Generation, manuelle Tasks bleiben unangetastet.

## Algorithmus- und Cache-Regel

Die Preparation-Fingerprint enthält Area-Geometrie-Hash und `AREA_STREET_PREPARATION_ALGORITHM_VERSION`. Eine Änderung der Geometrie oder Algorithmus-Version erzeugt eine neue Generation. Eine fertige Generation wird bei identischem Fingerprint wiederverwendet. Eine veraltete Generation darf weder Tasks noch Ready-State veröffentlichen.

## Geometrie-Invarianten

- Jedes gespeicherte automatische Straßenfragment liegt vollständig innerhalb oder auf der gespeicherten Polygon-Grenze.
- Crossing-Ways werden auf alle inneren Intervalle geschnitten. Concave Areas dürfen mehrere Fragmente pro Way erzeugen.
- BBox-, Endpoint- und Midpoint-Only-Tests sowie ein Clipping-Fallback sind nicht zulässig.
- Ungültige oder numerisch nicht sicher auflösbare Geometrie wird fail-closed verworfen oder als Preparation-Fehler gemeldet.

## Eligibility

Die Engine akzeptiert nur explizit unterstützte `highway`-Klassen und lehnt bekannte Nicht-Straßen-, Bau-, aufgegebene und private/no-access-Fälle ab. `highway=*` wird nicht blind übernommen. Die Policy ist versioniert und durch Fixtures abgedeckt.

## UI-Vertrag

Ready vorbereitete Straßen erscheinen sofort als normale MapLibre-Straßen. Smart Street arbeitet ausschließlich mit diesen vorbereiteten Kandidaten, bietet bei Ambiguität mehrere Snap-Kandidaten an, markiert nur das A/B-Intervall und speichert dieselbe geprüfte LineString-Geometrie wie die Vorschau. Eine manuelle Add-Voraussetzung oder eine XXL-Straßenliste wird nicht eingeführt.

## Konsequenzen

JSTS erhöht die serverseitige Dependency- und Bundle-Größe, ersetzt aber risikoreiche Eigenmathematik an der Topologie-Grenze. Turf bleibt modular und wird nicht als Vollbundle installiert. Die separate RxDB-/D1-Feed-Integration wird in `docs/SYNC_REQUIREMENTS_FOR_STREET_ENGINE.md` spezifiziert und nicht in diesem Branch implementiert.

## Verifikation

Die Abnahme umfasst Fixture-basierte Clipping- und Eligibility-Tests, stabile ID-/Reconcile-Tests, Smart-Street-Snap-/Slice-Tests, D1-Atomicity-Tests sowie `npm test`, `npm run typecheck`, `npm run audit:dependencies` und `npm run build` am exakten finalen Branch-Head.
