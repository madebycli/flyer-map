# Prompt: Continue Feature Complete Platform

Dieser Living Handoff gehört zur Plan-017-Linie. Repository, aktueller Branch-Head, PR und CI bleiben Source of Truth.

## Start für einen neuen Chat

```text
Du arbeitest weiter am GitHub-Projekt `madebycli/flyer-map`.

Lies zuerst vollständig:
1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`

Nutze danach den Context-Graph. Für den aktuellen Stand folge `prompt-latest-feature-complete` zu `plan-smart-street-runtime` und anschließend zu Offline Map, Map, UX, Offline Sync, Collaboration, Quality, ADR-0012 und ADR-0013. Für den abgeschlossenen House-Renderer-Checkpoint kann zusätzlich die historische Plan-018-Dokumentation geladen werden.

Prüfe vor jeder Änderung den lokalen Working Tree und vergleiche ihn mit dem aktuellen Remote-Branch. Nichts blind resetten, verwerfen oder überschreiben.

Verifiziere danach Branch `plan-feature-complete-platform`, PR #72, Base/Head/Draft/Mergeability, exakten aktuellen Head und CI auf genau diesem Head gegen GitHub.

Plan 018, der House-Polygon-Renderer, ist im normalen MapLibre-Produktweg umgesetzt und nach `docs/plans/completed/018-house-polygon-renderer.md` verschoben. Prüfe den vorhandenen Runtime-Code und die verbleibende manuelle Android-/iPhone-Browserabnahme, bevor du weitere Änderungen beginnst. Wiederhole den Renderer-Slice nicht ohne konkreten Repository-Befund.

Plan 019, `docs/plans/completed/019-smart-street-runtime.md`, integriert die vorbereiteten echten OSM-Kandidaten in den normalen Area-Flow. Prüfe vor einer Fortsetzung, ob der nächste Engpass tatsächlich Smart House Candidate Selection ist.

