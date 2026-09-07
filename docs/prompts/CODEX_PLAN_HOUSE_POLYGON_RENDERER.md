# Prompt: Codex Plan für House Polygon Renderer

Diesen Prompt für einen neuen ChatGPT-/Codex-Planer-Chat verwenden.

```text
Du übernimmst das GitHub-Projekt `madebycli/flyer-map` im aktuellen Workspace.

ZIEL DIESES CHATS

Verifiziere und finalisiere den nächsten sicheren Implementierungsplan für das echte House-Polygon-Rendering im normalen MapLibre-Renderer. Arbeite als Planner. Implementiere in diesem Chat noch keinen Runtime-Code, außer der User beauftragt das anschließend ausdrücklich.

SOURCE OF TRUTH

Repository, aktueller Working Tree, GitHub-Branch, PR #72, exakter Head, CI und accepted ADRs sind Source of Truth. Verlasse dich nicht auf Chat-Erinnerungen oder alte Heads.

WICHTIG ZUM LOKALEN WORKSPACE

Prüfe als Erstes `git status --short --branch` und den lokalen Diff.

Im vorherigen Chat gab es zwei lokale uncommitted Kontextdateien:
- `docs/context-map.yaml`;
- `docs/prompts/CONTINUE_FEATURE_COMPLETE_PLATFORM_LATEST.md`.

Diese Inhalte wurden anschließend als weiterentwickelte Planungsdokumentation auf den bestehenden Remote-Branch geschrieben. Der lokale Workspace kann deshalb noch alte uncommitted Varianten enthalten oder hinter dem Remote-Branch liegen.

Niemals blind resetten, verwerfen oder überschreiben. Vergleiche lokale Änderungen zuerst mit dem aktuellen Remote-Stand. Erhalte jeden lokalen Inhalt, der nicht bereits im Repository enthalten ist. Fast-forward/rebase nur wenn der Working Tree dadurch sicher bleibt.

BEVOR DU PLANST

1. Lies `AGENTS.md` vollständig.
2. Lies `docs/status/CURRENT.md` vollständig.
3. Lies `docs/context-map.yaml` vollständig.
4. Nutze ab dort den Context-Graph.
5. Lade `prompt-house-polygon-renderer` und `plan-house-polygon-renderer`.
6. Folge deren Kanten mindestens zu:
   - `plan-feature-complete-platform`;
   - `map`;
   - `ux`;
   - `collaboration`;
   - `quality`;
   - `adr-smart-task-identity`.
7. Lies zusätzlich ADR-0010 zur MapLibre-/SVG-Renderer-Grenze.
8. Prüfe den echten Code in mindestens:
   - `src/map/MapView.tsx`;
   - `src/App.tsx`;
   - `src/domain/campaign.ts`;
   - `src/platform/sessionMapHighlight.tsx`;
   - `src/platform/PlatformShell.tsx`;
   - `src/collaboration/FieldSessionsHub.tsx`;
   - relevante Renderer-, House-, Field-Session- und Snapshot-Tests.
9. Prüfe danach GitHub:
   - Branch `plan-feature-complete-platform`;
   - PR #72 Base/Head/Draft/Mergeability;
   - gestapelten Base-PR #71 nur soweit für den Slice nötig;
   - exakten aktuellen Head;
   - CI-Lauf auf genau diesem Head.

LETZTER VERIFIZIERTER CHECKPOINT VOR DEM PLANUNGS-DOKU-COMMIT

- Branch: `plan-feature-complete-platform`;
- PR #72 Base: `ui-app-launcher-sheet`;
- PR #72 Head: `plan-feature-complete-platform`;
- Head: `2b90db509666d853dd20ac22a497536c88292522`;
- CI #701: grün mit Tests, TypeScript, Dependency Audit und Production Build;
- PR #72: offen, Draft und mergeable.

Dieser Head ist nur ein Startcheckpoint. Nach dem Planungs-Doku-Commit ist ein neuerer Head zu erwarten. Wenn GitHub abweicht, gilt ausschließlich der neuere GitHub-Stand.

AKTUELLER PRODUKTSTAND

Auf PR #72 sind bereits echte Runtime-Slices für PlatformShell, Team Hub, Live Field Groups, Field Sessions, Comments, Activity, deterministische Automations und Stats vorhanden.

House-Domain und House-Persistenz existieren bereits. `CampaignSnapshot.houseTasks` enthält persistierte `HouseTask`-Polygone. `App.tsx` besitzt House-Auswahl und House-Sheet. Der normale `MapView` rendert aber aktuell nur Areas und Streets als gespeicherte Application-Geometrie.

Der Field-Session-Task-Read liefert bereits `street-task` und `house-task`. Der aktuelle Session-Highlight-Context transportiert Street-IDs, verwirft House-IDs aber noch zu `houseTaskCount`.

ARCHITEKTURRICHTUNG, DIE DU VERIFIZIEREN SOLLST

Bevorzugter sicherer Ansatz:
- eigene gebatchte GeoJSON-Source `vf-houses`;
- wenige feste MapLibre-Layer;
- stabile App-House-ID als Renderer-Identity;
- `GeoJSONSource.setData()` nur bei echten Domain-Datenänderungen;
- keine React-/SVG-/Canvas-Projektion persistierter Houses bei Pan/Zoom/Rotate;
- `vf-streets` bleibt Street-only;
- Browse-Hit-Test zunächst Street, House, Area;
- bestehendes `selectHouseTask()` und House-Sheet wiederverwenden;
- House Session Highlight erst nach stabilem Renderer-Core auf echte `houseTaskIds` erweitern.

Prüfe diesen Ansatz gegen echten Code und accepted Architektur. Wenn er falsch oder unnötig riskant ist, dokumentiere exakt warum und schlage die kleinste bessere Alternative vor. Erfinde keine große Renderer-Abstraktion ohne nachgewiesenen Bedarf.

DEINE AUSGABE

Liefere einen konkreten Codex-Implementierungsplan, der mindestens enthält:

1. Verifizierter aktueller Workspace-/Branch-/PR-/Head-/CI-Stand.
2. Relevante Context-Graph-Knoten und warum sie benötigt werden.
3. Bestätigung oder Korrektur der Architektur.
4. Exakte Dateien, die geändert oder neu erstellt werden sollen.
5. Reihenfolge der Implementierung in kleinen Checkpoints.
6. Teststrategie pro Checkpoint.
7. Performance-Akzeptanz für viele Houses.
8. Mobile Hit-Test-/UX-Risiken.
9. Security-/Privacy-Prüfung.
10. Session-House-Highlight als zweiter Checkpoint.
11. Dokumentationsdateien, die nach erfolgreicher Runtime geändert werden müssen.
12. Finale Quality Gates.
13. Klare Blocker, falls eine neue irreversible Entscheidung nötig ist.

Der Plan muss direkt ausführbar sein und darf keine Fake-, Workbench- oder Preview-Lösung als fertiges Feature zählen.

NICHT TUN

- keinen Runtime-Code ändern;
- keine Migration remote anwenden;
- keinen `wrangler deploy` ausführen;
- nicht mergen;
- PR #72 nicht Ready for Review setzen;
- keinen neuen Branch erstellen;
- keinen neuen PR erstellen;
- keine neue Permission-/Identity-Runtime erfinden;
- keine PWA, keinen Service Worker, kein Background Sync;
- keine GPS-Historie;
- keine Houses pro DOM-Element, React-Komponente oder MapLibre-Layer rendern;
- OSM-ID niemals zur App-House-Identity machen.

REMOTE D1

Dokumentierter Remote-Stand ist nur 0001 bis 0003.
0004 bis 0009 bleiben vorbereitet und nicht remote angewendet, solange Repository/Operations-Doku nichts anderes beweist.
Der Renderer-Plan benötigt keine neue Migration.

Wenn du einen Widerspruch zwischen Plan 018, aktuellem Code, accepted ADRs oder GitHub findest, ist der aktuelle Repository-/ADR-/GitHub-Stand maßgeblich. Aktualisiere den Planvorschlag entsprechend und nenne den Widerspruch klar.
```
