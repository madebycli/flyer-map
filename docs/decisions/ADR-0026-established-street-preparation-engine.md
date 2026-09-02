---
id: ADR-0026
type: decision
status: accepted
last_updated: 2026-09-02
related: [ADR-0012, ADR-0013, ADR-0021, plan-029-established-street-preparation-engine]
source_of_truth_for: [street-preparation-engine, street-geometry-invariants, street-task-identity, street-generation-reconcile]
---

# ADR-0026: Established Street Preparation Engine

## Kontext

Die bestehende Area-Preparation ruft OSM bereits serverseitig und begrenzt ab. Die Straßenaufbereitung hatte jedoch eine eigene Clipping-Mathematik und erzeugte für jedes Fragment eine nicht kompatible ID. Das erschwert Reprepare, Feed-Reconciliation und Smart-Street-Referenzen. Die Engine muss die gespeicherte Area-Geometrie exakt respektieren, deterministisch sein und im Browser keine OSM-Aufbereitung ausführen.

## Entscheidung

- JSTS 2.12.1 ist die serverseitige Topologie-Engine für LineString ∩ Polygon. Die Engine akzeptiert nur echte lineare Ergebnisgeometrien, zerlegt MultiLineString und GeometryCollection deterministisch und verwirft leere, ungültige oder nichtlineare Ergebnisse.
- Turf 7.4.0 wird modular verwendet: @turf/boolean-point-in-polygon für Boundary-Invarianten, @turf/nearest-point-on-line für Smart-Street-Snap, @turf/line-slice-along für die A/B-Teilstrecke und @turf/helpers für GeoJSON-Werte.
- OSM iD bleibt Referenz für etablierte OSM-Identitäts- und Tagging-Praxis. osmtogeojson bleibt eine mögliche Differential-Testreferenz. Beide werden nicht als Runtime-Abhängigkeit installiert.
- Die Overpass-Schicht bleibt ein serverseitig gebundener Provider. Roads und Buildings werden in getrennten, begrenzten Phasen geladen und getrennt normalisiert. Jede Phase besitzt einen eigenen guarded Publish. Der Browser sendet keine Overpass-Anfrage.
- Die Engine läuft einmal je serverseitig beanspruchter Area-Generation und liefert Kandidaten mit sourceOsmWayId, sourceKey, fragmentKey, label und exakt geprüftem LineString.
- Die Engine besitzt Normalisierung, Eligibility, exaktes Clipping, Fragmentidentität, Algorithmusversion und Smart-Street-Geometrie. Der Sync-/D1-Adapter besitzt kanonische DistributionTask-Materialisierung, D1-/Feed-Publish, Tombstones, RxDB-Feed und Realtime-Invalidierung.

## Algorithmus- und Identitätsregel

Die aktuelle Version ist street-v2-jsts-2.12.1-turf-7.4.0. Jede Änderung an Clipping, Eligibility, Fragmentidentität, Smart-Street-Geometrie oder relevanter Normalisierung erhöht diese Version.

Die stabile app-owned Task-ID ist generation-unabhängig:

- canonicalStreetFragmentGeometryJson bildet für die Vorwärts- und Rückwärtsfolge die lexikographisch kleinere JSON-Repräsentation und serialisiert { type: "LineString", coordinates }.
- Das Identity-Objekt wird in exakt dieser Reihenfolge serialisiert: namespace "server-prepared-street-v1", campaignId, areaId, sourceOsmWayId, geometry.
- Die ID ist task_auto_ plus der kleingeschriebene SHA-256-Hash der UTF-8-Bytes dieses Identity-JSON.
- Die Generation ist nicht Teil der ID. OSM-Way-ID und Fragmentgeometrie bleiben Provenance beziehungsweise Identitätseingabe, nicht Nutzer- oder Client-Schlüssel.

## Generation und Reprepare

Der Area-Geometrie-Hash ist SHA-256 über die kanonisch nach Schlüssel sortierte Area-Geometrie. Der Preparation-Fingerprint ist SHA-256 über:

{
  algorithmVersion: "street-v2-jsts-2.12.1-turf-7.4.0",
  geometryHash: "..."
}

Ein anderer Geometrie-Hash oder eine andere Algorithmusversion erzeugt eine neue Generation. Ein stale Job darf keine Tasks und keinen Ready-State veröffentlichen.

Bei einer Reprepare wird über die stabile ID reconciled:

- neue IDs werden als inserts erzeugt;
- obsolete offene automatische Streets werden als zulässige deleteIds/Tombstones entfernt;
- bestehende IDs mit Serveränderung werden als updates ausgegeben;
- updates ändern nur Geometrie, Source, Generation und updatedAt;
- label, status, completedAt und createdAt bleiben user-owned und erhalten;
- unveränderte IDs erscheinen in unchangedIds und erzeugen keinen Churn;
- manuelle Tasks und automatische Tasks anderer Areas bleiben unverändert.

## Unabhängige Street-/House-Preparation

