# Prompt: Continue Feature Complete Platform

Dieser Living Handoff gehört zur Plan-017-Linie. Repository, aktueller Branch-Head, PR und CI bleiben Source of Truth.

## Start für einen neuen Chat

```text
Du arbeitest weiter am GitHub-Projekt `madebycli/flyer-map`.

Lies zuerst vollständig:
1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`

Nutze danach den Context-Graph. Für den aktuellen Stand folge `prompt-latest-feature-complete` zu Plan 017 und den abgeschlossenen FC4-Slices 018, 019 und 020. Lade für Karten-/Datenänderungen die verknüpften ADRs, Architecture-Dokumente und Quality-Gates. Für FC5 Collection/Pickup folge plan-collection-pickup-persistence und lade nur die dort verknüpften Daten-, Sync-, Map-, Security-, Collaboration-, Live-Teams- und Quality-Knoten.

Prüfe vor jeder Änderung den lokalen Working Tree und vergleiche ihn mit dem aktuellen Remote-Branch. Nichts blind resetten, verwerfen oder überschreiben.

Verifiziere danach Branch `plan-feature-complete-platform`, PR #72, Base/Head/Draft/Mergeability, den exakten aktuellen Head und CI auf genau diesem Head gegen GitHub.

Keine Migration remote anwenden, nicht explizit deployen, nicht mergen und keinen neuen Branch oder PR erstellen.
```

## Verifizierter aktueller Stand

- Branch: `plan-feature-complete-platform`;
- PR #72: `FC0-FC2: Platform, Live Field Groups and Field Sessions`;
- Base: `ui-app-launcher-sheet`;
- zuletzt vor Plan 021 verifizierter Branch-Head: `7c38830cbf94129ff4cb3e1a97ab73fd9b5a605c`;
- CI #712 war auf genau diesem Head vollständig grün mit Tests, TypeScript, Dependency Audit und Production Build;
- PR #72 war offen, Draft und mergeable.

Der nächste Dokumentationscommit verschiebt den Branch-Head. Deshalb vor jeder Fortsetzung GitHub erneut prüfen.

## Implementierter Feature-Stand

Umgesetzt:

- FC0 PlatformShell/App-Bridge, aktiver Teamkontext und echtes Team-/Einsatz-Modul;
- Live Field Groups, Field Sessions, Comments, bounded Activity, Stats und deterministische Automation;
- redundante Launcher-Kachel `Karte` entfernt. X und Tap außerhalb des Sheets schließen das Menü weiterhin;
- Plan 018 House Polygon Renderer mit gebatchter `vf-houses`-Source, House-Auswahl und House-only Session Highlight;
- Plan 019 Smart Street Runtime mit echten Kandidaten aus dem vorbereiteten validierten OSM-Paket, Snap, Start/Ende, Waypoints, Ambiguitätsauflösung und M5-Persistenz;
- Plan 020 Smart House Runtime mit echten Gebäude-Candidates aus demselben vorbereiteten Paket, MapLibre-Auswahl, Review, bounded Batch-Persistenz und explizitem Street-Parent.

Smart Street und Smart House verwenden App-eigene `task_<uuid>`-IDs. OSM-Way-IDs bleiben Provenance. Workbench-/Mock-Daten aus `M6SelectionPreview.tsx` sind kein normaler Produktweg.

## Smart-House-Runtime

Der normale Flow ist:

`Area oder bestehender Street Task -> Smart House Mode -> echte Building-Candidates -> MapLibre-Tap/Mehrfachauswahl -> Review -> house.create-batch -> bestehende M5-Queue -> vf-houses`

Rahmen:

- Candidate-Daten stammen nur aus dem vorbereiteten validierten `OfflineMapPackage`;
- die Candidate-Karte nutzt eine gebatchte Source und wenige feste MapLibre-Layer;
- Hit-Test fragt nur den Candidate-Fill-Layer ab und löst Mehrfachtreffer ausdrücklich;
- ausgewählte Houses werden vor dem Speichern reviewt;
- pro Bestätigung sind maximal 50 Houses erlaubt;
- ein Street-Parent wird nur aus dem expliziten Street-Einstieg gesetzt;
- Worker bleibt die Autorisierungsgrenze;
- fehlende Migration 0005 blockiert House-Writes fail-closed;
- fehlende bekannte Field-Group-0006-Spalten ergeben den spezifischen Schema-Gate-State.

## Plan-/Context-Graph

Übergeordnete Delivery-Linie:
- `docs/plans/active/017-feature-complete-platform.md`

Abgeschlossene Slices:
- `docs/plans/completed/018-house-polygon-renderer.md`;
- `docs/plans/completed/019-smart-street-runtime.md`;
- `docs/plans/completed/020-smart-house-runtime.md`.

Plan 021 `docs/plans/active/021-collection-pickup-persistence.md` ist als aktiver Architektur- und Dokumentationsplan angelegt. Er behandelt FC5 Collection/Pickup und implementiert in diesem Turn keine Runtime. Die Architekturentscheidung A oder B bleibt durch Master offen. Pickup-Foundation, Collection-Field-Sessions und Collection-Field-Groups sind nicht mit einer feature-completen Pickup-Persistenz gleichzusetzen.

## Renderer und Geräteabnahme

Plan 018 bleibt ein implementierter Runtime-Checkpoint:
- `vf-houses` verwendet feste Layer und App-House-IDs;
- House-Hit-Test und House-Session-Highlight sind produktiv integriert;
- `HOUSE_MIN_ZOOM = 15` bleibt der dokumentierte Ausgangswert;
- reale Android-Chromium-/iPhone-Safari-Abnahme, Touch-Dichte und Dense-Mobile-Verhalten sind offen.

## D1 / Rollout

Dokumentierter Remote-D1-Stand bleibt nur 0001 bis 0003.

Vorbereitet, aber nicht remote angewendet:
- 0004 Smart Street provenance;
- 0005 House Tasks;
- 0006 Field Groups/Credentials/Memberships;
- 0007 Field Sessions/Domain Events;
- 0008 Comments;
- 0009 Automation-Konfiguration.

Die Cloudflare-Git-Integration darf nach Branch-Commits automatisch Preview-Kommentare aktualisieren. Das ist kein bewusst ausgelöster manueller Deploy und kein Nachweis für remote angewendete Migrationen.

## Quality-Gates

- lokale direkte Node-Test-Suite zuletzt: 466/466 grün;
- CI #711 auf dem verifizierten Runtime-Head: Test, TypeScript, Dependency Audit und Production Build grün;
- reale Geräteprüfung für Android Chromium und iPhone Safari steht aus;
- keine finale Dense-Mobile- oder `HOUSE_MIN_ZOOM`-Aussage ohne echte Geräte.

## Nicht tun

- nichts mergen;
- PR #72 nicht Ready for Review setzen;
- keine D1-Migration remote anwenden;
- keinen expliziten `wrangler deploy` ausführen;
- keinen neuen Branch oder PR erstellen;
- keine Preview-/Mock-Gebäudedaten in den normalen Produktgraphen übernehmen;
- keine neue Map-Engine, Renderer-Registry, OSM-Datenbank oder Sync-Queue erfinden;
- keine automatische Parent-Zuordnung nur über `addr:street`;
- keine PWA, keinen Service Worker und kein Background Sync;
- keine GPS-Historie;
- keine neue Permission-/Identity-Runtime;
- kein AI-/LLM-Routing.

## Verpflichtung für den nächsten Handoff

Nach dem nächsten Slice diese Datei erneut aktualisieren mit:
- exaktem Branch und aktuellem GitHub-Head;
- PR #72 Base/Head/Draft/Mergeability;
- CI auf genau diesem Head;
- Plan-018-Renderer- und Session-Highlight-Status;
- Smart-Street- und Smart-House-Status;
- aktuellem Migration-/Remote-D1-Status;
- offenen Geräte-/Performance-Risiken, dem aktiven Plan 021 und der ausstehenden Architekturentscheidung.
