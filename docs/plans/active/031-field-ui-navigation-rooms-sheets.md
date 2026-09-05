---
id: plan-031-field-ui-navigation-rooms-sheets
type: plan
status: active
last_updated: 2026-09-05
related: [ux, map, live-teams, collaboration, security, quality, context-organizer-admin, context-field-ui-navigation, plan-030-organizer-admin-platform, ADR-0014, ADR-0026]
---

# Plan 031: Field Launcher, Rooms, Kommentare, Streets und draggable Bottom Sheets

## Ziel

Die mobile Field-Oberfläche wird auf dem bestehenden `feature/organizer-admin-platform`-Stand strukturell bereinigt. Die primäre Navigation bleibt das Launcher-Grid aus `PlatformShell`; Team-interne Tabs werden entfernt. Rooms, Fortschritt, Kommentare und Streets werden eigenständige Launcher-Ziele. Gleichzeitig werden Bottom Sheets auf ein gemeinsames Google-Maps-artiges Drag-/Snap-Verhalten umgestellt, der Street-Erstellflow beendet ohne unnötigen Rücksprung in das Area-Sheet, Room-Join-Material wird verständlich und sicher verwaltbar, und der gesunde Sync-Zustand verschwindet aus der permanent dominanten Karten-UI.

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

Aktuell rendert `buildPlatformLauncherItems()` tatsächlich nur:

- `team`;
- `settings`;
- optional `area-create`.

Die Union von `PlatformLauncherItem.id` enthält historisch weitere IDs, ist aber nicht gleichbedeutend mit aktuell sichtbaren Apps.

### Falsch aufgebaute Team-Navigation

`src/team/TeamHub.tsx` ist aktuell nur:

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

`src/App.tsx` hält die Feld-Navigation mit:

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

Damit erscheint nach dem Schließen einer eben gezeichneten Straße erneut das Area-Sheet. Dieser zusätzliche Rücksprung ist explizit unerwünscht.

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

`src/collaboration/CommentsContextPanel.tsx` verwendet:

- `expanded`;
- `.comments-context-toggle`;
- `.comments-context-submenu`;
- `CommentsPanel`.

Der kompakte Default `Kommentare anzeigen` ist richtig. Das mobile Problem entsteht beim expandierten Inhalt in einem Sheet, dessen ganzer Container scrollt: Bei vielen Kommentaren kann der Composer unter Browser-/Safe-Area-/Keyboard-Grenzen unzugänglich werden.

### Rooms / Field Groups

`src/team/TeamCenter.tsx` enthält aktuell Room-Create, Join, List, Details und Credentials. Relevante Funktionen:

- `submitJoin()`;
- `submitCreate()`;
- `loadGroups()`;
- `toggleDiscoverability()`;
- `rotateCredentials()`;
- `revokeCredentials()`;
- `closeRoom()`;
- `leaveRoom()`;
- `issuedAccess`;
- `issuedJoinUrl`.

Client-API: `src/data/fieldGroupApi.ts`.

Server: `worker/fieldGroups.ts`.

Wichtig: `rotateCredentials()` im Worker widerruft die bisherigen `field_group_join_credentials` und legt neue Code-/QR-Hashes an. Es verändert **nicht** `field_group_memberships`. Bereits beigetretene Mitglieder bleiben daher aktiv. Rotation invalidiert ausschließlich das alte Join-Material für zukünftige Beitritte.

`LIVE_TEAMS.md` akzeptiert aktuell:

- D1 speichert SHA-256 Lookup-Hashes der Room Codes/QR-Tokens;
- Plaintext wird nur bei Issuance/Rotation zurückgegeben;
- Rotation bewahrt bestehende Memberships;
- `discoverable` darf direkten Join nicht deaktivieren;
- kein „reusable forever join code“.

## Zielarchitektur der primären Navigation

### Keine TeamCenter-Tabs

Nach diesem Slice darf die primäre Navigation **nicht** so aussehen:

```text
Team
  -> Übersicht | Rooms | Fortschritt | Kommentare
```

