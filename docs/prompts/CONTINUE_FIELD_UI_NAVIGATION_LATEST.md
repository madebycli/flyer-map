---
id: prompt-field-ui-navigation-latest
type: handoff
status: current
last_updated: 2026-09-05
related: [plan-031-field-ui-navigation-rooms-sheets, context-field-ui-navigation, context-organizer-admin, live-teams, ux, map, collaboration, security, quality, plan-030-organizer-admin-platform]
---

# Continue Field UI Navigation / Rooms / Sheets — implementation handoff

Arbeite direkt am bestehenden GitHub-Projekt `madebycli/flyer-map` auf `feature/organizer-admin-platform` weiter. Nicht neu anfangen, nicht resetten und nicht nur planen. GitHub/Repository ist Source of Truth. Der Master hat Plan 031 ausdrücklich bestätigt. Setze ihn evidence-driven um, ohne PR #76 zu mergen oder Production anzufassen.

## Zuerst lesen

In dieser Reihenfolge:

1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`
4. `docs/context-organizer-admin.yaml`
5. `docs/context-organizer-admin-live.yaml`
6. `docs/context-field-ui-navigation.yaml`
7. `docs/plans/active/031-field-ui-navigation-rooms-sheets.md`
8. `docs/plans/active/030-organizer-admin-platform.md`
9. `docs/architecture/LIVE_TEAMS.md`
10. `docs/decisions/ADR-0014-live-field-group-credentials.md`
11. `docs/product/UX.md`
12. `docs/architecture/MAP.md`
13. `docs/architecture/COLLABORATION.md`
14. `docs/architecture/SECURITY.md`
15. `docs/quality/QUALITY.md`
16. `docs/operations/ORGANIZER_ADMIN_STAGING.md`

Danach GitHub Remote-Head, PR #76, changed files und exact-head CI neu lesen. SHAs in Docs sind nur Marker, weil Doku-Commits den Branch bewegen.

## Master-Anforderung in einem Satz

Das Grid-Menü aus `PlatformShell` ist die einzige primäre Field-Navigation; Team darf nicht wieder zu einem Container mit Rooms/Fortschritt/Kommentare-Tabs werden. Die eigenständigen Launcher-Apps, draggable Sheets, korrekte Street-Navigation und sichere Room-Credential-Semantik sind auf diesem Branch vollständig umzusetzen und anschließend auf isoliertem Staging zu verifizieren.

## Nicht missverstehen

### 1. Screenshot-2-Menü ist die primäre Navigation

Die primäre Field-Navigation ist in:

- `src/platform/PlatformShell.tsx`;
- `src/platform/platformContract.ts`;
- `buildPlatformLauncherItems()`;
- `.platform-grid-button`;
- `.platform-menu-sheet`;
- `.platform-menu-grid`;
- `.platform-app-item`.

**Nicht** in `TeamCenter`.

Die falsche aktuelle Struktur ist:

```ts
type View = "overview" | "rooms" | "progress" | "comments";
```

plus `.team-center-tabs` in `src/team/TeamCenter.tsx`.

Diese Tabs dürfen nicht als primäre Navigation bestehen bleiben oder später unter anderem Namen neu entstehen.

Ziel-Launcher, erste Reihenfolge:

1. `team` / Team
2. `rooms` / Rooms
3. `stats` / Fortschritt
4. `comments` / Kommentare
5. `streets` / Streets
6. `area-create` / Gebiet
7. `settings` / Einstellungen

Responsive darf das Grid umbrechen. Informationsarchitektur bleibt flach.

### 2. Team ist kein App-Container

`Team` enthält Team-Auswahl/-Management und höchstens eine kompakte Team-Zusammenfassung. Kein Rooms-/Progress-/Comments-Tab.

`src/team/TeamHub.tsx` ist aktuell nur Compatibility-Reexport von `TeamCenter`. Löse diese Übergangsstruktur sauber auf. `TeamHub` soll danach eine fokussierte Team-Oberfläche sein, nicht ein umbenannter Multi-App-Container.

### 3. Kein „App Store“ bauen

Nicht zusätzlich Sessions, Activity, Automations oder historische Hubs ungefragt in dieses Launcher-Grid kippen, nur weil `PlatformLauncherItem` alte IDs kennt. Der Master will wenige klare Top-Level-Funktionen, die oben explizit genannt sind.

### 4. `stats` bedeutet hier Team-Fortschritt

Der Field-Launcher `stats` zeigt den Fortschritt von `PlatformAppContext.activeTeam`. Kein Campaign-weites Admin-Default. `TeamProgressPanel.tsx` bevorzugt wiederverwenden. `StatisticsHub.tsx` nur, wenn Team-Scope explizit und serverseitig korrekt ist.

### 5. Streets ist vorbereitet, nicht erfunden

`Streets` bekommt eine echte eigene Oberfläche und muss mindestens die vorhandene manuelle Street-Erstellung erreichbar machen. Straßennamensuche/Future Street Engine sauber vorbereiten. Keine neue OSM-/Map-Engine erfinden. Bestehende Smart-Street-Verträge in `MapView.tsx` (`SMART_ROAD_*`, anchors, preview, `onSmartStreetPoint`) respektieren.

### 6. Bottom Sheet bedeutet Sheet-Höhe draggen, nicht Content scrollen

Der graue Handle ist ein echter Drag-Handle. Handle/Header scrollen nicht mit. Nur der Body scrollt. Normales Scrollen ändert die Sheet-Höhe nicht. Drag am Handle snappt `compact`, `expanded`, `near-fullscreen`.

### 7. Street-Flow endet auf der Karte

Gewünschte State Machine:

```text
AREA_DETAIL -> STREET_DRAW -> STREET_DETAIL -> MAP
```

Nach `saveStreetTask()` kommt Street Detail. Beim Schließen nach Statusänderung kommt **nicht** wieder Area Detail.

In `src/App.tsx` mindestens diese drei Stellen prüfen:

- Close-Handler `sheet === "task"`;
- Snapshot-/Selection-Effect, der bei fehlendem `selectedTaskId` aktuell auf `area` fällt;
- `deleteSelectedTask()`.

Keinen versteckten Parent-Sheet-Stack bewahren. Area öffnet erst wieder durch bewusste Area-Auswahl oder später einen ausdrücklich sichtbaren Zurück-Button.

### 8. `Online anzeigen` ist nur Discovery

`discoverable=false` darf nicht verhindern:

- Room-Erstellung;
- Room Code Join;
- QR Join;
- direkten Join.

Manager müssen hidden Rooms trotzdem verwalten/auflisten können. Aktuell ist `worker/fieldGroups.ts -> listGroups()` problematisch, weil Nicht-Member über `listDiscoverableGroups()` laufen.

### 9. „Join-Zugang anzeigen“ ist keine Rotation

Normalfall: denselben aktuell gültigen Code/QR/Link später wieder anzeigen.

Separate Operation: `Join-Zugang erneuern` = Rotation. Rotation macht alten Code/QR für **zukünftige** Joins ungültig, lässt bestehende `field_group_memberships` aber bestehen. Das ist im aktuellen Worker bereits so und muss regressionsgeschützt bleiben.

`Join sperren` blockiert neue Joins, entfernt aber nicht automatisch bestehende Memberships.

### 10. „Permanent“ bedeutet nicht „für immer gültig“

Der Master will den aktuellen Join-Zugang während der **aktiven Lebenszeit des Rooms** wieder anzeigen können, auch wenn das erste Modal geschlossen wurde oder jemand 30 Minuten später kommt.

Nicht daraus machen:

- forever credential;
- Credential ohne `hard_expires_at`;
- Credential, das Rotation/Revoke/Close/Expiry ignoriert.

Room-Lifecycle und ADR-0014 bleiben die Obergrenze.

### 11. Hash-only nicht mit Plaintext „fixen“

Aktuell sind Room/QR Credentials hash-only in D1; Plaintext existiert nur bei Issuance/Rotation. Deshalb ist Re-show des gleichen Codes nach Dialog-Close heute technisch nicht möglich.

Bevor Reveal implementiert wird:

- ADR-0014/LIVE_TEAMS-Vertrag explizit reviewen/ändern;
- Threat Model schreiben;
- bevorzugt aktuellen Credential-Satz zusätzlich AES-GCM-verschlüsselt at rest halten, Hash weiter für Lookup;
- serverseitiger Manager-Reveal mit `requireManagedGroup` oder äquivalenter kanonischer Authz;
- `Cache-Control: no-store`;
- Rotation/revoke/close/expiry invalidiert alten Reveal;
- niemals Plaintext in D1/RxDB/LocalStorage/IndexedDB/Audit/Logs.

Verwende für recoverable Room-Credentials einen dedizierten serverseitigen Encryption-Key. **Nicht** den Organization-TOTP-Key, Session-Secret oder irgendeinen Client-Key wiederverwenden. Key niemals ins Repository committen. Isoliertes Staging bekommt nur eine eigene Staging-Bindung/Secret.

Keine Production-Migration. Eine neue Migration darf nur vorbereitet und in isoliertem Staging angewandt werden.

### 12. Bestehende hash-only Rooms nicht „rekonstruieren“

Für einen bereits existierenden Room ohne verschlüsseltes recoverable Material kann der alte Code aus dem Hash nicht zurückgewonnen werden.

Korrektes Verhalten nach Einführung des Reveal-Designs:

- Server gibt für solchen Legacy-active-Room keinen erfundenen Code zurück;
- UI erklärt, dass der vorhandene Zugang aus der älteren Hash-only-Version nicht erneut angezeigt werden kann;
- Manager kann **bewusst einmal** `Join-Zugang erneuern` wählen;
- die neue Rotation erzeugt recoverable current credentials;
- bestehende Memberships bleiben dabei aktiv.

Keine automatische Rotation beim Öffnen des Dialogs. Kein verstecktes Ausloggen. Kein Hash-Bruteforce.

### 13. Kommentare müssen auf Mobil schreibbar bleiben

`CommentsContextPanel` bleibt standardmäßig collapsed (`.comments-context-toggle`). Expanded müssen viele Kommentare scrollen, während der Composer erreichbar bleibt. Software-Keyboard, Browser Bottom Bar, Safe Area und `visualViewport` testen. Kein nested-scroll deadlock.

### 14. Healthy Sync ist keine große Pill

Der dominante `Serverbestätigt`/Healthy-Status muss weg. Ziel: kleine `platform-sync-indicator`-artige Anzeige innerhalb der bestehenden `.platform-field-bar`, links in derselben Field-Control-Zeile wie `.platform-grid-button` und `.platform-active-team`. Kein permanenter Healthy-Text.

Die Klasse `.platform-field-bar` existiert bereits in `PlatformShell.tsx`; **keine neue zweite Bottom-Bar erfinden**.

`offline/error/conflict/new data` bleiben sichtbar. Der manuelle `.map-refresh-button` unten rechts darf funktional bleiben. Prüfe alle Renderpfade `refreshState`, `syncMessageCode`, `.connection`, `.map-refresh-control`, bevor du einen entfernst.

Wenn `PlatformShell` den Status benötigt, erweitere `PlatformAppContext` um einen minimalen Präsentationszustand aus `App.tsx`, statt einen zweiten unabhängigen Sync-Algorithmus in `PlatformShell` zu implementieren.

### 15. Brainrot nicht kaputtmachen

`.platform-grid-button` bleibt Long-Press-Target. Etwa 5 Sekunden Hold öffnet Brainrot. Nach erfolgreichem Long-Press normalen Menü-Klick schlucken.

## Harte Release-/Security-Grenzen

- PR #76 OPEN/DRAFT/unmerged lassen.
- Nicht Ready markieren.
- Kein Merge.
- Kein Production-Deploy.
- Keine Production-D1-Migration.
- `mission-release-2026-09-02-manual` nicht anfassen.
- Production `wrangler.jsonc` behält:
  - `main = ./worker/indexFc52.ts`;
  - D1 `0113e775-1e43-4d96-8b97-51fdeec7355b`;
  - Rate namespaces `91714001`, `91714002`, `91714003`;
  - kein `nodejs_compat`;
  - keinen Organizer-Staging-Limiter.
- `assets.run_worker_first` enthält aktuell `/api/*` und exaktes `/`; Root-Asset-/Login-Vertrag nicht regressieren.
- Server ist Source of Truth für Auth/Authz/Team/Room/Tenant.
- Keine Tests oder Security Guards abschwächen.
- Keine UI-only Berechtigungen.
- Group QR darf wie bisher im URL-Fragment für Redemption existieren; nicht in Query-String oder persistente Browserstores verschieben.

## Code-Landkarte

### Launcher

`src/platform/PlatformShell.tsx`

- `PlatformShell`
- `MenuGridIcon`
- `menuOpen`
- `teamHubOpen`
- `statisticsOpen`
- `launcherItems`
- `overlayOpen`
- `dispatchSimpleCommand()`
- `.platform-field-bar`
- `.platform-grid-button`
- `.platform-active-team`
- `.platform-menu-sheet`
- `.platform-menu-grid`

`src/platform/platformContract.ts`

- `PlatformAppCommand`
- `PlatformAppContext`
- `PlatformLauncherItem`
- `buildPlatformLauncherItems()`

### Team/Rooms/Progress

`src/team/TeamHub.tsx`

- aktueller Compatibility-Reexport, nicht Zielarchitektur.

`src/team/TeamCenter.tsx`

- `View`
- `view`
- `.team-center-tabs`
- `submitJoin()`
- `submitCreate()`
- `loadGroups()`
- `toggleDiscoverability()`
- `rotateCredentials()`
- `revokeCredentials()`
- `issuedAccess`
- `Modal`

`src/team/TeamProgressPanel.tsx`

`src/team/TeamCommentsSummary.tsx`

`src/team/FieldGroupMembersPanel.tsx`

### Field state / Street / sheets

`src/App.tsx`

- `Sheet`
- `MapMode`
- `sheet`
- `sheetCollapsed`
- `selectedAreaId`
- `selectedTaskId`
- `saveStreetTask()`
- `deleteSelectedTask()`
- `startManualStreet()`
- `openStreetDrawing()`
- `PlatformAppCommand` handling
- `onPlatformContextChange`
- `refreshState` / `syncMessageCode`

`src/styles.css`

- `.bottom-sheet`
- `.compact-sheet`
- `.sheet-handle-button`
- `.sheet-handle`
- `.sheet-header`

Empfohlenes neues Shared UI: `src/platform/FieldBottomSheet.tsx`.

### Comments

`src/collaboration/CommentsContextPanel.tsx`

- `expanded`
- `.comments-context-toggle`
- `.comments-context-submenu`
- `CommentsPanel`

### Rooms server/client

`src/data/fieldGroupApi.ts`

- `FieldGroupSummary`
- `FieldGroupCredentials`
- `fetchFieldGroups()`
- `fetchFieldGroup()`
- `createFieldGroup()`
- `joinFieldGroup()`
- `rotateFieldGroupCredentials()`
- `revokeFieldGroupCredentials()`
- `buildFieldGroupQrJoinUrl()`

`worker/fieldGroups.ts`

- `listGroups()`
- `listDiscoverableGroups()`
- `requireManagedGroup()`
- `credentialPair()`
- `rotateCredentials()`
- `revokeCredentials()`

### Map/sync/Streets

`src/map/MapView.tsx`

- `MapRefreshState`
- `MapView`
- `.map-refresh-control` rendering
- Smart Street props/contracts

`src/m4.css`

- `.map-refresh-control`
- `.map-refresh-button`
- `.is-loading/.is-error/.is-current/.is-available`

## Zielkomponenten

Wenn Source-Review nichts Besseres im aktuellen Head zeigt, verwende folgende klare Komponenten statt neue Tabs:

- `TeamHub` = fokussierter Team-Hub;
- `RoomsHub` = `src/team/RoomsHub.tsx`;
- `TeamProgressHub` = fokussierter active-Team Fortschritt;
- `CommentsHub` = `src/collaboration/CommentsHub.tsx`;
- `StreetsHub` = `src/streets/StreetsHub.tsx`;
- `FieldBottomSheet` = gemeinsamer draggable Sheet-Baustein.

Wenn du einen Namen aus technischen Gründen ändern musst, aktualisiere Plan/Graph im selben Commit. Ersetze die Architektur nicht still durch andere Tabs.

## Implementierungsphasen

### Phase A: Baseline und Tests

1. Current remote head + PR #76 + CI verifizieren.
2. Bestehende Tests rund um PlatformShell/TeamCenter/Field Groups/App sheets lokalisieren.
3. Neue Regressionstests zuerst für:
   - Launcher-Items und Reihenfolge;
   - keine TeamCenter primary tabs;
   - hidden Room manager visibility;
   - code/QR join hidden + visible;
   - rotation preserves membership;
   - Street close/effect/delete -> map;
   - Brainrot long-press contract.

Keine Tests auf eine gewünschte Implementierung „umlügen“, wenn sie eine echte Security-/Production-Invariante schützen.

### Phase B: Navigation extrahieren

1. `buildPlatformLauncherItems()` auf sieben Zielitems bringen.
2. `PlatformShell` bekommt eigene open states/handlers für Rooms/Progress/Comments/Streets.
3. `TeamHub` fokussieren.
4. Room-Logik aus `TeamCenter` -> `RoomsHub`.
5. Progress -> `TeamProgressHub`.
6. Comments summary -> `CommentsHub`.
7. Streets -> `StreetsHub`.
8. `View`/`.team-center-tabs` entfernen, wenn keine nicht-primäre Restfunktion mehr benötigt wird.

### Phase C: Shared draggable sheet

1. `FieldBottomSheet` Contract implementieren.
2. Pointer capture / snap points / reduced motion / keyboard fallback.
3. Chrome fixed, body scrollable, optional footer.
4. `visualViewport` + safe areas.
5. Platform menu migrieren.
6. Area/Street/House/Settings/Team/Rooms/Progress/Comments/Streets schrittweise migrieren.
7. Desktop nicht regressieren.

### Phase D: Street flow

- `saveStreetTask()` behält Street detail.
- Street detail Close -> map.
- Task-loss Effect -> kein implizites Area reopen.
- `deleteSelectedTask()` -> map.
- Area öffnet erst durch explizite Area-Auswahl erneut.

### Phase E: Rooms semantics

1. Manager-List serverseitig korrekt nach Role/Team scope.
2. `Online anzeigen` nur discovery.
3. Code/QR visible + hidden live testen.
4. UI trennt `Join-Zugang anzeigen`, `Join-Zugang erneuern`, `Join sperren`.
5. Rotation-Warnung sagt ausdrücklich, dass bestehende Mitglieder verbunden bleiben.

### Phase F: recoverable current Room credentials

1. ADR-0014 + LIVE_TEAMS vor Code reviewen/ändern.
2. Threat Model dokumentieren.
3. nächste freie Migration im aktuellen Tree wählen, nicht Nummer raten.
4. dedizierten Room-Credential Encryption-Key in Runtime-Vertrag einführen, ohne TOTP-Key-Reuse.
5. current credential encrypted-at-rest + hash lookup.
6. Manager reveal endpoint + same-origin/no-store + canonical authz.
7. Rotation/revoke/close/expiry invalidation.
8. existierende hash-only Rooms: expliziter unavailable-to-reveal Zustand, bewusste Rotation nötig, keine Rekonstruktion.
9. Staging Migration nur isolierte D1.

### Phase G: Comments / status / onboarding

- Comments Composer mobile/keyboard reparieren.
- Healthy sync in bestehender `.platform-field-bar` minimieren.
- actionable states sichtbar.
- Group onboarding nach erfolgreicher Redemption, Deutsch default.
- Read-only onboarding Deutsch default; keine Authz-Änderung.

## Verifikationsmatrix vor Testlink

CI:

- `npm test`;
- Typecheck;
- Dependency Audit;
- Production build.

Staging/live:

- exact feature derivation;
- keine Production Bindings;
- D1 fingerprint/state/FK before-after;
- Launcher separate Items in richtiger Struktur;
- mobile sheet drag + content scroll;
- many comments + keyboard + composer;
- Street draw/save/status/close -> map;
- hidden Room manager list;
- hidden Room Code join;
- hidden Room QR join;
- visible Room Code/QR join;
- current Join-Zugang re-show ohne Rotation;
- Legacy-active hash-only Room zeigt keinen erfundenen Credential und rotiert nicht automatisch;
- bewusste Rotation macht neuen Credential re-showable;
- Rotation: old future join blocked/new future join works;
- already joined membership survives rotation;
- revoke future join blocked/membership survives;
- Brainrot long hold;
- bare `/` -> `/login` und explicit `/?campaign=...` remains Field entry;
- existing Organizer/Admin authz gates continue green.

Erst wenn current Product head CI und isoliertes Staging vollständig grün sind, dem Master den Staging-Link geben. Kein alter Testlink als „neuer Stand“ ausgeben.

## Arbeitsweise

Arbeite autonom durch echte Fehler. Nicht bei jedem kleinen Bug einen neuen Planer-Prompt verlangen. Reproduzieren -> kleinsten sicheren Fix -> Tests -> Commit -> exact-head CI -> Logs/Artifacts -> weiter.

Vor Remote-Schreiboperationen Head erneut prüfen. Bei parallel geänderten Dateien nicht überschreiben; Änderungen neu auf aktuellen Head aufsetzen.

Dokumentation/Graph/Plan/Prompt im selben Slice aktualisieren, wenn sich Identifier oder akzeptierte Architektur ändern.

## Selbstkritik dieses Prompts und eingebaute Korrekturen

Der erste Prompt-Draft wurde gegen Plan 031, Screenshots und Servercode geprüft. Folgende Missverständnisse wurden in dieser Fassung ausdrücklich geschlossen:

1. **„Permanenter Join-Link“ konnte als forever credential gelesen werden.** Jetzt ist klar: wiederanzeigbar nur innerhalb normaler aktiver Room-Lebenszeit und weiterhin rotate/revoke/close/expiry-fähig.
2. **Bestehende hash-only Rooms konnten zu erfundener Rekonstruktion verleiten.** Jetzt ist eine bewusste einmalige Rotation der einzige Übergang zu recoverable credentials; keine automatische Rotation und kein Hash-Bruteforce.
3. **Encryption-Key war nicht isoliert genug beschrieben.** Jetzt ist TOTP-/Session-Key-Reuse ausdrücklich verboten und ein dedizierter serverseitiger Key verlangt.
4. **Sync-Ziel konnte als neue zweite Leiste interpretiert werden.** Jetzt ist die bereits existierende `.platform-field-bar` der konkrete Zielcontainer.
5. **Street-Fix konnte wieder nur das X ändern.** Jetzt sind Close, Task-loss Effect und Delete explizit gemeinsam zu prüfen.
6. **Team-Fortschritt konnte wieder Campaign-Stats werden.** Jetzt ist `stats` im Field Launcher ausdrücklich an `activeTeam` gebunden.
7. **Future Streets konnte als Auftrag für neue Map-/OSM-Engine gelesen werden.** Jetzt ist der Slice auf vorhandene manuelle Funktion plus vorbereitete Integrationsfläche begrenzt.

Wenn die Implementation von einem dieser Punkte abweichen muss, zuerst Plan/ADR aktualisieren und die Abweichung begründen. Nicht still eine andere Informations- oder Security-Architektur bauen.

## Abschlussbericht

Am Ende mindestens:

- exakter Feature-Head;
- PR #76 OPEN/DRAFT/unmerged;
- exact-head CI run/job und alle Gates;
- veränderte relevante Dateien;
- Room-Credential-Architektur, dedizierter Key-Vertrag und Migration nur Staging/prepared;
- Production-Wrangler-Invarianten bestätigt;
- Staging run/job + URL;
- D1 fingerprint/state/FK proof;
- mobile Browser-Matrix;
- Room visible/hidden Code/QR + current reveal + rotation membership preservation;
- Street close flow;
- comments keyboard/composer;
- launcher/menu + Brainrot;
- bekannte Restrisiken.


## Plan-031 Implementation Contract Update

The implementation target now includes the focused Field hubs, shared `FieldBottomSheet`, Street-detail close-to-map state machine, manager-visible hidden Rooms, manager-only current credential reveal backed by migration 0020/AES-GCM, and the compact sync indicator. The branch is not considered complete until exact-head CI plus the isolated Staging live matrix for the same Product head pass. Do not replace current-credential reveal with implicit rotation and do not weaken the no-plaintext-at-rest contract.
