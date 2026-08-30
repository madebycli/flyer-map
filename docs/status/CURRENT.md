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
- Plan 020 Smart House Runtime;
- FC5.1 Collection Access, Areas und Runs.

Aktiver Entwicklungsstack:
- Branch `plan-feature-complete-platform`;
- Draft PR #72 gegen `ui-app-launcher-sheet`;
- letzter vollständig grüner FC5.1-Head vor FC5.2-Vorbereitung: `79bd68a42d1a11bf5b79897d0f05894975f3c543`, CI #738;
- gebrochener FC5.2-Vorbereitungs-Head: `5f533fb1403263aeec35312449afd2a9abaea169`, CI #743;
- reparierter Pre-FC5.2-Code-Checkpoint vor diesem Living-Docs-Commit: `3f413791ec5063abed66eeb1a377bc48fc4c0e5d`;
- CI #754 auf exakt diesem Code-Checkpoint vollständig grün mit Test, Typecheck, Dependency Audit und Production Build;
- PR #72 offen, Draft, mergeable und nicht gemerged.

Jeder nachfolgende Dokumentations- oder Runtime-Commit verschiebt den Head. GitHub bleibt für den jeweils exakten Head und CI maßgeblich.

## Pre-FC5.2 Stabilisierung 2026-08-30

Der begonnene FC5.2-Vorbereitungsstand wurde vor weiterem Runtime-Ausbau bewusst stabilisiert. Es wurde kein weiterer FC5.2-Produktflow implementiert.

Behobene Punkte:
- `src/domain/collection.ts` verwendet im Node-/TypeScript-Testpfad den expliziten Runtime-Import `./pickup.ts`;
- der neue Pickup-Draft-Vertrag bleibt fachlich verbindlich: `title`, `address` und echte Karten-`position` sind Pflicht; `description`, optionale Collection Area und optionale Provenance bleiben getrennte Felder;
- alte `note`-/`sourceBuildingId`-Foundation-Verträge wurden nicht wieder eingeführt;
- Pickup-Draft-Validierung scheitert bei fehlenden oder manipulierten Pflichtfeldern kontrolliert statt mit einem `TypeError`;
- `src/collection/PickupPanel.tsx` bleibt eine isolierte Foundation und ist nicht in den normalen Produktgraphen verdrahtet; sie wurde nur typkonsistent gemacht und verlangt eine echte Position, ohne `[0, 0]`-Fallback;
- bestehende Pickup-Tests wurden auf den neuen Domain-Vertrag migriert;
- zusätzliche SQLite-Tests führen die vorbereitete Migration 0011 real gegen 0001 + 0010 aus und prüfen Default-Deny-Capabilities, Collection-Area-FK, Distribution-Unabhängigkeit, Campaign-Cascade, Archivierung und JSON-Array-Invarianten.

### Migration 0008 Entscheidung

`migrations/0008_comments.sql` wurde auf seinen bereits vorbereiteten FC2-Inhalt zurückgeführt. `docs/architecture/DATA.md` verbietet das Umschreiben historischer Migrationen. Pickup-Kommentare werden deshalb nicht durch nachträgliches Ändern von 0008 aktiviert.

`src/domain/commentDraft.ts` darf `pickup-task` nur als Domain-Vorbereitung gegen eine tatsächlich vorhandene Pickup-ID validieren. Der persistente `normalizeCommentTargetType()`-Boundary akzeptiert `pickup-task` weiterhin nicht. Der Worker behauptet damit keinen fertigen Pickup-Comment-Runtimevertrag. Eine spätere persistente Erweiterung muss über eine additive Forward Migration plus explizite Worker-Autorisierung erfolgen.

### Migration 0011 Entscheidung

`migrations/0011_fc5_collection_pickups.sql` bleibt eine ausschließlich vorbereitete, nicht remote angewendete Forward Migration. Korrigiert wurden:
- enge Collector-Capabilities `can_create_pickups`, `can_edit_pickups`, `can_assign_pickups`, jeweils Default `0`;
- kein ungültiges `ON DELETE SET NULL` auf dem kompositen FK `(area_id, campaign_id)`, weil `campaign_id` `NOT NULL` ist;
- ein Pickup mit Area-Bezug schützt die Area vor Hard Delete, statt Collection-/Campaign-Scope zu beschädigen;
- Campaign Delete darf Pickups weiter per Cascade entfernen;
- Distribution-Objekte besitzen bewusst keinen FK zu Pickups und können Pickups nicht löschen;
- archivierte Pickups dürfen auch bereits `collected` sein;
- Assignment-JSON muss ein gültiges JSON-Array sein.

