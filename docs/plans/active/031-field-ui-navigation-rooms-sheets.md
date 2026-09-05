---
id: plan-031-field-ui-navigation-rooms-sheets
type: plan
status: active
last_updated: 2026-09-05
related: [ux, map, live-teams, collaboration, security, quality, context-organizer-admin, context-field-ui-navigation, plan-030-organizer-admin-platform, ADR-0014, ADR-0026]
---

# Plan 031: Field Launcher, Rooms, Kommentare, Streets und draggable Bottom Sheets

## Ziel

Die mobile Field-Oberfläche wird auf dem bestehenden `feature/organizer-admin-platform`-Stand strukturell bereinigt. Die primäre Navigation bleibt das Launcher-Grid aus `PlatformShell`; Team-interne Tabs werden entfernt. Rooms, Fortschritt, Kommentare und Streets werden eigenständige Launcher-Ziele. Gleichzeitig werden Bottom Sheets auf ein gemeinsames Google-Maps-artiges Drag-/Snap-Verhalten umgestellt, der Street-Erstellflow endet ohne unnötigen Rücksprung in das Area-Sheet, Room-Join-Material wird verständlich und sicher verwaltbar, und der gesunde Sync-Zustand verschwindet aus der permanent dominanten Karten-UI.

Dieser Plan ist absichtlich präzise zu Code-Identifiern, weil die vorherige Implementierung die Master-Anforderung falsch als `TeamCenter`-Tabnavigation interpretiert hat.

## Arbeitsbranch und harte Grenzen

- Repository: `madebycli/flyer-map`.
- Arbeitsbranch: `feature/organizer-admin-platform`.
- Draft PR: #76 gegen `mission-rxdb-sync`.
- PR #76 bleibt OPEN, DRAFT, UNMERGED.
- Kein Production-Deploy.
- Keine Production-D1-Migration.
- `mission-release-2026-09-02-manual` nicht verändern.
- Bestehende Security-/Authz-/Tenant-Gates nicht abschwächen.
- Client bleibt niemals Autoritätsquelle für Rollen, Team-Scope oder Room-Management.
- Kein Room-/Invite-Secret in Logs, Audit, LocalStorage, IndexedDB oder RxDB.
- Kein Produkt-Testlink, bevor exact-head CI und der aktuelle isolierte Staging-Lauf für den implementierten Head grün sind.

Zuletzt vor diesem Dokumentationsslice verifizierter Product-Head: `0d45dc02e88d3a89fa6174211775f7d2b0e80c85`. Dokumentationscommits bewegen den Branch danach weiter. Vor Implementation immer Remote-Head, PR #76 und exact-head CI neu lesen.

## Aktuelle Code-Realität

### Primäre Navigation

`src/platform/PlatformShell.tsx` ist die Field-App-Shell.

Relevante Identifier:

- `PlatformShell`;
- `MenuGridIcon`;
- `launcherItems = buildPlatformLauncherItems(appContext)`;
- `.platform-grid-button`;
- `.platform-menu-overlay`;
- `.platform-menu-sheet`;
- `.platform-menu-handle`;
- `.platform-menu-grid`;
- `.platform-app-item`;
- `dispatchSimpleCommand()`;
- `selectActiveTeam()`.

Das Grid aus `.platform-menu-grid` ist die **einzige primäre Field-App-Navigation**. `.platform-grid-button` bleibt zusätzlich Long-Press-Target für den Brainrot-Modus; Long-Press darf den normalen Menü-Klick nicht zusätzlich auslösen.

`src/platform/platformContract.ts` enthält `PlatformAppCommand`, `PlatformAppContext`, `PlatformLauncherItem` und `buildPlatformLauncherItems()`.

Aktuell rendert `buildPlatformLauncherItems()` tatsächlich nur `team`, `settings` und optional `area-create`. Die breitere historische ID-Union ist keine Aussage über aktuell sichtbare Apps.

### Falsch aufgebaute Team-Navigation

`src/team/TeamHub.tsx` ist aktuell nur ein Compatibility-Reexport:

```ts
export { TeamCenter as TeamHub } from "./TeamCenter.tsx";
```

`src/team/TeamCenter.tsx` enthält aktuell:

```ts
type View = "overview" | "rooms" | "progress" | "comments";
```

und `.team-center-tabs` mit `Übersicht`, `Rooms`, `Fortschritt`, `Kommentare`.

Diese Struktur ist **Transition Debt und nicht das Zielmodell**.