Die Area-Preparation besitzt eine gemeinsame Generation mit zwei expliziten Phasenstates: `street_status` und `house_status`. Street und House werden unabhängig geladen, verarbeitet und veröffentlicht. Street ready bleibt sichtbar und kanonisch, wenn House failed ist. House failed wird als eigener Zustand mit eigenem Error-Code angezeigt und kann ohne Street-Neugenerierung erneut versucht werden. Street failed darf House ready lassen, markiert Streets aber niemals fälschlich als ready.

Der aggregierte Status bleibt für bestehende Recovery-Verträge erhalten: Street failed ergibt failed, pending in einem Zweig ergibt pending, und Street ready ergibt ready. Clients müssen für die konkrete Anzeige zusätzlich beide Phasenfelder lesen. Die vollständige lokale/CI-Schemaverbreiterung liegt in `migrations/0015_area_task_preparation_split.sql`; sie wurde nicht auf die Remote-D1 angewendet.

## Worked-Street-Policy

Es gilt Policy A: lock after work started.

Sobald in der Ziel-Area ein automatischer Street- oder House-Task einen Status ungleich open besitzt, ist automatische Neuvorbereitung action-required und nicht retrybar. Der Worker veröffentlicht keinen stale candidate, keine Teilmenge und löscht keinen bearbeiteten automatischen Task. Der Reconcile-Adapter liefert blocked-worked mit den betroffenen IDs. Eine neue Vorbereitung ist erst nach einer expliziten fachlichen Auflösung durch den autorisierten Produkt-/Sync-Flow zulässig. Damit entsteht keine nutzlose Retry-Schleife.

## Geometrie-Invarianten

- Jedes gespeicherte automatische Straßenfragment liegt vollständig innerhalb oder auf der gespeicherten Polygon-Grenze.
- Crossing-Ways werden auf alle inneren Intervalle geschnitten. Concave Areas dürfen mehrere Fragmente pro Way erzeugen.
- BBox-, Endpoint- und Midpoint-Only-Tests sowie ein Clipping-Fallback sind nicht zulässig.
- Ungültige oder numerisch nicht sicher auflösbare Geometrie wird fail-closed verworfen oder als Preparation-Fehler gemeldet.
- JSTS-Clipping bleibt server-only. Die src-Domain darf keine Worker-Module importieren. Die dortige pure Geometrie-Hilfe ist nur für Boundary-/Representative-Validierung zuständig und kein Ersatz für das Street-Topology-Overlay.

## Eligibility und Fehlerdiagnostik

Die Engine akzeptiert nur explizit unterstützte highway-Klassen und lehnt bekannte Nicht-Straßen-, Bau-, aufgegebene und private/no-access-Fälle ab. highway=* wird nicht blind übernommen. Die Policy ist versioniert und durch Fixtures abgedeckt.

Fehlerdiagnostik unterscheidet Timeout, HTTP 429, HTTP 5xx, einzelne oder aggregierte Antwortgrößen, Road-Normalisierung, Building-Volumen, Street-Topologie und guarded D1-Publish. Jeder Fehler bleibt innerhalb seiner Phase fail-closed: eine fehlgeschlagene Street-Phase veröffentlicht keine Streets, ein House-Fehler versteckt keine bereits erfolgreichen Streets.

## UI-Vertrag

Ready vorbereitete Straßen erscheinen sofort als normale MapLibre-Straßen. Smart Street arbeitet ausschließlich mit diesen vorbereiteten Kandidaten, bietet bei Ambiguität mehrere Snap-Kandidaten an, markiert nur das A/B-Intervall und speichert dieselbe geprüfte LineString-Geometrie wie die Vorschau. Eine manuelle Add-Voraussetzung oder eine XXL-Straßenliste wird nicht eingeführt.

## Konsequenzen

JSTS erhöht die serverseitige Dependency- und Bundle-Größe, ersetzt aber risikoreiche Eigenmathematik an der Topologie-Grenze. Turf bleibt modular und wird nicht als Vollbundle installiert. Die unabhängigen Phasen erhöhen pro vollständiger Area-Preparation die guarded Revision-Schritte, sparen bei isolierten Retries aber erneute OSM- und D1-Arbeit. Die separate RxDB-/D1-Feed-Integration wird in docs/SYNC_REQUIREMENTS_FOR_STREET_ENGINE.md spezifiziert und nicht in diesem Branch implementiert. Migration 0015 bleibt vorbereitet, bis ein separater autorisierter Remote-Rollout erfolgt.

## Verifikation

Die Abnahme umfasst Fixture-basierte Clipping- und Eligibility-Tests, stabile ID-/Reconcile-Tests, Reprepare-Delta-Tests, unabhängige Street-/House-Publish- und Retry-Isolationstests, Smart-Street-Snap-/Slice-Tests, Layering-Contract-Tests, D1-Atomicity-Tests sowie npm test, npm run typecheck, npm run audit:dependencies und npm run build am exakten finalen Branch-Head. Echte Android-/iPhone-Geräte bleiben ein separates offenes Abnahme-Gate.