Keine Migration remote anwenden, nicht explizit deployen, nicht mergen und keinen neuen Branch oder PR erstellen.
```

## Verifizierter Ausgangs-Checkpoint vor Plan 019

- Branch: `plan-feature-complete-platform`;
- PR #72: `FC0-FC2: Platform, Live Field Groups and Field Sessions`;
- Base: `ui-app-launcher-sheet`;
- Base-SHA: `48843793184650bd96039f0e3b073f60aebb068a`;
- Head-Branch: `plan-feature-complete-platform`;
- letzter vor Plan 019 verifizierter Runtime-Head: `9477e1d15aada83db145cd9dd27b10a152cd13f7`;
- CI #704 auf genau diesem Head: erfolgreich mit Tests, TypeScript, Dependency Audit und Production Build;
- PR #72 war offen, Draft und mergeable.

Plan 019 und der Launcher-Cleanup verschieben den Branch-Head. Nach jedem Commit müssen exakter GitHub-Head, PR #72, Draft-/Mergeability-Status und CI auf genau diesem Head erneut geprüft werden. Ein älterer grüner Runtime-Head ist nicht automatisch ein Nachweis für den finalen Branch-Head.

## Verifizierter Plan-019-Runtime-Stand

- Runtime-Head: `6a21f5534c5854f9ff606ed34ae39fd31793420b`;
- CI #705 auf genau diesem Head: erfolgreich mit Tests, TypeScript, Dependency Audit und Production Build;
- PR #72: offen, Draft und mergeable.

Die nachfolgende Dokumentationsaktualisierung kann den Branch-Head als reinen
Dokumentationscommit weiter verschieben. Für die Runtime-Bewertung bleibt der oben
genannte Commit maßgeblich; den exakten aktuellen GitHub-Head und dessen neuesten CI-Lauf
immer erneut prüfen.

## Aktueller Feature-Stand

Auf PR #72 umgesetzt:
- FC0 PlatformShell/App-Bridge und aktiver Teamkontext;
- Team Hub;
- Live Field Groups inklusive Credential-/Rate-Limit-/Membership-Grenzen;
- Field Sessions, Session-Historie, Task-Refs und Street-Session-Highlight;
- durable Comments für Campaign, Area, Street Task und persistierte House Tasks;
- bounded Activity-Projektion aus normalisierten `domain_events`;
- deterministische feste Automation `complete-parent-street-when-all-houses-complete` gemäß ADR-0019;
- serverseitige Stats-Projektion und normales Launcher-Stats-Modul.

Der redundante Launcher-Eintrag „Karte“ ist entfernt. X und Tap außerhalb des Sheets schließen das Menü weiterhin.

Der normale FC4-Smart-Street-Weg ist umgesetzt:
- ein berechtigter Nutzer startet ihn aus dem Area Sheet;
- `smartCandidatesForArea()` verwendet nur das vorhandene validierte Offline-OSM-Paket;
- MapLibre rendert echte Kandidaten, Auswahl, Vorschau und Start/Ende/Zwischenpunkte über feste Sources/Layer;
- Snap-, Mehrdeutigkeits-, Routen- und Waypoint-Logik bleibt in der Domain;
- die Bestätigung erzeugt eine App-eigene `task_<uuid>`-ID und speichert OSM-Ways nur als Provenance über den M5-Pfad;
- manuelles Zeichnen bleibt als Fallback erhalten;
- Preview-/Mock-Daten aus `M6SelectionPreview.tsx` sind nicht im Produktionsgraphen.

House-Domain, House-Persistenz und die eigene persistierte House-Polygon-Source sind vorhanden. Der normale MapLibre-Renderer nutzt `vf-houses` mit festen Layern, House-Auswahl über den bestehenden App-/Sheet-Pfad und echte House-IDs im Session-Highlight.

## Aktueller Plan

Übergeordnete Delivery-Linie:
- `docs/plans/active/017-feature-complete-platform.md`

Abgeschlossene konkrete Slices:
- `docs/plans/completed/018-house-polygon-renderer.md`
- `docs/plans/completed/019-smart-street-runtime.md`

Nächster konkreter FC4-Slice:
- Smart House Candidate Selection im normalen Area-/Street-Kontext.

Historischer Planungs-Handoff:
- `docs/prompts/CODEX_PLAN_HOUSE_POLYGON_RENDERER.md`

## Renderer-Richtung

Plan 018 ist im Runtime-Slice umgesetzt:
- eigene gebatchte `vf-houses`-GeoJSON-Source;
- wenige feste MapLibre-Layer;
- keine per-frame React-Projektion gespeicherter Houses;
- stabile App-House-ID, OSM nur Provenance;
- `vf-streets` bleibt Street-only;
- House-Hit-Test über `queryRenderedFeatures`;
- Hit-Test zunächst Street, House, Area;
- bestehendes House-Sheet wiederverwenden;
- House Session Highlight mit echten `houseTaskIds`, inklusive House-only Sessions;
- verbleibend sind manuelle Mobile-/Dense-House-Abnahme und die langfristige `minzoom`-Entscheidung.

Plan 019 ist im Runtime-Slice umgesetzt:
- vorbereitete Offline-OSM-Straßen werden im normalen Area-Flow zu echten Kandidaten;
- MapLibre übernimmt den sichtbaren Auswahl- und Vorschaupfad;
- Start/Ende, explizite Ambiguitätsauflösung, alternative Routen und Zwischenpunkte werden unterstützt;
- Persistenz nutzt `DistributionTask`, App-ID, OSM-Provenance und den bestehenden M5-Mutationspfad;
- Migration 0004 bleibt vorbereitet und nicht remote angewendet.

Wenn aktueller Code oder accepted ADRs diesem Handoff widersprechen, gewinnen Repository und accepted ADRs. Dann den betroffenen aktuellen Plan aktualisieren, nicht die Realität passend machen.

## D1 / Rollout

Dokumentierter Remote-D1-Stand bleibt nur 0001 bis 0003.

Vorbereitet, aber nicht remote angewendet:
- 0004 Smart Street provenance;
- 0005 House Tasks;
- 0006 Field Groups/Credentials/Memberships;
- 0007 Field Sessions/Domain Events;
- 0008 Comments;
- 0009 Automation-Konfiguration.

Der House-Renderer benötigt keine neue Migration. Smart-Street-Source-Writes benötigen
die vorbereitete 0004-Spalte, dürfen diese aber in diesem Arbeitsstand nicht remote
anwenden.

Keine Migration remote anwenden und keinen manuellen `wrangler deploy` ausführen.

Die bestehende Cloudflare Git-Integration kann nach Branch-Commits automatisch Preview-Kommentare aktualisieren. Das ist kein bewusst ausgelöster Rollout und kein Beweis für remote angewendete D1-Migrationen.

## Security / Privacy

- Worker bleibt authoritative Authorization Boundary.
- IDs sind Selektoren, keine Credentials.
- Keine neue Permission-/Identity-Runtime für den House-Renderer.
- Keine Secrets oder Join-/Session-Credentials in Renderer-Daten.
- Keine GPS-Historie.
- Session-Highlight verwendet nur bereits autorisierte Task-Refs und aktuelle persistierte Geometrie.

## Bekannte offene Punkte

- House-`minzoom` muss anhand eines Dense-Mobile-Tests entschieden werden.
- House-Status-Stile müssen neben Farbe einen zweiten visuellen Kanal besitzen.
- Spätere House-Mode-Hit-Test-Priorität ist nicht Teil des Renderer-Cores.
- Smart House Candidate Selection im normalen Produktweg fehlt noch.
- Comment- und Automation-Writes bleiben weiterhin online-only, solange keine sichere Wiederverwendung des vorhandenen M5-Pfads ohne zweite Sync-Architektur umgesetzt ist.
- Organization-/Identity-/Capability-Runtime bleibt durch die jeweiligen vorgeschlagenen ADRs blockiert.

## Verbleibende Quality Gates

- relevante Renderer-/House-/Session-/Security-Regressionstests und Smart-Street-Runtime-Guards: lokal seriell 451/451 grün;
- Dense-House-Conversion bis 20.000 Features: lokal grün;
- mobile Hit-Test-Prüfung auf Android Chromium und iPhone Safari: noch offen;
- TypeScript, Dependency Audit, Production Build und finaler `check`-Lauf: CI #705 auf dem verifizierten Plan-019-Runtime-Head grün;
- reale Android-/iPhone- und Touch-Dichteabnahme: weiterhin offen.

## Nicht tun

- nichts mergen;
- PR #72 nicht Ready for Review setzen;
- keine D1-Migration remote anwenden;
- keinen expliziten Deploy ausführen;
- keinen neuen Branch oder PR erstellen;
- keine neue Organization-/Account-Identity erfinden;
- keine Capability-Runtime vor akzeptierter ADR;
- keine PWA, keinen Service Worker und kein Background Sync;
- keine GPS-Historie;
- keine allgemeine Rules Engine oder AI-Automation;
- keine House-Renderer-Struktur mit einem Layer oder DOM-Node pro House.
- keine Preview-/Mock-Straßen im normalen Produktgraphen;
- keine Remote-Migration für 0004 oder spätere Migrationen.

## Verpflichtung für den nächsten Handoff

Nach einem weiteren Runtime-Slice diese Datei erneut aktualisieren mit:
- exaktem Branch und letztem Runtime-Head;
- PR #72 Base/Head/Draft/Mergeability;
- finalem CI-Lauf auf genau diesem Head;
- House-Renderer- und Session-House-Highlight-Status;
- Smart-Street- und Smart-House-Status im normalen Produktweg;
- aktuellem Migration-/Remote-D1-Status;
- offenen Risiken und nächstem konkreten Slice.