### Street-/Sheet-State

`src/App.tsx` hält die Feld-Navigation unter anderem mit:

- `type Sheet = "teams" | "area" | "task" | "house" | "campaign-comments" | "settings" | "collection-admin" | null`;
- `sheet`;
- `sheetCollapsed`;
- `mode`;
- `selectedAreaId`;
- `selectedTaskId`;
- `selectedHouseTaskId`;
- `manualStreetAreaSelection`.

`saveStreetTask()` erzeugt eine `DistributionTask`, setzt `selectedTaskId`, `mode = "browse"` und `sheet = "task"`.

Der aktuelle Close-Handler des Street-Task-Sheets macht dagegen:

```ts
setSelectedTaskId(null);
setSheet(selectedAreaId ? "area" : null);
```

Zusätzlich besitzt der Snapshot-Konsistenz-Effect einen impliziten Parent-Fallback: wenn `selectedTaskId` verschwindet und `sheet === "task"`, wird ebenfalls `selectedAreaId ? "area" : null` gewählt. `deleteSelectedTask()` setzt aktuell ebenfalls `sheet = "area"`.

Damit kann das Area-Sheet nach einer Street-Detail-Aktion wieder erscheinen, obwohl der Nutzer den Street-Flow schließen wollte. Diese gesamte implizite Parent-Sheet-Semantik muss überprüft werden, nicht nur das `X`.

### Aktuelle Bottom Sheets

`src/styles.css` definiert `.bottom-sheet` als kompletten `overflow-y: auto`-Container. Dadurch scrollen Handle/Header und Body gemeinsam. `.sheet-handle-button` ist aktuell ein Click-to-collapse-Control, kein echter Drag-Handle.

Relevante Klassen:

- `.bottom-sheet`;
- `.compact-sheet`;
- `.bottom-sheet.is-collapsed`;
- `.sheet-handle-button`;
- `.sheet-handle`;
- `.sheet-header`.

### Kommentare

`src/collaboration/CommentsContextPanel.tsx` verwendet `expanded`, `.comments-context-toggle`, `.comments-context-submenu` und `CommentsPanel`.

Der kompakte Default `Kommentare anzeigen` ist richtig. Das mobile Problem entsteht beim expandierten Inhalt in einem Sheet, dessen ganzer Container scrollt: Bei vielen Kommentaren kann der Composer unter Browser-/Safe-Area-/Keyboard-Grenzen unzugänglich werden.

### Rooms / Field Groups

`src/team/TeamCenter.tsx` enthält aktuell Room-Create, Join, List, Details und Credentials. Relevante Funktionen sind `submitJoin()`, `submitCreate()`, `loadGroups()`, `toggleDiscoverability()`, `rotateCredentials()`, `revokeCredentials()`, `closeRoom()`, `leaveRoom()`, `issuedAccess` und `issuedJoinUrl`.

Client-API: `src/data/fieldGroupApi.ts`.

Server: `worker/fieldGroups.ts`.

`rotateCredentials()` im Worker widerruft die bisherigen `field_group_join_credentials` und legt neue Code-/QR-Hashes an. Es verändert **nicht** `field_group_memberships`. Bereits beigetretene Mitglieder bleiben daher aktiv. Rotation invalidiert ausschließlich das alte Join-Material für zukünftige Beitritte.

`docs/architecture/LIVE_TEAMS.md` akzeptiert aktuell:

- D1 speichert SHA-256 Lookup-Hashes der Room Codes/QR-Tokens;
- Plaintext wird nur bei Issuance/Rotation zurückgegeben;
- Rotation bewahrt bestehende Memberships;
- `discoverable` darf direkten Join nicht deaktivieren;
- kein „reusable forever join code“.

## Normative Navigationsarchitektur

### Eine primäre Navigation

Nach diesem Slice darf die primäre Navigation **nicht** so aussehen:

```text
Team
  -> Übersicht | Rooms | Fortschritt | Kommentare
```

Die einzige primäre Navigation ist:

```text
.platform-grid-button
  -> .platform-menu-sheet
     -> .platform-menu-grid
        -> Team
        -> Rooms
        -> Fortschritt
        -> Kommentare
        -> Streets
        -> Gebiet
        -> Einstellungen
```

Die Reihenfolge oben ist normativ für den ersten korrigierten Stand. Responsive Layout darf daraus 2 oder 3 Spalten machen, aber die Informationsarchitektur bleibt flach. Keine zusätzliche Reihe historischer/technischer „Apps“ ohne explizite Master-Anforderung.