Ziel:

```text
.platform-grid-button
  -> .platform-menu-sheet
     -> .platform-menu-grid
        -> Team
        -> Rooms
        -> Fortschritt
        -> Kommentare
        -> Streets
        -> Einstellungen
        -> Gebiet
```

Diese sieben Einträge sind eigenständige Launcher-Ziele. Es sollen nicht zusätzlich historische/technische Hubs ohne klaren Nutzerwert in das Grid gekippt werden.

### Vorgesehene Launcher-IDs

Bestehende IDs möglichst erhalten, neue IDs explizit ergänzen:

- `team` -> Label `Team`;
- `rooms` -> Label `Rooms`;
- `stats` -> Label `Fortschritt`;
- `comments` -> Label `Kommentare`;
- `streets` -> Label `Streets`;
- `settings` -> Label `Einstellungen`;
- `area-create` -> Label `Gebiet`.

`PlatformLauncherItem` und `buildPlatformLauncherItems()` sind die Source of Truth für diese Sichtbarkeit. Nicht zusätzlich ein zweites statisches Menü in `TeamCenter` erzeugen.

### Team

`Team` ist Team-Identität/Management, nicht ein Container für andere Apps.

Zielinhalt:

- aktives Team sichtbar;
- Team wechseln, soweit Role/Scope erlaubt;
- Organizer/Admin kann bestehendes Team-Management öffnen;
- Name/Farbe/Team-Lifecycle bleiben in der bestehenden Team-Management-Logik;
- eine kleine, nicht interaktive Zusammenfassung des aktiven Teams ist zulässig;
- **kein** `Rooms`, `Fortschritt` oder `Kommentare` Tab im Team-Hub.

Die bestehende `TeamHub.tsx -> TeamCenter` Compatibility-Reexport-Struktur wird aufgelöst. Der Implementation-Agent soll entweder `TeamHub` zu einem echten fokussierten Team-Hub machen oder einen klar benannten Team-Hub einführen und die Compatibility-Schicht entfernen. Keine weitere Alias-Kaskade.

### Rooms

Neue fokussierte Oberfläche, empfohlener Identifier `RoomsHub` in `src/team/RoomsHub.tsx`.

Sie übernimmt aus `TeamCenter` ausschließlich Room-Funktionalität:

- `Room beitreten`;
- `Room erstellen`;
- `Aktive unterwegs`;
- Room-Detail;
- Participant count;
- `Online anzeigen` / verborgen;
- aktive Mitglieder;
- Join-Zugang anzeigen/rotieren/sperren;
- Room beenden/verlassen.

Kein Team-Stats-/Comment-Tab in `RoomsHub`.

### Fortschritt

Eigenständiger Launcher-Eintrag `stats` mit Label `Fortschritt`.

Ziel ist der Fortschritt des aktiven Teams, nicht eine zweite Team-Navigation. `TeamProgressPanel.tsx` ist die naheliegende bestehende Anzeige. `StatisticsHub.tsx` darf nur wiederverwendet werden, wenn seine Campaign-/Team-Scope-Semantik exakt dem gewünschten aktiven Team entspricht. Kein Campaign-weiter Admin-Default, wenn der Nutzer explizit Team-Fortschritt erwartet.

Empfohlener fokussierter Wrapper: `TeamProgressHub`.

### Kommentare

Eigenständiger Launcher-Eintrag `comments`.

Zieloberfläche:

- standardmäßig aktuelles Team;
- optional `Alle`, nur wenn der serverseitige Zugriff dies erlaubt;
- Kommentare nach Gebiet gruppiert;
- Kontext/Street/House verständlich anzeigen;
- vorhandene `TeamCommentsSummary`-Logik wiederverwenden, nicht duplizieren;
- Server ist Source of Truth für Read/Create/Edit/Delete.

Empfohlener Identifier: `CommentsHub` unter `src/collaboration/CommentsHub.tsx`.

### Streets

