---
id: status-current
type: status
status: active
last_updated: 2026-08-30
---

# Current Project State

## Product baseline

Verteil-Flyer ist eine mobile-first normale Website.

Technischer Kern:
- React, TypeScript und Vite;
- MapLibre GL JS 5.7.1 für die Feldkarte;
- Cloudflare Workers und D1 für Shared Runtime und Persistenz;
- M4 Access/Session, M5 resiliente Mutation-Synchronisierung und M5.5 vorbereitete Offline-Kartendaten bleiben etablierte Grundlagen.

Weiterhin ausgeschlossen:
- native App Runtime;
- installierbare PWA;
- Service Worker;
- Web App Manifest;
- Background Sync;
- kontinuierliche GPS-Historie.

## Active delivery

Plan 017 bleibt die übergeordnete Feature-Complete-Delivery-Linie.

Abgeschlossen:
- Plan 018 House Polygon Renderer;
- Plan 019 Smart Street Runtime;
- Plan 020 Smart House Runtime.

Aktiver Entwicklungsstack vor diesem Planner-Update:
- Branch `plan-feature-complete-platform`;
- Draft PR #72 gegen `ui-app-launcher-sheet`;
- verifizierter Ausgangs-Head `af417ff8ebb92d0e8b471feb1861089fc4795f13`;
- CI #713 auf exakt diesem Ausgangs-Head vollständig grün;
- PR #72 offen, Draft, mergeable und nicht gemerged.

Jeder nachfolgende Dokumentations- oder Runtime-Commit verschiebt den Head. GitHub bleibt für den jeweils exakten Head und CI maßgeblich.

## Implementierter Plattformstand

Auf PR #72 sind umgesetzt:
- FC0 PlatformShell/App Navigation und aktiver Teamkontext;
- Team Hub und Live Field Groups;
- Field Sessions und Einsatzhistorie;
- durable Comments für Campaign, Area, Street Task und persistierte House Tasks;
- bounded Activity aus `domain_events`;
- erste deterministische/idempotente Automation;
- echte serverseitige Stats mit getrennten Street-/House-Nennern;
- normaler Smart-Street-Flow aus vorbereitetem OSM-Paket;
- normaler Smart-House-Flow aus vorbereiteten OSM-Gebäudekandidaten;
- persistierter House-Polygon-Renderer mit House-Auswahl und House-Session-Highlight.

Der redundante Launcher-Eintrag `Karte` ist entfernt. X und Tap außerhalb schließen das Launcher-Sheet weiterhin.

## FC4 checkpoint

Smart Street und Smart House sind im normalen Produktweg umgesetzt. App-eigene Task-IDs bleiben authoritative, OSM IDs nur Provenance. Workbench-/Mock-Daten sind kein normaler Produktweg.

Persistierte Houses laufen über `vf-houses` und feste MapLibre-Layer.

Offene FC4 Quality Gates:
- reale Android-Chromium-Abnahme;
- reale iPhone-Safari-Abnahme;
- Touch-Dichte;
- Dense-Mobile-Verhalten;
- endgültige Entscheidung zu `HOUSE_MIN_ZOOM`, dokumentierter Ausgangswert 15.

Cloud-Browser ohne WebGL ist kein Nachweis für eine MapLibre-Regression und ersetzt keine reale Geräteabnahme.

## FC5 Collection/Pickup checkpoint

Plan 021 `docs/plans/active/021-collection-pickup-persistence.md` bleibt aktiv.

Master hat Ansatz A festgelegt: **First-Class Collection/Pickup**.