### Launcher-IDs und Routing

`PlatformLauncherItem` und `buildPlatformLauncherItems()` bleiben Source of Truth.

Vorgesehene IDs:

- `team` -> `Team`;
- `rooms` -> `Rooms`;
- `stats` -> `Fortschritt`;
- `comments` -> `Kommentare`;
- `streets` -> `Streets`;
- `area-create` -> `Gebiet`;
- `settings` -> `Einstellungen`.

`stats` bedeutet in **diesem Field Launcher ausdrücklich den Fortschritt des aktiven Teams**. Es darf nicht still wieder zu einem Campaign-weiten Admin-Dashboard werden. Historische `StatisticsHub`-Funktionalität kann wiederverwendet werden, aber nur mit korrekt erzwungenem Team-Scope.

Launcher-Sichtbarkeit darf aus `PlatformAppContext` abgeleitet werden, ist aber nur UX. Jede Operation bleibt serverseitig beziehungsweise durch die existierende Field-Autorisierung geschützt. Ein versteckter Button ist kein Authz-Guard.

## Zieloberflächen

### Team

`Team` ist Team-Identität/Management, nicht Container für andere Apps.

Zielinhalt:

- aktives Team;
- Team wechseln, soweit bestehender Role/Scope erlaubt;
- Organizer/Admin kann das bestehende Team-Management öffnen;
- Name/Farbe/Lifecycle bleiben in der bestehenden Team-Management-Logik;
- eine kleine kompakte Team-Zusammenfassung darf sichtbar sein;
- **kein** `Rooms`, `Fortschritt` oder `Kommentare` Tab.

Der vollständige Fortschrittsbildschirm bleibt im separaten Launcher `stats`. Team darf also eine kurze Kennzahl zeigen, aber nicht die gesamte Fortschritt-App duplizieren.

Die `TeamHub.tsx -> TeamCenter` Compatibility-Reexport-Struktur wird aufgelöst. `TeamHub` soll am Ende ein echter fokussierter Team-Hub sein oder auf einen eindeutig benannten Team-Management-Baustein zeigen, nicht wieder auf einen Multi-App-Container.

### Rooms

Neue fokussierte Oberfläche, Ziel-Identifier `RoomsHub` in `src/team/RoomsHub.tsx`.

Sie übernimmt aus `TeamCenter` ausschließlich Room-Funktionalität:

- `Room beitreten`;
- `Room erstellen`;
- `Aktive unterwegs`;
- Room-Detail;
- Teilnehmerzahl;
- `Online anzeigen` / verborgen;
- aktive Mitglieder;
- Join-Zugang anzeigen/erneuern/sperren;
- Room beenden/verlassen.

Kein Team-Stats-/Comment-Tab in `RoomsHub`.

### Fortschritt

Eigenständiger Launcher `stats`, Label `Fortschritt`.

Ziel ist das aktuell aktive Team. Bestehender `TeamProgressPanel.tsx` ist der primäre Wiederverwendungskandidat. `StatisticsHub.tsx` darf nur eingebunden werden, wenn sein Request/Scope explizit auf `context.activeTeam.id` festgelegt wird und der Server diesen Scope akzeptiert. Kein `teamFilter = "all"` als Field-Launcher-Default für Admins.

Ziel-Identifier für den fokussierten Wrapper: `TeamProgressHub`.

### Kommentare

Eigenständiger Launcher `comments`.

Ziel-Identifier: `CommentsHub` unter `src/collaboration/CommentsHub.tsx`.

Zieloberfläche:

- initial aktuelles Team;
- optional `Alle`, nur wenn der serverseitige Zugriff dies erlaubt;
- nach Gebieten gruppiert;
- Street/House/Area-Kontext erkennbar;
- bestehende `TeamCommentsSummary`-/Comments-API-Logik wiederverwenden;
- Server bleibt Source of Truth für Read/Create/Edit/Delete.

### Streets

Eigenständiger Launcher `streets`, Label `Streets`.

Ziel-Identifier: `StreetsHub` unter `src/streets/StreetsHub.tsx`.

Erste echte Funktionalität:

- Einstieg in die vorhandene manuelle Street-Erstellung (`start-manual-street` / `startManualStreet()`);
- klarer vorbereiteter Bereich für Straßennamen-Suche;
- klarer vorbereiteter Bereich für die spätere Street Engine.