Eigenständiger Launcher-Eintrag `streets` mit Label `Streets`.

Er ist jetzt bereits als echte Oberfläche vorzubereiten, aber kein erfundenes zweites Street-Backend bauen.

Erwartete erste Struktur:

- Einstieg in bestehende manuelle Street-Erstellung;
- Platz für Straßennamen-Suche;
- Platz für zukünftige Street Engine / automatische Markierung;
- vorhandene Smart-Street-/MapView-Contracts als Integrationspunkt berücksichtigen (`SMART_ROAD_*`, Smart anchors/preview, `onSmartStreetPoint`).

Empfohlener Identifier: `StreetsHub` unter `src/streets/StreetsHub.tsx`.

## Gemeinsames draggable Bottom Sheet

### Ziel

Das aktuelle Muster „jede Komponente baut eigenen Overlay/Scrollcontainer“ wird für Field-Sheets vereinheitlicht.

Empfohlener gemeinsamer Baustein: `FieldBottomSheet` unter `src/platform/FieldBottomSheet.tsx` mit zugehörigem CSS.

### Struktur

```text
FieldBottomSheet
  fixed/sticky chrome
    drag handle
    header/title
    close button
  scroll viewport
    body
  optional footer
    composer / primary actions
```

Der Drag-Handle selbst scrollt nie mit.

### Snap Points

Mindestens drei semantische Zustände:

- `compact`;
- `expanded`;
- `full` oder `near-fullscreen`.

Keine hart verdrahteten Pixelwerte pro Feature. Snap-Höhen relativ zu `visualViewport.height`/`100dvh` und Safe Areas berechnen. Beispielgrößen sind Designparameter, keine API: ungefähr 34%, 64%, 90% der verfügbaren Höhe.

### Pointer-/Touch-Verhalten

- Drag startet ausschließlich am Handle/Chrome, nicht im Content.
- Pointer Events verwenden (`pointerdown/move/up/cancel`).
- während Drag `setPointerCapture()` oder äquivalent stabil verwenden;
- `touch-action: none` nur auf der Drag-Zone, nicht auf dem scrollbaren Body;
- Content-Scroll darf den Sheet-Snap nicht verändern;
- beim Loslassen nearest snap wählen, optional Velocity berücksichtigen;
- `prefers-reduced-motion` respektieren;
- Keyboard-/Accessibility-Fallback zum Expand/Collapse behalten, also Handle nicht nur gestisch bedienbar machen.

### Scroll und Keyboard

- Header/Handle bleibt sichtbar;
- Body bekommt eigenes `overflow-y: auto`;
- `overscroll-behavior: contain`;
- Safe Area unten berücksichtigen;
- `window.visualViewport` berücksichtigen, damit mobile Browser-UI/Keyboard den Composer nicht überdecken;
- bei Comment-Sheets optionaler Footer/Composer darf nicht unter dem Keyboard verschwinden.

### Migration

Nicht alle Overlays blind gleichzeitig umschreiben. Zuerst gemeinsamer Baustein + Contract-Test, danach nacheinander:

1. `.platform-menu-sheet`;
2. Street-/Area-/House `.bottom-sheet` aus `App.tsx`;
3. Comments;
4. Settings;
5. Team;
6. Rooms/Progress/Streets-Hubs.

Nach jeder Migration prüfen, dass Map-Interaktionen hinter modalem Sheet blockiert bleiben und Scroll/Close unverändert korrekt sind.

## Street-State-Machine

### Gewünschter Erstellflow

```text
AREA_DETAIL
  -> STREET_DRAW
  -> STREET_DETAIL
  -> CLOSED/MAP
```

Nach `saveStreetTask()` ist das neu erzeugte Street-Task-Sheet der einzige sichtbare Detailkontext.

### Verbotener Flow

```text
AREA_DETAIL
  -> STREET_DRAW
  -> STREET_DETAIL over hidden AREA_DETAIL
  -> AREA_DETAIL after close
```

### Konkrete Änderung

