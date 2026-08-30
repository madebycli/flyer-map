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

Aktiver Entwicklungsstack nach dem Read-/Schema-Hardening-Checkpoint:
- Branch `plan-feature-complete-platform`;
- Draft PR #72 gegen `ui-app-launcher-sheet`;
- verifizierter FC5.1-Code-Head `3a5c46aafa47e866b8441a380f34918eda1f0cee`;
- CI #729 auf exakt diesem FC5.1-Code-Head vollständig grün mit Test, Typecheck, Dependency Audit und Production Build;
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
- persistierter House-Polygon-Renderer mit House-Auswahl und House-Session-Highlight;
- FC5.1 Collection-only QR Access mit eigener revocable Collector-Identität pro Gerät;
- eigene Collection Main Area, Child Areas und Collection Runs mit Mehrgeräte-Join, manueller Leave/Release/Cancel-Logik und Admin force release;
- additive Collection-D1-Persistenz, Worker-Autorisierung und MapLibre-Layer über den bestehenden M5-Mutationspfad.

Der redundante Launcher-Eintrag `Karte` ist entfernt. X und Tap außerhalb schließen das Launcher-Sheet weiterhin.

## Read-/Schema-Hardening checkpoint

Bekannte vorbereitete, aber noch nicht remote angewendete Schemas müssen in der normalen UI als eigener Fehlerzustand erscheinen und dürfen nicht gleichzeitig wie echte leere Daten wirken.

Der aktuelle Hardening-Slice setzt dafür um:
- gemeinsames kleines `resolveRemoteReadState()` für `loading`, `error`, `empty` und `data`;
- `Einsätze`, `Aktivität` und `Automationen` zeigen bei einem initialen Read-Fehler keinen falschen Empty-State mehr;
- bereits geladene Daten bleiben bei einem späteren transienten Read-Fehler sichtbar;
- Kommentare behandeln `comments_schema_unavailable` explizit als Migration-0008-Rolloutzustand;
- der Kommentar-Composer bleibt vor einem ersten erfolgreichen Read bei Schema-/Access-Fehlern fail-closed;
- Migration 0008 wird mit Fake-D1 ohne Comment-/Event-Schema als spezifisches 503 simuliert;
- bestehende Fake-/SQLite-Tests decken 0006, 0007 und 0009 bereits spezifisch ab;
- bestehende Smart-Street-/House-Persistenztests decken 0004/0005 als `schema_migration_required` ohne Revision-Claim ab.

CI #729 bestätigt auf dem FC5.1-Code-Head Tests, TypeScript, Dependency Audit und Production Build. Keine Migration wurde remote angewendet und kein manueller Deploy ausgeführt.

Der Context Graph benötigt für diesen Slice keine neue Topologie: `plan-smart-house-runtime`, `collaboration`, `data`, `offline-sync`, `security`, `ux` und `quality` decken Preview-/Schema-Gate-Hardening bereits ab.

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

FC5.1 Collection Access, Areas und Runs ist im normalen Produktweg implementiert und auf dem aktuellen Code-Head verifiziert. Der Slice umfasst Collection-only QR Access, pro Gerät getrennte Collector-Sessions, Main/Child Areas, Mehrfach-Claims, laufende Runs, Join, Leave/Release/Cancel und Admin force release.

Offen bleiben FC5.2 Pickup Tasks, Sonderadressen, Online-Adresssuche und Kommentare sowie FC5.3 Road Sections, Stats, Actor Attribution und gezieltes Revert.

Nächster empfohlener vertikaler Runtime-Slice:
`FC5.2 Pickup Tasks, Sonderadressen und Kommentare`.

## Preview / D1 schema state

Dokumentierter Remote-D1-Stand bleibt nur Migration 0001 bis 0003.

Vorbereitet, aber nicht remote angewendet:
- 0004 Smart Street provenance;
- 0005 House Tasks;
- 0006 Field Groups, Credentials, Memberships und FC1 Idempotency;
- 0007 Field Sessions und minimierte Domain Events;
- 0008 durable Comments und Comment-Tombstones;
- 0009 deterministische Automation-Konfiguration;
- 0010 Collection Access, Main/Child Areas, Runs, Collector-Sessions und Claim-Historie.

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

1. FC5.2 Pickup Tasks, Sonderadressen, Online-Adresssuche und Kommentare als nächsten echten Collection-Slice liefern.
2. Danach FC5.3 Road Sections, getrennte Stats, Actor Attribution und gezieltes serverseitiges Revert vertikal umsetzen.
3. Reale Android-/iPhone-Prüfung für FC4 offen halten; `HOUSE_MIN_ZOOM = 15` bleibt der dokumentierte Ausgangswert.
4. Remote-D1 unverändert lassen, bis eine ausdrücklich freigegebene Rollout-Entscheidung vorliegt. Migration 0010 ist nur vorbereitet.
5. PR #72 offen und Draft lassen. Nicht mergen, nicht Ready setzen, keinen neuen Branch/PR erstellen und keinen manuellen Deploy ausführen.