Verbindliche Produktentscheidung:
- Collection ist status-, area-, run-, road- und pickup-seitig unabhängig von Distribution;
- Distribution-Delete verändert Collection nicht und umgekehrt;
- nur das Löschen der gesamten Campaign/Aktion darf beide Bereiche gemeinsam entfernen;
- eigenes Collection-Hauptgebiet plus frei geschnittene innere Collection Areas;
- Hauptgebiet leicht grau, innere Areas mit eigener Farbe darüber;
- temporärer Collection-only QR-Zugang ohne normalen Account;
- pro Gerät eigene revocable Collector-Identität wie `Nutzer 1`, `Nutzer 2`;
- Collection Runs/Fahrten können eine oder mehrere Areas übernehmen;
- andere Geräte können laufenden Runs beitreten;
- kein automatisches Timeout;
- manueller Leave/Release/Abbrechen-Flow und Admin force release;
- eigene Collection Road Sections mit Offen/Abgefahren/Später/Nicht befahrbar;
- Pickup Tasks mit eigener App-ID, verpflichtender Kartenposition, Titel, Adresse, Beschreibung, Status und Kommentaren;
- Pickup darf ohne Distribution House entstehen;
- eigene Address-/Geometry-Snapshots bei Übernahme aus House/OSM;
- Einzel-Pickups werden archiviert statt hart gelöscht;
- OSM-basierte Online-Adresssuche im bestehenden Sheet-Stil;
- Suche bevorzugt auf Collection-Hauptgebiet begrenzt und nach Nähe sortiert;
- One-shot Location darf Ranking unterstützen, keine GPS-Historie;
- Sonderadressen standardmäßig sichtbar, create/edit/assign standardmäßig nicht erlaubt;
- Admin/Operator kann Collection-spezifische Rechte erweitern;
- authoritative Collection-Änderungen werden einem Actor zugeordnet;
- Admin kann Beiträge eines Collectors highlighten und ausgewählte Änderungen über serverseitige compensating mutations gezielt zurücksetzen.

Pickup-Runtime, Collection Areas/Runs, QR Collector Access, Road Sections und Online-Adresssuche sind noch nicht implementiert.

Nächster empfohlener vertikaler Runtime-Slice:
`FC5.1 Collection Access, Areas und Runs`.

## Preview / D1 schema state

Dokumentierter Remote-D1-Stand bleibt nur Migration 0001 bis 0003.

Vorbereitet, aber nicht remote angewendet:
- 0004 Smart Street provenance;
- 0005 House Tasks;
- 0006 Field Groups, Credentials, Memberships und FC1 Idempotency;
- 0007 Field Sessions und minimierte Domain Events;
- 0008 durable Comments und Comment-Tombstones;
- 0009 deterministische Automation-Konfiguration.

Bekannte fehlende Schemas müssen spezifisch fail-closed behandelt werden. Keine Migration wird als Diagnosewerkzeug remote angewendet.

## Security and performance boundaries

Weiterhin verbindlich:
- Worker bleibt authoritative Authorization Boundary;
- IDs sind Selektoren, keine Credentials;
- temporäre Collection Credentials müssen high entropy und revocable sein;
- keine Secrets/Tokens in MapLibre Properties oder Domain Events;
- keine neue generische Identity-/Permission-Runtime im FC5-Slice;
- keine kontinuierliche GPS-Historie;
- MapLibre bleibt einzige Kartenengine;
- Collection Areas/Roads/Pickups werden gebatcht mit einer kleinen festen Layer-Zahl;
- keine per-feature React/SVG/Canvas-Kartenstruktur;
- bestehende M5-Queue wird wiederverwendet;
- OSM Online-Search muss aktuelle Provider-ToS, Rate Limits, Datenschutz und Kosten beachten.

## Immediate next

1. FC5.1 als echten normalen Produktflow implementieren: Collection-only QR Access -> Collector -> offene Collection Areas -> eine/mehrere Areas übernehmen -> Run -> Beitreten -> Fortschritt -> manueller Leave/Release/Admin force release.
2. Vor Runtime-Code den gewählten First-Class-Ansatz in der passenden Architekturentscheidung/Plan-Dokumentation festschreiben, falls noch kein akzeptierter ADR dafür existiert.
3. Danach FC5.2 Pickup Tasks/Sonderadressen/OSM-Suche/Kommentare und FC5.3 Road Sections/Stats/Actor-Revert vertikal liefern.
4. Reale Android-/iPhone-Prüfung für FC4 offen halten.
5. Remote-D1 unverändert lassen, bis eine ausdrücklich freigegebene Rollout-Entscheidung vorliegt.
6. PR #72 offen und Draft lassen. Nicht mergen, nicht Ready setzen, keinen neuen Branch/PR erstellen und keinen manuellen Deploy ausführen.