Der Close-Handler des `sheet === "task"` Street-Sheets darf nicht mehr implizit `setSheet(selectedAreaId ? "area" : null)` ausführen.

Für den vereinbarten UX-Vertrag schließt Street-Detail auf die Karte:

- `setSelectedTaskId(null)`;
- `setSheet(null)`;
- `selectedAreaId` darf intern als Kontext erhalten bleiben, darf aber kein Area-Sheet automatisch anzeigen.

Statusänderungen `open`, `completed`, `later`, `not-deliverable` beeinflussen diesen Rückweg nicht.

Wenn später ein expliziter „Zurück zum Gebiet“-Button gewünscht wird, muss das eine sichtbare Nutzeraktion sein, kein versteckter Parent-Sheet-Stack.

Regressionstests müssen mindestens abdecken:

- Area -> Street draw -> Save -> Street detail;
- Street status ändern -> Close -> Map, kein Area-Sheet;
- Street detail direkt von Map geöffnet -> Close -> Map;
- erneutes bewusstes Antippen eines Areas öffnet Area-Sheet wieder.

## Kommentare auf Mobil

`CommentsContextPanel` bleibt initial collapsed.

Beim Expandieren:

- Kommentar-Liste scrollt im Body;
- Composer bleibt erreichbar;
- viele Kommentare dürfen den Composer nicht unter den Viewport drücken;
- bei geöffneter Software-Tastatur bleibt das Texteingabefeld plus Submit-Aktion sichtbar oder durch `scrollIntoView`/Viewport-Anpassung zuverlässig erreichbar;
- Safe Area/Browser Bottom Bar berücksichtigen;
- kein nested-scroll deadlock zwischen `.comments-context-submenu` und Sheet-Root.

Akzeptanzgerät: mobile Chromium ungefähr 390x844 plus ein schmalerer Viewport; echte Browser-Bottom-Bar/Keyboard-Situation testen, nicht nur Desktop responsive mode.

## Rooms: Discoverability und Manager-Liste

`Online anzeigen` ist **nur** `discoverable`.

Serververtrag:

- Room wird bei `discoverable=false` vollständig erstellt;
- Room Code funktioniert;
- QR Join funktioniert;
- direkter Join funktioniert;
- Hard expiry/close/revoke bleiben unverändert;
- ein Manager muss seinen eigenen aktiven versteckten Room weiterhin in der Management-Liste sehen können.

Aktuell verwendet `worker/fieldGroups.ts -> listGroups()` für Nicht-Member `listDiscoverableGroups()`, also ausschließlich `g.discoverable = 1`. Das ist für Manager-Verwaltung falsch.

Ziel-Query/Semantik:

- `admin`: alle aktiven Campaign-Rooms verwaltbar/auflistbar, unabhängig `discoverable`;
- `team-editor`: aktive Rooms seines serverseitig kanonischen Teams unabhängig `discoverable`;
- `viewer`: nur discoverable Rooms, sofern Discovery für diese Rolle weiterhin vorgesehen ist;
- `field-group-member`: nur eigener Room;
- optionaler `team`-Filter darf Scope nur verengen, nie erweitern.

Tests müssen `discoverable=false` + Manager-Liste + Code Join + QR Join abdecken.

## Rooms: aktueller Join-Zugang vs Rotation

### Semantik korrigieren

Im UI sind zwei Operationen strikt zu trennen:

1. **Join-Zugang anzeigen**
   - zeigt den aktuell gültigen Room Code, QR und Link;
   - verändert keinen Credential-State;
   - loggt niemanden aus;
   - soll der normale Wiederholungsfall sein, wenn später eine weitere Person beitreten soll.

2. **Join-Zugang erneuern**
   - explizite Rotation;
   - alter Code/QR/Link funktioniert danach nicht mehr für neue Beitritte;
   - bereits beigetretene Memberships bleiben aktiv;
   - separate Warnung/Bestätigung.

`Join sperren` bleibt separate Revocation und blockiert neue Joins, ohne bestehende Memberships zu entfernen.

