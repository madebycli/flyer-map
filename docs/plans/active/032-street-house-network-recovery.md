# Street / House Network Recovery

## Ziel
Ein kanonisches serverseitiges Straßennetz mit echten A/B-Teilabschnitten,
Hauszuordnung, verlustfreier Statuspropagation und fortsetzbarer Vorbereitung.

## Basis
- Remote main: `4d860e8640761c10afdadb62a10ebb59fd43841f`, erneut fetched.
- CI: https://github.com/madebycli/flyer-map/actions/runs/34162336104, success.
- Referenz PR #75: `501b8058302342358c8eaed5c67e378b02deb0c0`, read-only.
- Beide vom Nutzer angehängten Audits vom 2026-09-07 wurden berücksichtigt.
- Kontext: ADR-0021, ADR-0024, ADR-0025, Map, Data, Offline Sync, Security.
- Baseline: 31 fokussierte Tests bestanden. Ein vorhandener 500-Straßen-
  Reconcile-Test benötigt ca. 102 ms lokal; kein Cloudflare-Lastnachweis.

## Anforderungen
- D1 autoritativ; Generationen, Geometrie und Zuordnungen nur serverseitig.
- A/B folgt Graphkanten; Mehrdeutigkeit verlangt Auswahl.
- Coverage als Intervalle, keine Zeile pro zehn Meter.
- Häuser primäre Statistik; Straßenlänge nur Fallback/interne Metrik.
- Completion propagiert ausschließlich auf zugeordnete offene Häuser im Intervall.
- Manuelle Ausnahmezustände erhalten. Einzelne Hausaktion schließt keine Straße.
- D1 und Feed atomar; stale Generationen dürfen nicht publizieren.
- Mindestens 1.000 Häuser und größere synthetische Fixtures messen.

## Architektur
Siehe ADR-0027. Bestehende fünf RxDB-Collections bleiben der kanonische Lesepfad.
Straßen erhalten Coverage-Metadaten, Häuser eine serverseitige Position.
Eine D1-Jobtabelle hält kleine idempotente Vorbereitungsschritte.

## Dateistruktur / erste Dateien
1. `src/domain/streetNetwork.ts`: Coverage-, Route- und Zuordnungstypen, gemeinsame Vorschau.
2. `worker/streetNetwork/geometry.ts`: geprüfte serverseitige Normalisierung und Graphbildung.
3. `tests/streetNetwork.test.ts`: geometrische Regressionen und Skalierungsfixtures.

## Umsetzungsschritte
1. Baseline und Audit prüfen, Fehler reproduzieren.
2. Regressionen, Graph und zentrale Identität implementieren.
3. D1-Jobzustände, getrennte Quellen und guarded Publish integrieren.
4. A/B-Mutation, House-Propagation, Statistik und Map integrieren.
5. Reconcile, RxDB-Konvergenz und Offline-Reconnect prüfen.
6. Corpus und Performance messen; exact-head CI und isoliertes Staging.
7. PR und `docs/status/STREET_HOUSE_NETWORK_RECOVERY_HANDOFF.md` erstellen.

## Offene Fragen / Unklarheiten
- Live-400-Fixkandidat: leere Transport-Streams statt Stream-Existenz prüfen.
  Regression zuerst mit 400 statt 202 reproduziert, danach 23 fokussierte Tests
  grün einschließlich Payload-Ablehnung und kanonischer Publikation. Lokaler
  JS-TypeScript-Check grün; Build-Aufruf durch Netzwerkfreigabe blockiert.
  Nächster Gate: CI/Staging dieses Kandidaten, danach Masters authentifizierter
  Vorbereitungslauf mit echten OSM-Daten, Reload und Sync. 25-s-Live-Laufzeit und
  fehlender Response-Text bleiben ohne konkrete Live-Antwort unaufgeklärt.
- UNKLAR: Audit nennt andere ID-/Fingerprint-Formeln als PR #75 auf seinem
  angegebenen SHA. Der tatsächlich gelesene Vertrag verwendet SHA-256 über
  `server-prepared-street-v1` plus kanonische Geometrie. Keine blinde Umstellung.
- SYNC-CURSOR-001 bleibt expliziter separater Release-Blocker.
- Admin-Findings bleiben außerhalb dieses Auftrags.
- Echte Android-/iPhone-Akzeptanz darf nicht durch Desktoptests ersetzt werden.

## Nicht-Ziele
Production-Deploy, Production-Migration, Admin-Security-Umbau, neue SaaS-Dienste.