**Nicht in diesem Slice erfinden:** eine zweite Map Engine, ungeprüfte OSM-Suche oder neue automatische Markierungslogik. Die bestehende Smart-Street-Infrastruktur in `MapView.tsx` (`SMART_ROAD_*`, Smart anchors/preview, `onSmartStreetPoint`) ist der spätere Integrationspunkt. Ein sichtbarer Streets-Hub darf zukünftige Funktionen als vorbereitet kennzeichnen, aber keine Fake-Funktion vortäuschen.

## Gemeinsames draggable Bottom Sheet

### Zielbaustein

Empfohlener gemeinsamer Baustein: `FieldBottomSheet` unter `src/platform/FieldBottomSheet.tsx` mit gemeinsamem CSS.

Struktur:

```text
FieldBottomSheet
  chrome (nicht content-scrollbar)
    drag handle
    header/title
    close button
  scroll viewport
    body
  optional footer
    composer / primäre Aktion
```

Der Handle und der für die Interaktion notwendige Header scrollen nicht mit dem Content.

### Snap Points

Semantische Zustände:

- `compact`;
- `expanded`;
- `near-fullscreen`.

Snap-Höhen relativ zur tatsächlich verfügbaren Höhe berechnen (`visualViewport.height` wo verfügbar, sonst `100dvh`) und Safe Areas berücksichtigen. Ausgangswerte können ungefähr 34%, 64%, 90% sein, sind aber Designparameter, keine Feature-spezifischen Magic Numbers.

### Pointer-/Touch-Verhalten