### Architekturproblem: Hash-only ist nicht wiederanzeigbar

Der aktuelle akzeptierte Vertrag in `LIVE_TEAMS.md` lautet: D1 speichert nur SHA-256 Lookup-Hashes, Plaintext nur bei Issuance/Rotation. Damit kann der Server denselben bestehenden Code später mathematisch nicht wiederherstellen.

**Verboten:** zur schnellen Lösung Plaintext `roomCode`/`qrToken` in D1, RxDB, LocalStorage, IndexedDB oder Audit speichern.

### Vorgeschlagener sicherer Lösungsweg

Vor Implementation der Wiederanzeige ADR-0014/LIVE_TEAMS explizit erweitern. Bevorzugtes Design:

- Lookup-Hash bleibt für Join-Auflösung bestehen;
- nur für den aktuell gültigen Credential-Satz wird zusätzlich recoverable Material **verschlüsselt at rest** gespeichert;
- AES-GCM mit dediziertem Worker-Secret/Key, nicht mit einem Browser-Schlüssel;
- AAD bindet mindestens Campaign ID, Group ID, Credential ID und Kind;
- Manager-Reveal-Endpunkt autorisiert serverseitig über `requireManagedGroup` oder äquivalente kanonische Prüfung;
- Antwort `Cache-Control: no-store`;
- keine Secrets in Audit/Logs;
- Reveal niemals für viewer/field-group-member;
- Rotation/revoke/close/expiry invalidiert Reveal des alten Materials;
- Hard expiry bleibt unverändert;
- Secret-Key-Ausfall fail-closed;
- keine Production-Migration in diesem Auftrag.

Bevor Code geschrieben wird, Threat Model prüfen: Key lifecycle, rollback, migration existing active Rooms, corrupted ciphertext, unauthorized tenant/group selector, audit event ohne Secret.

Alternative Designs sind nur zulässig, wenn sie dieselbe Wiederanzeige ohne Plaintext-at-rest und ohne clientseitige Autorität erreichen und die Änderung dokumentiert wird.

### Tests

- Reveal current credential als Manager -> 200, gleiche Werte wiederholt;
- Reveal als fremder Team Editor -> 403;
- Reveal als viewer/member -> 403;
- Rotation -> alter Join 401/Join unavailable, neuer Join erfolgreich;
- Rotation -> bestehende Membership bleibt autorisiert;
- Revoke -> neuer Join blockiert, bestehende Membership bleibt bis normaler Membership-/Group-Lifecycle aktiv;
- close/expiry -> Reveal/Join fail-closed;
- keine Secret-Werte in DB-Dump-/Audit-Testausgaben.

## Join-/Read-only-Onboarding und Sprache

- Gruppenlink behält `#groupJoin=...` nur bis erfolgreiche Server-Redemption abgeschlossen ist.
- Einführungs-Popup erscheint **nach** erfolgreicher Redemption, nicht davor.
- Onboarding kann per versionspezifischem lokalen UI-Flag pro Gerät als gesehen markiert werden; dieses Flag ist keine Authentifizierung und enthält kein Secret.
- Link-/Join-Onboarding startet standardmäßig Deutsch.
- Read-only-Link-Onboarding ebenfalls standardmäßig Deutsch.
- Sprache kann danach über normale Einstellungen geändert werden.
- Onboarding darf Token nicht vorzeitig aus URL entfernen, rotieren oder konsumieren.

## Sync-/Serverstatus entschlacken

### Problem

Auf der Karte ist aktuell ein prominenter gesunder Status wie `Serverbestätigt`/Sync-Status sichtbar. Gesunder Zustand ist keine dauerhafte Warnung und konkurriert mit Map-Control-Fläche.

### Ziel

- Healthy/current: höchstens kleiner ruhiger Punkt/Icon, keine große Text-Pill.
- Syncing: kurzer dezenter Zustand, kein dominanter persistenter Text.
- Offline/Error/Conflict/New data: sichtbar und verständlich.
- Nutzer muss bei einem Problem erkennen können, was passiert und welche Aktion möglich ist.

