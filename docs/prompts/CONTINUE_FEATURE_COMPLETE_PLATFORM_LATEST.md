# Prompt - Continue Feature-Complete Platform

Use this prompt for the next fresh AI coding chat. This file is a living handoff. At the end of the work session it must be updated so the following fresh chat can continue from the exact repository state without relying on chat memory.

```text
Du arbeitest weiter am GitHub-Projekt `madebycli/flyer-map` (Verteil-Flyer / Flyer Map).

DAS REPOSITORY IST DIE EINZIGE SOURCE OF TRUTH.
Verlasse dich nicht auf alte Chat-Erinnerungen, Branch-Namen, PR-Stände oder frühere Aussagen, wenn Repository, GitHub, CI oder Cloudflare inzwischen etwas anderes zeigen.

PRODUKTBASIS

Verteil-Flyer ist eine Mobile-First normale WEBSITE.

Keine native App.
Keine installierbare PWA.
Kein Service Worker.
Kein Web-App-Manifest-Installationsflow.
Kein Background Sync API.
Keine kontinuierliche GPS-Routenaufzeichnung.

MapLibre GL JS bleibt der Kartenrenderer gemäß den akzeptierten Architekturentscheidungen, solange keine neue akzeptierte ADR etwas anderes festlegt.

WICHTIGE NEUE ARBEITSWEISE

Die weitere Entwicklung erfolgt gemäß Plan 017 FEATURE COMPLETE.

Baue nicht wieder nur Foundation, Preview, Fake-Daten oder Callback-only UI und nenne das Feature fertig.

Ein normales Produktfeature ist erst geliefert, wenn der komplette relevante Benutzerweg funktioniert:
- echte UI;
- echte gemeinsame Persistenz, wenn Shared State benötigt wird;
- Worker-seitige Autorisierung;
- M5-Queue/Idempotenz bei offline-relevanten Mutationen;
- Loading/Empty/Error/Revoked/Conflict/Retry-Zustände;
- permission-aware Navigation und Aktionen;
- Mobile/Responsive/Accessibility;
- Tests;
- Production Build und Cloudflare Preview;
- aktualisierte Doku/Context-Dateien.

Interne `?workbench=`-Routen dürfen als Entwicklungswerkzeug bestehen bleiben, zählen aber nicht als fertiges Produktfeature. Unfertige Foundation-Module sollen normalen Nutzern nicht als scheinbar fertige Launcher-Ziele angeboten werden.

BEVOR DU IRGENDETWAS ÄNDERST

1. Lies `AGENTS.md` vollständig.
2. Lies `docs/status/CURRENT.md` vollständig.
3. Lies `docs/context-map.yaml` vollständig.
4. Lies `docs/product/ROADMAP.md` vollständig.
5. Lies `docs/product/UX.md` vollständig.
6. Lies `docs/plans/active/012-platform-app-expansion.md` vollständig.
7. Lies `docs/plans/active/017-feature-complete-platform.md` vollständig.
8. Lies diesen Prompt vollständig bis zum Ende.
9. Prüfe den aktuellen Branch-/PR-Stack, insbesondere aktuell bekannte PRs #68, #70, #71 und #72. Verlasse dich nicht auf die Nummern/Heads aus diesem Prompt, wenn GitHub inzwischen weiter ist.
10. Prüfe offene PRs, deren Base-/Head-Branches, Mergeability, aktuelle Heads, CI/Checks und Cloudflare-Builds.
11. Prüfe den aktuellen Code der betroffenen UI und Runtime, nicht nur die Plan-Dokumentation.
12. Folge anschließend dem Context-Graph für die konkret betroffenen Architecture-/ADR-Dateien.

Für die unmittelbar geplante Arbeit sind insbesondere relevant:
- `docs/architecture/SECURITY.md`
- `docs/architecture/OFFLINE_SYNC.md`
- `docs/architecture/LIVE_TEAMS.md`
- `docs/architecture/COLLABORATION.md`
- `docs/architecture/IDENTITY_PERMISSIONS.md` nur wenn Rechte/Accounts betroffen sind
- `docs/decisions/ADR-0011-durable-mutation-queue-and-idempotency.md`
- `docs/decisions/ADR-0013-smart-street-house-identity.md`
- `docs/decisions/ADR-0014-live-field-group-credentials.md`
- `docs/decisions/ADR-0017-field-session-events-retention.md`

Lies vorgeschlagene ADRs vollständig, bevor du Runtime implementierst, die durch sie blockiert ist.

AKTUELLER PRODUKT-/BRANCH-KONTEXT, NUR ALS STARTPUNKT ZUM VERIFIZIEREN

Der zuletzt bekannte Stack war:
- `release-platform-integration-2026-08-26` -> Draft PR #68 gegen `main`;
- `m6-house-persistence-runtime` -> Draft PR #70 gegen Release-Branch;
- `ui-app-launcher-sheet` -> Draft PR #71 gegen House-Branch;
- `plan-feature-complete-platform` -> Draft PR #72 gegen `ui-app-launcher-sheet`.

Prüfe das neu. Wenn sich GitHub geändert hat, gilt GitHub.

Migrationen `0004_m6_task_source_provenance.sql` und `0005_m6_house_tasks.sql` sind nach zuletzt bekanntem Stand NICHT remote angewendet.

WENDE KEINE REMOTE D1-MIGRATION AN, außer der User fordert diesen Rollout ausdrücklich an.

Merge `main` nicht automatisch nur um den Stack aufzuräumen. Promotion nach `main` bleibt eine bewusste Release-Aktion. Stacked PRs untereinander dürfen nur dann integriert/retargetet werden, wenn der exakte aktuelle Zustand geprüft ist und dadurch keine ungeprüfte Release-Promotion entsteht.

VERBINDLICHES AKTUELLES MOBILE DESIGN

Die Karte bleibt Home/Arbeitsfläche.

Im normalen Browse-Zustand sitzt UNTEN LINKS eine kompakte Launcher-Leiste.
Sie enthält nur:
- 3x3 App-Grid/Menu-Button;
- direkt daneben den AKTUELLEN TEAMNAMEN ALS TEXT;
- Teamfarbe höchstens als kleinen unterstützenden Marker.

Nicht permanent in diese Leiste gehören:
- Team-Dropdown;
- Settings;
- Teamverwaltung;
- Gebiet anlegen;
- weitere Admin-/Editor-Aktionen.

Diese Aktionen gehören in permission-aware Menü-/Modul-Flows.

Das Menü ist ein kompaktes, abgerundetes Sheet in derselben visuellen Familie wie die vorhandenen Settings-/Teams-Sheets:
- große App-Icons;
- kurze Labels darunter;
- kein Fullscreen-Home-Dashboard;
- einzelne Fachmodule dürfen nach Auswahl eine volle Fachoberfläche öffnen.

Kontextuelle Area-/Street-/House-Sheets dürfen die untere Launcher-Leiste überdecken, wenn aktiv an einem Objekt gearbeitet wird.

Keine neue große UI-Framework-Abhängigkeit einführen, wenn die vorhandene React/CSS-Struktur ausreicht.

NÄCHSTER KONKRETER IMPLEMENTIERUNGSBLOCK: FC0

Beginne nach der Bestandsaufnahme direkt mit Plan 017 FC0, sofern GitHub/CURRENT nicht bereits zeigen, dass er abgeschlossen wurde.

FC0 bedeutet:

1. Mache die neue Navigation funktional vollständig.
2. Führe einen typisierten PlatformShell <-> App Action-/Navigation-Contract ein. Keine brittle DOM-query/click-Proxies auf versteckte Legacy-Buttons, wenn eine saubere Bridge möglich ist.
3. Der unten sichtbare Teamname muss aus dem tatsächlich aktiven Karten-Team stammen, nicht bloß aus dem ersten Team oder einem statischen Access-Fallback.
4. Bestehende Kernfunktionen müssen wieder erreichbar sein, ohne zurück in die permanente Leiste zu kommen:
   - Einstellungen;
   - echte Team-/Teamverwaltungsoberfläche;
   - Gebiet anlegen, sofern berechtigt.
5. `Team` darf nicht einfach ein Fake-/Workbench-Live-Group-Preview öffnen.
6. Baue das Launcher-Registry-Modell permission-aware auf.
7. Viewer dürfen keine Bearbeitungsaktionen sehen.
8. Team-/Admin-Aktionen werden nur angezeigt, wenn der aktuelle reale Access-/Capability-Stand sie erlaubt.
9. Unfertige Foundation-Module nicht als normale fertige Ziele präsentieren.
10. Bewahre Map-Interaktion, Offline-Sync und bestehende Authorisierung vollständig.

TESTE FC0 sowohl statisch als auch über die vorhandenen automatisierten Tests. Ergänze zielgerichtete Tests für:
- echten aktiven Team-Kontext;
- Settings/Team/Gebiet-Erreichbarkeit;
- Viewer-Hiding;
- keine Team->Workbench-Fehlroute;
- untere Launcher-Position und Teamname.

DANACH: FC1 TEAM HUB + LIVE FIELD GROUPS

Wenn FC0 sauber abgeschlossen und verifiziert ist, stoppe nicht nur wegen eines künstlichen Slice-Endes. Beginne direkt mit dem nächsten sicheren Teil von FC1.

Ziel ist ein echter Team Hub im aktuellen Design:
- aktuelles Team: Name/Farbe/optional Datum;
- Team wechseln, wenn Zugriff mehrere Teams erlaubt;
- Team-Fortschritt;
- aktueller Einsatz / aktuelle Field Group;
- aktive Online-Gruppen in der aktuellen Aktion;
- Team-Filter;
- Verwaltungsaktionen nur bei Berechtigung.

Trenne sichtbar und im Domain-Modell:
- Team = dauerhaftes Campaign-Team;
- Field Group / Einsatzgruppe = temporäre Gruppe für genau eine Tour.

FIELD GROUP FEATURE-COMPLETE ZIEL

Eine berechtigte Person soll später end-to-end können:
- Gruppe im erlaubten Team erstellen;
- Label setzen;
- `online anzeigen` standardmäßig aktiv lassen oder deaktivieren;
- Room Code erhalten;
- QR anzeigen;
- Teilnehmerzahl setzen/ändern;
- andere Geräte per Code/QR beitreten lassen;
- aktive Gruppe und Fortschritt sehen;
- Gruppe manuell schließen;
- nach spätestens 24h automatisch als nicht mehr joinbar behandeln;
- finale Teilnehmerzahl beim Schließen speichern;
- daraus eine Field Session abschließen.

Discovery:
- Standard `Alle in der Aktion`;
- optional Teamfilter;
- nur aktive discoverable Gruppen;
- niemals Join-Secrets in Listenantworten.

Security:
- QR/Room Code dürfen niemals persistenten Admin-/Campaign-Zugang enthalten;
- temporäre Membership darf nie Admin/Organizer/Teamverwaltung grant-en;
- keine Client-only Authorization;
- keine Join-Secrets in Logs;
- Revocation/Close/Expiry serverseitig prüfen;
- neuer Join benötigt Online-Worker-Redemption;
- bereits autorisierte Offline-Arbeit darf die M5-Queue nutzen, muss nach Reconnect bei revoked/closed/expired sichtbar blockiert werden.

ADR-0014 IST NOCH EIN GATE

Implementiere keine echte Field-Group-Credential-/Membership-Runtime, solange ADR-0014 nach Repository-Stand noch `proposed` ist.

Wenn sie noch proposed ist:
1. lies sie vollständig;
2. schließe die noch offenen Entscheidungen sauber im Repo;
3. prüfe Security-Auswirkungen;
4. setze den ADR-Status erst auf accepted, wenn die Entscheidung vollständig und intern konsistent ist;
5. beginne danach direkt mit der Runtime, ohne einen weiteren Chat nur für Planung zu verschwenden.

Plan-017-Empfehlungen für die offenen Punkte, sofern aktuelle Repo-Diskussion nichts Gegenteiliges festgelegt hat:
- 10-stelliger human-safe Base32 Room Code;
- separater QR-Token mit >=128 Bit Entropie;
- Credential-Rotation verlängert niemals die ursprüngliche 24h-Frist;
- temporäre Standardrechte enger als persistenter Team Member;
- keine Team-/Gebiets-/Invite-/Admin-Verwaltung für temporäre Gruppenmitglieder;
- Route- und codebezogene Rate Limits;
- generische Invalid/Expired-Fehler;
- secret-freie Audit Events.

Optionales Gruppenpasswort ist kein Blocker für die erste Feature-Complete-Version, solange Code + QR vollständig und sicher funktionieren.

ADR-0017 / FIELD SESSIONS

Wenn FC1 an den Punkt kommt, an dem dauerhafte Field Sessions/Events nötig werden, prüfe ADR-0017.

Implementiere keine dauerhafte Event-/Session-Historie auf Basis einer weiterhin `proposed` ADR.

Falls noch proposed:
- finale Archive-vs-Permanent-Delete-Semantik für retained operational history festlegen;
- Comment Edit/Delete Event-Semantik festlegen, soweit für den aktuellen Slice nötig;
- Security/Audit-Retention sauber abgrenzen;
- danach akzeptieren und direkt weiterimplementieren.

Feature-Ziel:
- echte Field Sessions;
- Start/Ende bzw. Dauer;
- Teilnehmerzahl;
- optionale Notiz;
- Task-/Domain-Event-Bezug;
- Person-Time;
- Session-Historie;
- späteres Map-Highlighting über Task/Event-Beziehungen, NICHT über GPS-Trails.

WICHTIGE SECURITY-GATES FÜR SPÄTER

Nicht vorzeitig implementieren:
- Organization Account/Password/TOTP/Account-Session Runtime vor accepted ADR-0015 + Threat Model;
- configurable Capability Runtime vor accepted ADR-0016;
- Action/Templates/Analytics Persistence vor accepted ADR-0018;
- Service Worker/PWA/Background Sync;
- continuous GPS tracking.

Wenn du im aktuellen Chat an einen dieser Blöcke kommst, schließe die notwendige ADR/Threat-Model-Entscheidung im Repo vollständig und arbeite danach weiter, statt eine unsichere Abkürzung zu bauen.

QUALITÄT / RELEASE GATES

Bevor du einen Implementierungsstand als fertig meldest:
- Tests grün;
- TypeScript strict/grün;
- High-Severity Dependency Audit grün;
- Production Build grün;
- relevante Security-Negativtests grün;
- Cloudflare Workers Build/Preview grün;
- exakten finalen Branch-/PR-Head verifizieren.

Bei Map-/House-/Live-Group-/Permission-Arbeit gezielte Regressionstests ergänzen.

Keine Remote-D1-Migration ohne ausdrücklichen User-Auftrag.

ARBEITSWEISE IM CHAT

- Gib nach dem initialen Lesen nur eine kurze Bestandsaufnahme und beginne direkt mit der Umsetzung.
- Stoppe nicht nach einer Planung, wenn du im aktuellen Chat sicher weiterarbeiten kannst.
- Frage nicht nach Dingen, die Repository/GitHub selbst beantworten können.
- Erstelle keinen Ersatz-Branch für bereits vorhandene Arbeit.
- Halte PR-Stack sauber; vermeide eine neue Kette aus rein experimentellen Workbench-PRs.
- Vertikal feature complete bedeutet nicht einen riesigen unreviewbaren Commit: nutze kleine reviewbare Commits/PRs, aber behalte den kompletten Nutzerweg als Ziel.
- Stale Doku im selben Arbeitsgang korrigieren.

ZWINGENDE HANDOFF-ARBEIT AM ENDE DIESES CHATS

Beende den Entwicklungs-Chat NICHT, ohne den Repository-Handoff auf den exakten finalen Stand zu bringen.

Am Ende MUSST du:

1. `docs/status/CURRENT.md` aktualisieren:
   - exakter aktueller Produktstand;
   - was wirklich feature complete ist;
   - was noch Foundation/blocked ist;
   - aktuelle Branches/PRs;
   - Migrationsstatus;
   - Security-/ADR-Gates;
   - exakter nächster Arbeitsschritt.

2. `docs/context-map.yaml` aktualisieren:
   - neue/abgeschlossene Pläne;
   - neue relevante ADRs/Architecture-Nodes;
   - korrekte Statuswerte;
   - sinnvolle `load_when`-Topics;
   - Kanten für Abhängigkeiten/Implementierung/Validierung.

3. Relevante Product-/Architecture-/Plan-Dateien aktualisieren, wenn der tatsächliche Code/Produktstand sie verändert hat.

4. Aktive Slice-Pläne abschließen und nach `docs/plans/completed/` verschieben, wenn ihre Akzeptanz wirklich erfüllt ist. Nicht erfüllte Arbeit nicht künstlich als completed markieren.

5. DIESE DATEI aktualisieren:
   `docs/prompts/CONTINUE_FEATURE_COMPLETE_PLATFORM_LATEST.md`

   Schreibe sie am Ende vollständig für den DARAUFFOLGENDEN frischen Chat neu.

   Der neue Prompt muss enthalten:
   - Repository als Source of Truth;
   - genaue Start-Lesereihenfolge;
   - aktuelle Branch-/PR-Struktur und exakte Heads, soweit nützlich;
   - was in diesem Chat implementiert/merged/retargetet wurde;
   - aktuelle CI-/Cloudflare-Verifikation;
   - remote D1-Migrationsstatus;
   - weiterhin geltende Website-/Security-Grenzen;
   - aktuelles verbindliches Mobile-Design;
   - offene ADR-Gates;
   - exakten nächsten Feature-Complete-Arbeitsschritt;
   - Warnungen vor bekannten Fallen/Regressionen;
   - wiederum dieselbe Pflicht, am Ende Context-Dateien und den nächsten Latest-Prompt zu aktualisieren.

6. Prüfe nach diesen Doku-/Prompt-Commits den FINALEN exakten Head erneut. Dokumentiere keine grünen Checks für einen älteren Zwischen-Head als wären sie für den finalen Head.

7. Wenn der finale Head neue CI/Cloudflare-Checks auslöst, prüfe deren echten Status. Wenn GitHub noch keinen Run erzeugt hat, sage das ausdrücklich statt einen alten grünen Run als final auszugeben.

ABSCHLUSSANTWORT AN DEN USER

Kurz und konkret berichten:
- was wirklich umgesetzt wurde;
- Branch/PR und finaler Head;
- welche Checks auf genau diesem Head grün sind bzw. noch nicht gestartet wurden;
- Preview, wenn vorhanden;
- was als Nächstes im neu geschriebenen Latest-Prompt steht.

Das Ziel des Chats ist nicht, möglichst viele Foundation-Dateien zu erzeugen. Das Ziel ist, den nächsten realen Benutzerweg so weit wie sicher möglich FEATURE COMPLETE zu machen und einen präzisen Repository-Handoff für den nächsten Chat zu hinterlassen.
```