- Drag startet ausschließlich an Handle/Drag-Zone.
- Pointer Events (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`).
- `setPointerCapture()` oder gleichwertig stabilisieren.
- `touch-action: none` nur an der Drag-Zone.
- normaler Body-Scroll verändert den Snap Point nicht.
- beim Release nearest snap, optional Velocity.
- `prefers-reduced-motion` respektieren.
- Handle behält einen tastaturbedienbaren Expand/Collapse-Fallback; die Funktion darf nicht gesten-only sein.

### Scroll, Safe Area und Keyboard

- Body hat eigenes `overflow-y: auto`;
- `overscroll-behavior: contain`;
- Footer/Composer bleibt innerhalb der sichtbaren Sheet-Fläche;
- Software-Keyboard über `visualViewport` berücksichtigen;
- Safe-Area-Inset unten einrechnen;
- kein nested-scroll deadlock.

### Migration

Schrittweise migrieren:

1. `.platform-menu-sheet`;
2. Street-/Area-/House-Sheets in `App.tsx`;
3. Comments;
4. `SettingsSheet`;
5. Team;
6. Rooms/Progress/Streets.

Desktop darf ein stabiles großes Sheet/Panel verwenden; die mobile Drag-Semantik darf Desktop-Scroll und Tastaturbedienung nicht verschlechtern.

## Street-State-Machine

### Normativer Flow

```text
AREA_DETAIL
  -> STREET_DRAW
  -> STREET_DETAIL
  -> MAP
```

Nach `saveStreetTask()` ist das neu erzeugte Street-Detail der einzige sichtbare Detailkontext.

Verboten:

```text
AREA_DETAIL
  -> STREET_DRAW
  -> STREET_DETAIL über verstecktem AREA_DETAIL
  -> AREA_DETAIL beim Schließen
```

### Konkrete State-Korrekturen

Mindestens drei Stellen prüfen:

1. Close-Handler des `sheet === "task"`-Sheets: `setSheet(null)`, nicht `selectedAreaId ? "area" : null`.
2. Snapshot-/Selection-Konsistenz-Effect: beim Verlust von `selectedTaskId` keinen impliziten Area-Sheet-Rücksprung erzeugen, solange keine explizite Area-Navigation angefordert wurde.
3. `deleteSelectedTask()`: nach Delete nicht automatisch Area-Sheet öffnen; Ziel ist Map, sofern kein expliziter sichtbarer „Zurück zum Gebiet“-Flow eingeführt wird.

`selectedAreaId` darf als Datenkontext intern erhalten bleiben, ist aber kein versteckter Navigation-Stack.

Statusänderungen `open`, `completed`, `later`, `not-deliverable` beeinflussen den Close-Rückweg nicht.

Ein späterer „Zurück zum Gebiet“-Button wäre eine **explizite** Aktion und ist nicht Teil des aktuellen Auftrags.

Regressionen:

- Area -> Street draw -> Save -> nur Street detail;
- Status ändern -> Close -> Map;
- Street direkt von Map öffnen -> Close -> Map;
- Street löschen -> Map;
- Area anschließend bewusst antippen -> Area-Sheet.

## Kommentare auf Mobil

`CommentsContextPanel` bleibt initial collapsed hinter `.comments-context-toggle`.

Beim Expandieren:

- vorhandene Kommentare scrollen im Sheet-Body;
- Composer bleibt erreichbar;
- viele Kommentare dürfen Composer/Submit nicht unter den Viewport drücken;
- Software-Tastatur darf den Composer nicht dauerhaft verdecken;
- Fokus auf Textarea darf bei Bedarf den Body gezielt nachscrollen;
- keine zweite unabhängige Vollhöhen-Scrollbar in `.comments-context-submenu` erzeugen.

Akzeptanz mindestens mobile Chromium um 390x844 plus schmalerer Viewport, mit echter Browser-Bottom-Bar und Software-Keyboard, nicht nur Desktop Responsive Mode.

Dasselbe Sheet-Prinzip gilt für Settings: keine riesige statische Mobile-Fläche, sondern drag-/scrollbarer gemeinsamer Sheet-Vertrag.

## Rooms: Discoverability und Manager-Liste

`Online anzeigen` ist ausschließlich `discoverable`.

Serververtrag:

- `discoverable=false` erstellt den Room vollständig;
- Room Code funktioniert;
- QR Join funktioniert;
- direkter Join funktioniert;
- Hard expiry/close/revoke bleiben gleich;
- Manager sieht seinen aktiven versteckten Room weiter in der Management-Liste.

Aktuell verwendet `worker/fieldGroups.ts -> listGroups()` für Nicht-Member `listDiscoverableGroups()` und filtert damit auf `g.discoverable = 1`. Das ist für Manager-Verwaltung falsch.

Ziel:

- `admin`: alle aktiven Campaign-Rooms unabhängig `discoverable`;
- `team-editor`: aktive Rooms des serverseitig kanonischen eigenen Teams unabhängig `discoverable`;
- `viewer`: nur discoverable Rooms, sofern Discovery für Viewer weiterhin vorgesehen ist;
- `field-group-member`: nur eigener Room;
- optionaler `team`-Filter verengt, erweitert nie.

## Rooms: aktueller Join-Zugang und Rotation

### Zwei getrennte Nutzeraktionen

**Join-Zugang anzeigen**

- zeigt den aktuell gültigen Room Code, QR und Link;
- verändert keinen Credential-State;
- ist der normale Wiederholungsfall, wenn später jemand dazukommt;
- loggt niemanden aus.

**Join-Zugang erneuern**

- explizite Rotation;
- alter Code/QR/Link wird für zukünftige Beitritte ungültig;
- bereits beigetretene Memberships bleiben aktiv;
- separate Bestätigung mit genau dieser Formulierung.

`Join sperren` bleibt separate Revocation: neue Joins aus, bestehende Memberships bleiben bis normaler Membership-/Group-Lifecycle aktiv.

### Hash-only-Konflikt

Aktuell speichert D1 nur Hashes. Deshalb kann derselbe bestehende Code nach Schließen des `issuedAccess`-Dialogs nicht wiederhergestellt werden.

Verboten ist die schnelle Lösung, Plaintext in D1/RxDB/LocalStorage/IndexedDB/Audit/Logs zu speichern.

### Geplanter Security-Gate für Wiederanzeige

Vor Implementation ADR-0014 und `LIVE_TEAMS.md` bewusst erweitern. Bevorzugtes Design:

- Lookup-Hash bleibt für Join-Auflösung;
- nur der aktuell gültige Credential-Satz erhält zusätzlich recoverable, **AES-GCM-verschlüsseltes** Material at rest;
- dediziertes serverseitiges Worker-Secret/Key;
- AAD bindet mindestens Campaign ID, Group ID, Credential ID und Credential Kind;
- Reveal-Endpunkt autorisiert über serverseitiges `requireManagedGroup` oder äquivalente kanonische Prüfung;
- `Cache-Control: no-store`;
- keine Secret-Werte in Audit/Logs;
- kein Reveal für viewer/field-group-member;
- Rotation/revoke/close/expiry invalidiert den alten Reveal;
- Hard expiry unverändert;
- Key/Ciphertext-Fehler fail-closed;
- Production-Migration bleibt außerhalb dieses Auftrags.

Vor Code: Threat Model für Key lifecycle, bestehende aktive Rooms ohne Ciphertext, Tenant/Team-Tampering, corrupted ciphertext und Rollback dokumentieren. Falls ein besseres Design dieselben Eigenschaften erreicht, kann es nach dokumentierter Review gewählt werden. Silent Plaintext-Downgrade ist nicht erlaubt.

Tests:

- Manager Reveal -> 200 und wiederholt identische aktuelle Werte;
- fremder Team Editor -> 403;
- viewer/member -> 403;
- Rotation -> alter Future-Join blockiert, neuer erfolgreich;
- Rotation -> bestehende Membership weiterhin autorisiert;
- Revoke -> Future-Join blockiert, Membership bleibt;
- close/expiry -> Reveal/Join fail-closed;
- keine Secrets in Audit/Test-Dumps.

## Join-/Read-only-Onboarding und Sprache

- Group QR bleibt Fragment `#groupJoin=...` bis zur erfolgreichen serverseitigen Redemption.
- Gruppen-Onboarding erscheint erst **nach** erfolgreicher Redemption.
- Onboarding darf den Token nicht vorzeitig entfernen, rotieren oder konsumieren.
- versionspezifisches lokales „gesehen“-Flag ist erlaubt, enthält aber kein Secret und keine Autorität.
- Group-/Read-only-Link-Einstieg ist standardmäßig Deutsch; spätere Spracheinstellung bleibt möglich.
- Read-only-Zugang darf nicht durch ein Onboarding-Popup in einen Schreibzugang verwandelt werden.

## Sync-/Serverstatus

### Zielort statt neuer Floating Pill

Gesunder Sync-Zustand wird in der Field-Shell auf die bestehende untere linke Control-Ebene verlagert: `.platform-field-bar` neben beziehungsweise in derselben visuellen Zeile wie Grid-Button/aktives Team. Ziel-Identifier für die neue kleine Anzeige kann `platform-sync-indicator` sein.

Dafür soll `PlatformAppContext` einen minimalen, UI-tauglichen Sync-Zustand aus `App.tsx` erhalten, statt `PlatformShell` einen zweiten unabhängigen Serverstatus erfinden zu lassen. Source bleibt `refreshState`/`syncMessageCode` plus Connectivity; keine Client-Autorität entsteht dadurch.

Zustände:

- healthy/current: kleiner grüner/neutraler Punkt oder Icon, kein permanenter Text;
- loading/syncing: kurz sichtbarer dezenter Zustand;
- offline/error/conflict/new data: sichtbarer Text/Popover/Badge mit Handlungsmöglichkeit.

`MapView.tsx` behält den separaten manuellen `.map-refresh-button` unten rechts, wenn er funktional gebraucht wird. Der Button ist nicht der dauerhafte „Serverbestätigt“-Text.

Vor Änderung alle Renderpfade prüfen, die `refreshState`, `syncMessageCode`, `.connection`, `.map-refresh-control` oder verwandte Status-Pills rendern. Am Ende darf es nicht gleichzeitig zwei gesunde Statusanzeigen geben.

## Admin-/Invite-Grenze

- Organizer/Admin Invites gehören zur Admin-/Organization-Einladungsoberfläche.
- Room Join gehört zu `RoomsHub`/Field Groups.
- Team Read-only Sharing wird **nicht** als Campaign-weite Viewer-Abkürzung gebaut. Es kommt erst, wenn ein echter serverseitiger Team-Scope existiert.

Dieser Plan reserviert diese Grenze, implementiert aber keine neue Team-Read-only-Autorisierungsarchitektur ohne separaten Security-Slice.

## Brainrot-Invariante

Der Fun-Mode bleibt unabhängig:

- Target `.platform-grid-button`;
- ungefähr fünf Sekunden Hold;
- nach erfolgreichem Hold normalen Menü-Klick unterdrücken;
- Overlay schließen/wieder öffnen funktioniert;
- Launcher- und Pointer-Refactor darf die Hold-Erkennung nicht brechen.

## Bewusst nicht in diesem Slice erfinden

- keine vollständige neue Street Engine;
- keine neue OSM-/Straßensuche ohne bestehenden Daten-/Privacy-/Rate-Limit-Vertrag;
- kein Campaign-weites Read-only als angeblicher Team-Link;
- kein zweites primäres Menü innerhalb Team/Rooms;
- kein client-only Authz;
- keine Plaintext-Credentials at rest;
- keine Production-Migration oder Production-Deploy.

## Implementierungsreihenfolge

1. Remote-Head/PR/CI re-verifizieren und Plan/Graph lesen.
2. Contract-/Structure-Tests für Launcher: separate Items, keine `.team-center-tabs`-Primärnavigation.
3. `FieldBottomSheet` mit Pointer/Snap/Keyboard/Accessibility-Tests.
4. `PlatformShell`/`platformContract` auf sieben getrennte Launcher-Ziele umbauen.
5. `TeamHub` fokussieren; Room/Progress/Comment-Logik aus `TeamCenter` extrahieren.
6. `RoomsHub` plus hidden-manager-list fix und Discoverability-Code/QR-Regressionen.
7. Credential-Reveal-Architektur reviewen, ADR/LIVE_TEAMS aktualisieren, dann erst Schema/Server/UI; keine Production-Migration.
8. `TeamProgressHub` mit festem active-Team-Scope.
9. `CommentsHub` plus mobile Composer/Keyboard-Hardening.
10. `StreetsHub` mit echtem manuellen Einstieg und sauber reserviertem Future-Bereich.
11. Street-State-Machine in `App.tsx` inklusive Effect/Delete-Fallbacks korrigieren.
12. Sync-State in `PlatformAppContext` und kleinen `.platform-field-bar`-Indicator überführen; doppelte Healthy-Pills entfernen.
13. Group-/Read-only-Onboarding Deutsch und token-safe.
14. Tests, Typecheck, Dependency Audit, Build.
15. exact-head CI.
16. isoliertes Staging exakt von Product-Head ableiten.
17. Live Browser/Worker Matrix inklusive Rooms visible/hidden, QR/Code, Membership preservation, drag sheets, comments keyboard, Street close, Brainrot.
18. D1/FK/Cleanup/State-Preservation prüfen.
19. Erst dann Testlink an Master.

## Testmatrix

### Launcher

- `.platform-grid-button` öffnet Launcher.
- Grid zeigt die sieben erwarteten Funktionen, soweit Kontext/Capability sie sinnvoll zulässt.
- Reihenfolge bleibt Team, Rooms, Fortschritt, Kommentare, Streets, Gebiet, Einstellungen.
- Team öffnet keinen Tabs-Container mit Rooms/Fortschritt/Kommentare.
- Rooms/Fortschritt/Kommentare/Streets direkt aus Grid erreichbar.
- Brainrot Long-Press öffnet Brainrot und nicht zusätzlich Menü.

### Bottom Sheets

- compact -> expanded -> near-fullscreen per Handle drag.
- Content scroll verändert Snap-Höhe nicht.
- Handle/Header bleiben sichtbar.
- Close an jedem Snap.
- 390x844 plus schmalerer Viewport.
- Browser Bottom Bar + Software Keyboard.
- viele Kommentare -> Composer erreichbar.
- Settings bleibt vollständig erreichbar.

### Street

- Area -> manuell zeichnen -> speichern -> nur Street detail.
- Status setzen -> schließen -> Map.
- kein Area-Autoreopen durch Close oder Effect.
- Delete -> Map.
- Area bewusst antippen -> Area-Sheet.

### Rooms

- create discoverable=true -> Room + Code + QR.
- create discoverable=false -> Room + Code + QR.
- Manager sieht hidden Room.
- Code join visible/hidden.
- QR join visible/hidden.
- current credential reveal wiederholt identisch.
- Reveal rotiert nichts.
- Rotation invalidiert nur Future-Join-Material, bestehende Membership bleibt.
- Revoke blockiert Future Join, Membership bleibt.
- close/expiry gemäß Lifecycle.

### Sync

- healthy/current minimal in `.platform-field-bar`.
- loading dezent.
- offline/error/conflict sichtbar.
- manueller Refresh bleibt zugänglich.
- keine zweite permanente Healthy-Pill.

### Security/Regression

- fremde Campaign/Team-IDs erweitern keinen Scope.
- unbekannte API fail-closed.
- Organization-/Admin-Gates unverändert.
- Production `wrangler.jsonc`: `main=./worker/indexFc52.ts`, D1 `0113e775-1e43-4d96-8b97-51fdeec7355b`, Rate IDs `91714001/2/3`, kein `nodejs_compat`, kein Organizer-Staging-Limiter.
- kein Production-Deploy/Migration.

## Abnahmekriterien

- Primäre Field-Navigation ist `.platform-menu-grid`, nicht `.team-center-tabs`.
- `type View = "overview" | "rooms" | "progress" | "comments"` ist nicht mehr die primäre Team-Navigation.
- Team ist fokussiert auf Team-Verwaltung/Identität plus höchstens kompakte Zusammenfassung.
- Rooms, Fortschritt, Kommentare und Streets sind eigenständig erreichbar.
- Bottom-Sheet-Chrome bleibt beim Content-Scroll stehen und lässt sich am Handle vergrößern/verkleinern.
- Kommentar-Composer bleibt mobil bei vielen Kommentaren/Keyboard erreichbar.
- Street-Create-/Status-/Close-Flow endet auf Map.
- `Online anzeigen` beeinflusst nur Discovery.
- Hidden Room bleibt für seinen Manager verwaltbar.
- Code/QR join visible und hidden.
- `Join-Zugang anzeigen` rotiert nichts.
- `Join-Zugang erneuern` wirft bestehende Mitglieder nicht raus.
- Room-Reveal speichert kein Secret im Klartext und ist serverseitig autorisiert.
- Healthy sync status ist klein und links in der Field-Control-Ebene; echte Fehler bleiben sichtbar.
- Brainrot Long-Press bleibt funktionsfähig.
- Tests/typecheck/audit/build und Staging-Live-Matrix grün.
- PR #76 bleibt Draft/unmerged.

## Selbstkritik des ersten Drafts und Korrekturen

Der erste Draft wurde gegen Screenshots und Source erneut geprüft. Folgende Fehlinterpretationen waren möglich und sind in dieser Fassung geschlossen:

1. **`stats` war semantisch noch zu offen.** Korrektur: Field-Launcher `stats` bedeutet aktives Team, nicht Campaign-weite Default-Stats.
2. **Street-Rücksprung war zu eng am X-Handler beschrieben.** Korrektur: auch Snapshot-Effect und `deleteSelectedTask()` sind Teil der impliziten Parent-Navigation und müssen geprüft/entkoppelt werden.
3. **Sync-Ziel war nur „kleiner“.** Korrektur: Healthy-State gehört konkret in/bei `.platform-field-bar`; `PlatformAppContext` transportiert den UI-State, statt eine neue unabhängige Pill zu bauen.
4. **Launcher-Reihenfolge war nicht eindeutig genug.** Korrektur: sieben Items mit fester erster Reihenfolge; keine zweite App-Liste in Team.
5. **Streets konnte als Auftrag für eine neue Engine gelesen werden.** Korrektur: nur echte vorhandene manuelle Funktion anbinden und Future Engine/Suche sauber reservieren.
6. **Team-Kurzstats und Fortschritt hätten doppelt werden können.** Korrektur: Team darf nur kompakte Zusammenfassung zeigen; vollständige Fortschritt-App ist separat.
7. **Room-Wiederanzeige hätte zu Plaintext-Persistenz verleiten können.** Korrektur: ADR-/Threat-Model-Gate und verschlüsseltes-at-rest Design vor Schema-Code zwingend.

Wenn Implementation von einer dieser korrigierten Aussagen abweichen soll, muss die Abweichung vor Code als Plan-/ADR-Änderung dokumentiert werden, nicht still im UI entstehen.

## Dokumentation bei Implementation

Im selben Slice aktualisieren, wenn sich der Vertrag real ändert:

- `docs/context-field-ui-navigation.yaml`;
- `docs/context-organizer-admin.yaml`;
- dieser Plan;
- `docs/product/UX.md`;
- `docs/architecture/LIVE_TEAMS.md` und ADR-0014, falls recoverable Join Credentials akzeptiert werden;
- `docs/architecture/SECURITY.md` bei Credential-encryption/reveal Endpoint;
- `docs/quality/QUALITY.md` für mobile Sheet/Keyboard Acceptance soweit nötig;
- `docs/prompts/CONTINUE_FIELD_UI_NAVIGATION_LATEST.md`.

## Wiederaufnahme

`AGENTS.md` -> `docs/status/CURRENT.md` -> `docs/context-map.yaml` -> `docs/context-organizer-admin.yaml` -> `docs/context-field-ui-navigation.yaml` -> dieser Plan -> `docs/architecture/LIVE_TEAMS.md` -> UX/MAP/COLLABORATION/SECURITY/QUALITY -> aktueller Remote-Head/CI.