Vor Änderung den exakten Renderpfad in `MapView.tsx` für `MapRefreshState` sowie `.map-refresh-control`/`.map-refresh-button` in `m4.css` lokalisieren. Nicht nur `.connection` in der Topbar ändern, wenn der Screenshot-Status aus dem Refresh-Control kommt.

Akzeptanz:

- `current` nimmt minimalen Raum ein;
- `loading` ist erkennbar, aber nicht störend;
- `error` bleibt auffällig;
- `available` bleibt mit Update-Hinweis erkennbar;
- normaler Zustand ist auf derselben linken Status-/Control-Ebene ausgerichtet, nicht als große schwebende Pill oben rechts.

## Admin/Invite-Grenze

Diese Field-UI-Arbeit vermischt keine privilegierten Organization-Einladungen mit Rooms.

- Organizer/Admin Invites: Admin-Einladungsoberfläche / Organization Security Runtime.
- Room Join: `RoomsHub` / Field Group Credentials.
- Team Read-only Sharing: nur nach echtem serverseitigem Team-Scope; niemals Campaign-weiten Viewer-Link als angeblichen Team-Link ausgeben.

## Brainrot-Invariante

Der aus `fun/menu-hold-xxl-runner` übernommene Fun-Mode bleibt unabhängig von der Launcher-Neustruktur:

- Target `.platform-grid-button`;
- ungefähr fünf Sekunden Hold;
- nach erfolgreichem Long-Press normalen Menü-Klick unterdrücken;
- Overlay schließen/wieder öffnen funktioniert;
- Launcher-Refactor darf Event-/Pointer-Handling nicht brechen.

## Implementierungsreihenfolge

1. Remote-Head/PR/CI re-verifizieren.
2. Tests für Launcher-Vertrag hinzufügen: separate Items, keine `TeamCenter`-Tabs als primäre Navigation.
3. Shared `FieldBottomSheet` + Pointer/Snap/Accessibility-Tests.
4. `PlatformShell`/`platformContract` auf separate Launcher-Ziele umbauen.
5. Team fokussieren und Room-/Progress-/Comment-Code aus `TeamCenter` extrahieren.
6. `RoomsHub` inkl. hidden-manager-list fix und Discoverability/Join-Regressionen.
7. Credential-Reveal-Architektur als ADR-/Schema-/Server-Slice implementieren, erst nach expliziter Security-Review im selben Branch; keine Production-Migration.
8. `Fortschritt` als team-scoped Hub.
9. `Kommentare` als eigenständiger Hub + mobile composer/sheet hardening.
10. `StreetsHub` als eigener Launcher, vorhandene Street/Smart-Street Contracts anbinden ohne Future Engine vorzutäuschen.
11. Street close-state fix in `App.tsx`.
12. Server-/Sync-Indikator reduzieren.
13. Join/Read-only-Onboarding deutsch und token-safe.
14. komplette Tests/typecheck/audit/build.
15. exact-head CI.
16. isolierten Staging-Branch von exakt diesem Product-Head ableiten; keine Production-Bindings.
17. Live-Smoke/Browser: Navigation, Sheets, Street flow, comments/keyboard, Rooms on/off, code+QR, membership preservation, Brainrot.
18. D1/FK/Cleanup/State-Preservation prüfen.
19. Erst dann Testlink an Master geben.

## Testmatrix

### Launcher

- Menü öffnet über `.platform-grid-button`.
- Grid zeigt erwartete separate Items entsprechend Capability/Context.
- Team öffnet keinen Tab-Container mit Rooms/Fortschritt/Kommentare.
- Rooms/Fortschritt/Kommentare/Streets jeweils direkt aus Grid erreichbar.
- Gebiet nur wenn `canCreateArea`.
- Settings weiterhin erreichbar.
- Brainrot Long-Press öffnet Brainrot und nicht zusätzlich Menü.

### Bottom Sheets mobile

