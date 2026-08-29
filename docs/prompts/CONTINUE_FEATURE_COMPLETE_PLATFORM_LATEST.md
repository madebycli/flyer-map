# Prompt: Continue Feature Complete Platform

Dieser Living Handoff gehört zur Plan-017-Linie. Repository, aktueller Branch-Head, PR und CI bleiben Source of Truth.

## Start für einen neuen Chat

```text
Du arbeitest weiter am GitHub-Projekt `madebycli/flyer-map`.

Lies zuerst vollständig:
1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`

Nutze danach den Context-Graph. Für den aktuellen nächsten Slice folge `prompt-latest-feature-complete` zu `prompt-house-polygon-renderer` und `plan-house-polygon-renderer`, anschließend zu Map, UX, Collaboration, Quality und ADR-0013. Lies für die Renderer-Grenze zusätzlich ADR-0010.

Prüfe vor jeder Änderung den lokalen Working Tree. Zwei Kontextdateien waren im vorherigen Workspace lokal uncommitted und können nach dem Remote-Doku-Commit noch als lokale Änderungen vorhanden sein. Nichts blind resetten oder verwerfen. Vergleiche lokale Varianten zuerst mit dem aktuellen Remote-Branch.

Verifiziere danach Branch `plan-feature-complete-platform`, PR #72, Base/Head/Draft/Mergeability, exakten aktuellen Head und CI auf genau diesem Head gegen GitHub.

Der House-Polygon-Renderer-Slice ist auf dem verifizierten Runtime-Head `a6753b572e095a4f48f9caabdf50cf4b5c89a7ed` umgesetzt. Prüfe den vorhandenen Runtime-Code und die verbleibende manuelle Android-/iPhone-Browserabnahme, bevor du weitere Änderungen beginnst. Wiederhole den Renderer-Slice nicht ohne konkreten Repository-Befund.

Keine Migration remote anwenden, nicht explizit deployen, nicht mergen und keinen neuen Branch oder PR erstellen.
```

## Verifizierter Runtime-Checkpoint

- Branch: `plan-feature-complete-platform`;
- PR #72: `FC0-FC2: Platform, Live Field Groups and Field Sessions`;
- Base: `ui-app-launcher-sheet`;
- Base-SHA: `48843793184650bd96039f0e3b073f60aebb068a`;
- Head-Branch: `plan-feature-complete-platform`;
- letzter verifizierter Runtime-Head: `a6753b572e095a4f48f9caabdf50cf4b5c89a7ed`;
- CI #703 auf genau diesem Head: erfolgreich mit Tests, TypeScript, Dependency Audit und Production Build;
- PR #72 war offen, Draft und mergeable.

Ein späterer Dokumentationscommit kann den Branch-Head weiter verschieben. Nach jedem Commit muss GitHub erneut geprüft werden. Ein älterer grüner Runtime-Head ist nur für den Code-Nachweis maßgeblich, nicht automatisch für den finalen Branch-Head.

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

House-Domain, House-Persistenz und die eigene persistierte House-Polygon-Source sind vorhanden. Der normale MapLibre-Renderer nutzt `vf-houses` mit festen Layern, House-Auswahl über den bestehenden App-/Sheet-Pfad und echte House-IDs im Session-Highlight.

## Aktueller Plan

Übergeordnete Delivery-Linie:
- `docs/plans/active/017-feature-complete-platform.md`

Aktueller konkreter Slice:
- `docs/plans/active/018-house-polygon-renderer.md`

Planner-/Codex-Handoff:
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

Wenn aktueller Code oder accepted ADRs diesem Plan widersprechen, Repository und accepted ADRs gewinnen. Dann Plan 018 aktualisieren, nicht die Realität passend machen.

## D1 / Rollout

Dokumentierter Remote-D1-Stand bleibt nur 0001 bis 0003.

Vorbereitet, aber nicht remote angewendet:
- 0004 Smart Street provenance;
- 0005 House Tasks;
- 0006 Field Groups/Credentials/Memberships;
- 0007 Field Sessions/Domain Events;
- 0008 Comments;
- 0009 Automation-Konfiguration.

Der Renderer-Slice benötigt keine neue Migration.

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
- Comment- und Automation-Writes bleiben weiterhin online-only, solange keine sichere Wiederverwendung des vorhandenen M5-Pfads ohne zweite Sync-Architektur umgesetzt ist.
- Organization-/Identity-/Capability-Runtime bleibt durch die jeweiligen vorgeschlagenen ADRs blockiert.

## Verbleibende Quality Gates

- relevante Renderer-/House-/Session-/Security-Regressionstests: CI #703 grün;
- Dense-House-Conversion bis 20.000 Features: lokal grün;
- mobile Hit-Test-Prüfung auf Android Chromium und iPhone Safari: noch offen;
- TypeScript, Dependency Audit und Production Build: CI #703 grün;
- finaler GitHub-CI-Lauf auf exakt dem finalen Dokumentations-Head: nach dem nächsten Commit erneut prüfen.

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

## Verpflichtung für den nächsten Handoff

Nach einer späteren Runtime-Umsetzung diese Datei erneut aktualisieren mit:
- exaktem Branch und letztem Runtime-Head;
- PR #72 Base/Head/Draft/Mergeability;
- finalem CI-Lauf auf genau diesem Head;
- House-Renderer- und Session-House-Highlight-Status;
- aktuellem Migration-/Remote-D1-Status;
- offenen Risiken und nächstem konkreten Slice.