Der OSM-/Adress-Provider ist durch diese Stabilisierung nicht festgelegt und kein Geocoder-Runtimecode wurde hinzugefügt.

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

Nicht als FC5.2-Runtime umgesetzt sind weiterhin Pickup Worker CRUD, Pickup-M5-Mutationen, normale Pickup-UI, MapLibre-Pickup-Marker, Online-Adresssuche, Pickup-Kommentare im persistenten Produktflow, Assignment UI und Pickup Stats.

## Read-/Schema-Hardening checkpoint

Bekannte vorbereitete, aber noch nicht remote angewendete Schemas müssen in der normalen UI als eigener Fehlerzustand erscheinen und dürfen nicht gleichzeitig wie echte leere Daten wirken.

Umgesetzt:
- gemeinsames kleines `resolveRemoteReadState()` für `loading`, `error`, `empty` und `data`;
- `Einsätze`, `Aktivität` und `Automationen` zeigen bei einem initialen Read-Fehler keinen falschen Empty-State mehr;
- bereits geladene Daten bleiben bei einem späteren transienten Read-Fehler sichtbar;
- Kommentare behandeln `comments_schema_unavailable` explizit als Migration-0008-Rolloutzustand;
- der Kommentar-Composer bleibt vor einem ersten erfolgreichen Read bei Schema-/Access-Fehlern fail-closed;
- Fake-/SQLite-Tests decken die vorbereiteten Schema-Gates ab.

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
- temporärer Collection-only QR-Zugang ohne normalen Account;
- pro Gerät eigene revocable Collector-Identität;
- Collection Runs/Fahrten können eine oder mehrere Areas übernehmen und weitere Geräte können beitreten;
- kein automatisches Timeout;
- eigene Collection Road Sections;
- Pickup Tasks mit eigener App-ID, verpflichtender Kartenposition, Titel, Adresse, Beschreibung und eigenem Status;
- Pickup darf ohne Distribution House entstehen;
- eigene Address-/Geometry-Snapshots bei Übernahme aus House/OSM;
- Einzel-Pickups werden archiviert statt hart gelöscht;
- OSM-basierte Online-Adresssuche soll den bestehenden Sheet-Stil nutzen;
- One-shot Location darf Ranking unterstützen, keine GPS-Historie;
- Sonderadressen standardmäßig sichtbar, create/edit/assign standardmäßig nicht erlaubt;
- Worker bleibt authoritative Authorization Boundary.

FC5.1 ist im normalen Produktweg implementiert. FC5.2 besitzt nach der Stabilisierung nur vorbereitete Domain-/Schema-Bausteine und ist ausdrücklich noch nicht als Runtime umgesetzt.

## Preview / D1 schema state

Dokumentierter Remote-D1-Stand bleibt nur Migration 0001 bis 0003.

Vorbereitet, aber nicht remote angewendet:
- 0004 Smart Street provenance;
- 0005 House Tasks;
- 0006 Field Groups, Credentials, Memberships und FC1 Idempotency;
- 0007 Field Sessions und minimierte Domain Events;
- 0008 durable Comments und Comment-Tombstones, unverändert ohne Pickup-Target;
- 0009 deterministische Automation-Konfiguration;
- 0010 Collection Access, Main/Child Areas, Runs, Collector-Sessions und Claim-Historie;
- 0011 vorbereitete Pickup-Tabellen/Collector-Capabilities, noch ohne Pickup-Runtime.

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
- bestehende M5-Queue wird wiederverwendet;
- OSM Online-Search muss aktuelle Provider-ToS, Rate Limits, Datenschutz und Kosten beachten.

## Immediate next

1. Vor weiterem FC5.2-Runtimecode den jeweils aktuellen GitHub-Head und CI erneut verifizieren.
2. Erst danach FC5.2 als echten vertikalen Produktflow planen/implementieren: Pickup-M5-Persistenz, Worker-Autorisierung, normale UI, MapLibre, Suche und additive Pickup-Comments.
3. Provider-Auswahl für OSM-basierte Online-Adresssuche vor Runtime-Verdrahtung gegen aktuelle ToS, Rate Limits, Datenschutz, Attribution und Kosten verifizieren.
4. Reale Android-/iPhone-Prüfung für FC4 offen halten; `HOUSE_MIN_ZOOM = 15` bleibt Ausgangswert.
5. Remote-D1 unverändert lassen, bis eine ausdrücklich freigegebene Rollout-Entscheidung vorliegt.
6. PR #72 offen und Draft lassen. Nicht mergen, nicht Ready setzen, keinen neuen Branch/PR erstellen und keinen manuellen Deploy ausführen.