- compact -> expanded -> near-fullscreen per Handle drag.
- Content scroll lässt Snap-Höhe unverändert.
- Handle/Header bleiben sichtbar.
- Close funktioniert an jedem Snap.
- 390x844 und schmaler Viewport.
- Browser Bottom Bar + Software Keyboard.
- viele Kommentare -> Composer erreichbar.

### Street

- manuell zeichnen -> speichern -> nur Street detail.
- Status setzen -> schließen -> Map.
- kein Area-Sheet-Autoreopen.
- Area bewusst antippen -> Area-Sheet.

### Rooms

- create discoverable=true -> Room + code + QR.
- create discoverable=false -> Room + code + QR.
- Manager sieht hidden Room weiterhin.
- Code join bei visible/hidden.
- QR join bei visible/hidden.
- current credential reveal wiederholt identisch.
- Rotation ändert future join material, Membership bleibt.
- Revoke blockiert future join, Membership bleibt.
- Close/expiry blockiert join gemäß Lifecycle.

### Sync

- current healthy minimal.
- loading dezent.
- offline/error/conflict sichtbar.
- refresh/update action bleibt zugänglich.

### Security/Regression

- fremde Campaign/Team-IDs erweitern keinen Scope.
- unbekannte API fail-closed.
- Organization-/Admin-Gates unverändert.
- Production `wrangler.jsonc` Invarianten unverändert.
- kein Production-Deploy/Migration.

## Abnahmekriterien

- Primäre Field-Navigation ist `.platform-menu-grid`, nicht `.team-center-tabs`.
- Es gibt keine interne `overview|rooms|progress|comments` Primärnavigation mehr in TeamCenter.
- Team ist fokussiert auf Team-Verwaltung/Identität.
- Rooms, Fortschritt, Kommentare und Streets sind eigenständig erreichbar.
- Bottom-Sheet-Chrome bleibt beim Content-Scroll stehen und lässt sich per Handle aufziehen.
- Kommentar-Composer bleibt mobil bei vielen Kommentaren/Keyboard erreichbar.
- Street-Create-/Status-/Close-Flow endet direkt auf Map.
- `Online anzeigen` beeinflusst nur Discovery.
- Hidden Room bleibt für seinen Manager verwaltbar.
- Code/QR join visible und hidden.
- `Join-Zugang anzeigen` rotiert nichts.
- `Join-Zugang erneuern` wirft bestehende Mitglieder nicht raus.
- Room-Reveal-Lösung speichert kein Secret im Klartext und ist serverseitig autorisiert.
- Healthy sync status ist unaufdringlich; echte Fehler bleiben sichtbar.
- Brainrot Long-Press bleibt funktionsfähig.
- Tests/typecheck/audit/build grün.
- Staging-Live-Matrix grün und Datenzustand preserved.
- PR #76 bleibt Draft/unmerged.

## Dokumentation bei Implementation

Im selben Slice aktualisieren, wenn sich der Vertrag real ändert:

- `docs/context-field-ui-navigation.yaml`;
- `docs/context-organizer-admin.yaml`;
- dieser Plan;
- `docs/product/UX.md`;
- `docs/architecture/LIVE_TEAMS.md` und ADR-0014, falls recoverable Join Credentials akzeptiert werden;
- `docs/architecture/SECURITY.md`, falls neuer Credential-encryption/reveal Endpoint entsteht;
- `docs/quality/QUALITY.md` für mobile Sheet/keyboard acceptance soweit nötig;
- `docs/prompts/CONTINUE_FIELD_UI_NAVIGATION_LATEST.md`.

## Wiederaufnahme

`AGENTS.md` -> `docs/status/CURRENT.md` -> `docs/context-map.yaml` -> `docs/context-organizer-admin.yaml` -> `docs/context-field-ui-navigation.yaml` -> dieser Plan -> `docs/architecture/LIVE_TEAMS.md` -> UX/MAP/COLLABORATION/SECURITY/QUALITY -> aktueller Remote-Head/CI.
