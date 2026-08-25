# Prompt — Start Full Platform Expansion

Use this prompt for a fresh AI coding chat that should continue Verteil-Flyer and begin the larger platform expansion.

```text
Du arbeitest am GitHub-Projekt `madebycli/flyer-map` (Verteil-Flyer).

Das Repository ist die einzige Source of Truth. Verlasse dich nicht auf alte Chat-Erinnerungen, wenn das Repository etwas anderes sagt.

WICHTIG: Verteil-Flyer ist aktuell eine normale Mobile-First-WEBSITE.
Keine native App.
Keine installierbare PWA.
Kein Service Worker.
Kein Web-App-Manifest-Installationsflow.
Kein Background Sync API.
Eine Änderung daran braucht eine neue akzeptierte ADR.

BEVOR DU ETWAS ÄNDERST

1. Lies `AGENTS.md` vollständig.
2. Lies `docs/status/CURRENT.md` vollständig.
3. Lies `docs/context-map.yaml` vollständig.
4. Lies `docs/product/ROADMAP.md`.
5. Lies `docs/plans/active/012-platform-app-expansion.md` vollständig.
6. Prüfe anhand des Context-Graphs die relevanten Architektur-Dokumente. Für den großen Ausbau sind insbesondere wichtig:
   - `docs/architecture/SECURITY.md`
   - `docs/architecture/IDENTITY_PERMISSIONS.md`
   - `docs/architecture/LIVE_TEAMS.md`
   - `docs/architecture/ORGANIZATIONS.md`
   - `docs/architecture/COLLABORATION.md`
   - `docs/architecture/MAP.md`
   - `docs/architecture/OFFLINE_SYNC.md`
7. Prüfe relevante akzeptierte ADRs.
8. Prüfe aktuellen `main`, offene PRs, Branches, letzte CI-Läufe und Preview/Production-Stand.
9. Wenn Doku und aktueller PR/Code widersprechen, ermittle den beabsichtigten aktuellen Stand und korrigiere stale Doku im selben Slice.

ARBEITSWEISE

- Plane nicht nur, sondern setze direkt um, sobald der nächste sichere Slice klar ist.
- Stoppe nur, wenn eine echte externe Aktion des Users nötig ist.
- Arbeite in kleinen reviewbaren Commits/PRs.
- Keine parallelen Ersatz-Slices erzeugen, wenn bereits Branch/PR/Plan existiert.
- Neue D1-Änderungen nur als additive Migrationen.
- Keine Secrets, Passwörter, TOTP-Secrets, Access Links oder private Campaign-Daten anfordern/committen.
- Authorization immer serverseitig im Worker.
- Context-Graph und `CURRENT.md` bei relevanten Änderungen aktuell halten.

AKTUELLER FOUNDATION-STAND

M4 Renderer/Access-Recovery ist bereits auf `main`.

M5 resiliente Mutation-Synchronisierung wurde bereits gestartet:
- Draft PR #24
- Branch `m5-resilient-sync-mainline`

ERSTELLE KEINEN ZWEITEN M5-BRANCH.

Prüfe PR #24 und `CURRENT.md`, bevor du entscheidest, was noch offen ist. M5 muss sauber abgeschlossen/merged werden, bevor darauf aufbauende Live-Collaboration/Session-/Admin-Slices produktiv weiterentwickelt werden.

Der Max-Zoom-Fehler der CARTO-Basemap wurde auf dem M5-Branch bereits gefunden und mit einem minimalen Layer-Maxzoom-Fix korrigiert; realer Browser-Test auf einer Worker-Version-Preview bestätigte, dass die Basemap am maximalen Zoom sichtbar bleibt. Prüfe Repo/PR für den aktuellen dokumentierten Stand, statt das aus diesem Prompt blind zu übernehmen.

WICHTIGE OFFLINE-GRENZE

Ein echter kompletter Cold-Reload ohne Internet kann unter der aktuellen Website-only-Architektur Chrome's normale Offline/Dino-Seite zeigen, bevor die App lädt. Das ist nicht als Userfehler zu behandeln.

`docs/plans/active/011-offline-map-area.md` beschreibt den geplanten vorbereiteten ~3-km-Offline-Kartenbereich. Dieser soll keinen Service Worker voraussetzen und garantiert unter der aktuellen Architektur keinen Cold-Offline-App-Start.

PRODUKTZIEL

Verteil-Flyer soll von einer Flyer-Karte zu einer echten sicheren Feld- und Admin-Plattform wachsen.

KERNKONZEPTE

Unterscheide sauber:
- Organization = oberster Mandant/Tenant
- Campaign/Aktion = konkrete Verteil-/Sammelaktion
- Team = dauerhaftes farbiges Campaign-Team
- Field Group/Einsatzgruppe = temporäre aktuell arbeitende Gruppe innerhalb eines Teams
- Field Session/Einsatz = ein konkreter Einsatz mit Datum/Dauer/Personen/erledigter Arbeit
- Distribution Task = Flyer-Straße/Haus
- Pickup Task = spätere Kleidersammlungs-Abholung

Verwechsle dauerhaftes Team und temporäre Einsatzgruppe NICHT.

AUSBAUREIHENFOLGE

1. M5 fertigstellen und mergen.
2. M5.5 vorbereiteten Offline-Kartenbereich / Map-Daten-Pipeline entscheiden.
3. M6 Smart Streets + Houses mit echten OSM/OSM-derived Geometrien.
4. M6.5 Collection/Pickup Mode für die spätere Kleidersammlung.
5. M7 Field Sessions + Live Field Groups + Kommentare/Activity/Automationen.
6. M8 Organizations + Accounts + Permissions + Desktop Admin.
7. M9 Stats + App-like Navigation + Support/Feedback + Appearance.
8. M10 Security/Field Hardening/Release.

Wenn ein kleinerer unabhängiger UX-Slice früher sinnvoll und sicher ist, darf er vorgezogen werden, solange er keine noch unentschiedene Security/Data-Architektur vorwegnimmt.

MOBILE FIELD UI — ZIELBILD

Die Karte bleibt Home-Screen.

Untere Leiste langfristig:
- kleiner/ruhiger;
- Einstellungen nur noch Zahnrad-Icon;
- Teams-Button mit vertrautem Personen/Team/Kontakte-Symbol;
- Teams rechtsbündig im rechten Control-Cluster;
- neuer Menu/App-Button rechts.

Der Menu/App-Button öffnet eine Fullscreen-App-Ansicht mit app-artigen Modulen, z. B.:
- Progress
- Teams / Team beitreten
- Activity / Kommentare
- Collection
- Support / Feedback
- Settings
- Admin (nur wenn berechtigt)

Animation ist erlaubt, aber kurz, performant und `prefers-reduced-motion` respektieren. Keine große Animation-Library ohne Bedarf.

Wenn jemand aktiv in einem Team/einer Einsatzgruppe unterwegs ist:
- oben dezent Teamname nahe Menu anzeigen;
- alte dauerhaft sichtbare Team-Dropdown-Auswahl soll weg;
- kleine dezente Progress-Bar oben/in der Topbar;
- Teamwechsel nur über bewussten Teams-/Detail-Flow.

STATISTIK / PROGRESS

Baue langfristig Progress-Anzeigen mit Prozent und Lade-/Fortschrittsbalken für:
- Campaign
- Team
- Area
- optional Field Session

Zeige außerdem:
- erledigt / gesamt
- offen
- wie oft dieses Team unterwegs war
- Einsatz-Historie
- Dauer pro Einsatz
- Anzahl Personen
- optional Notiz
- Person-Time = Dauer × Personen

WICHTIG: Prozent-Denominator muss klar sein. Straßen und Häuser niemals ohne definierte Regel in einen irreführenden Prozentwert mischen.

FIELD SESSION / EINSATZ

Ein Einsatz soll speichern können:
- Datum
- Dauer bzw. Start/Ende
- Personenanzahl
- optional Notiz
- zugehöriges Team / Einsatzgruppe
- erledigte/geänderte Task-IDs bzw. Domain Events

Wenn man einen vergangenen Einsatz auswählt, sollen die damals bearbeiteten/erledigten Straßen/Häuser auf der Karte hervorgehoben werden können.

NICHT über GPS-Route ableiten. Nutze Domain Events / Task-Beziehungen.

TEAMS

Team-Erstellung soll langfristig unterstützen:
- Name
- Farbe
- optional Datum
- Team-spezifische Invite-/Access-Einstellungen

Farb-Presets zuerst in genau dieser Reihenfolge:
1. Orange
2. Blau
3. Grün
4. Rot
5. Grau

Danach weitere gut unterscheidbare Farben.

Team löschen fehlt aktuell und muss später sicher ergänzt werden.
Vor Implementierung entscheiden:
- archivieren vs. hart löschen
- was passiert mit Areas, Tasks, Sessions, Kommentaren, Invites und Statistiken
- historische Daten möglichst nicht unbeabsichtigt zerstören
- serverseitige Berechtigung

LIVE FIELD GROUPS / ONLINE TEAMS

Innerhalb eines dauerhaften Teams sollen temporäre aktive Einsatzgruppen existieren.

Ziel:
- mehrere Geräte können derselben Einsatzgruppe beitreten
- QR-Code
- menschlich eingebbarer Team-/Gruppencode
- optional zusätzliches Gruppenpasswort
- aktive Einsatzgruppen können im Teams-Menü sichtbar sein
- Sichtbarkeit standardmäßig aktiviert (Opt-out beim Erstellen)
- ABER niemals öffentlich im Internet; nur für bereits autorisierte Campaign-Teilnehmer
- aktueller Fortschritt gemeinsam sichtbar

Persistent Team Invite und temporärer Field-Group-Code sind unterschiedliche Credential-Typen.
Ein QR für eine Einsatzgruppe darf niemals still einen Admin-/dauerhaften Team-Zugang enthalten.

COLLECTION / KLEIDERSAMMLUNG

Später zweiter Modus für die eigentliche Kleider-Abholung mit Autos.

- Distribution und Collection klar getrennte Modi
- echte Straßen/Häuser aus M6 wiederverwenden
- Straßenabschnitte als abgefahren/fertig markieren
- Häuser/Adressen als Pickup markieren
- telefonisch gemeldete Adressen manuell hinzufügen
- eigene Pickup-Status wie offen / abgeholt / nicht möglich / nochmal prüfen
- Collection-Progress getrennt von Flyer-Progress
- Einsatzgruppen auch im Collection-Modus

DESKTOP ADMIN PANEL

Separates desktop-first Admin Panel, nicht einfach eine riesige Karte-Sheet-Lösung.

Bereiche:
- Organizations
- Campaigns
- Teams
- Team archivieren/löschen
- Teamfarbe/Metadaten/Datum
- Areas/Zuweisungen
- Access/Invites
- Permissions
- Live Groups
- Statistics/Sessions
- Activity/Audit
- Support/Feedback
- Security/Accounts

PERMISSIONS / RECHTE

Admins sollen konfigurieren können, was andere dürfen, z. B.:
- Teams erstellen
- Team umbenennen
- Teamfarbe ändern
- Team archivieren/löschen
- Areas erstellen
- eigene Areas bearbeiten
- Areas anderer Teams bearbeiten
- Tasks/Straßen/Häuser des eigenen Teams bearbeiten
- Tasks anderer Teams bearbeiten
- Tasks löschen
- eigene/fremde Team-Invites verwalten
- Live Groups erstellen/verwalten
- Live-Sichtbarkeit ändern
- Kommentare schreiben/moderieren
- Statistiken ansehen
- Campaign Einstellungen ändern
- Rechte verwalten
- Admins verwalten

Regeln:
- deny by default
- Worker prüft serverseitig
- UI-Schalter sind nur Darstellung
- Organization-Grenze kann nie per Permission umgangen werden
- Permission-/Admin-Änderungen auditieren

Vor Umsetzung ADR für Role Templates / Capabilities erstellen.

ADMIN ACCOUNTS + 2FA — SEHR SICHER UMSETZEN

Gewünschtes Modell:
- Benutzername
- Passwort
- Authenticator-App TOTP als 2FA
- kein SMS-2FA nötig
- E-Mail nicht zwingend
- mehrere Admin-Accounts
- Admin sicher weitergeben/übertragen

VOR IMPLEMENTIERUNG zwingend ADR + Threat Model.

Security Mindestanforderungen:
- niemals Username/Passwort/Form-Input in SQL-Strings konkatenieren
- D1 ausschließlich prepared/parameterized Queries für Userinput
- SQL-/HTML-/JS-/Code-Eingaben bleiben inert data und werden nie ausgeführt
- keine Blacklist als primäre Security
- raw Passwort niemals speichern/loggen
- reviewed Password-Hashing mit unique Salt und angemessenem Cost für Runtime/Library
- keine selbst erfundene Kryptografie
- TOTP Secret kryptografisch sicher erzeugen
- TOTP Secret geschützt speichern, niemals loggen
- TOTP serverseitig prüfen, enge Zeit-Toleranz
- Login/TOTP rate limitieren
- opaque, serverseitig widerrufbare Session
- Secure/HttpOnly/SameSite Cookie
- Session Rotation wo sinnvoll
- CSRF/Origin Schutz bei authentifizierten Writes
- Output Encoding + möglichst restriktive CSP gegen XSS
- Authentifizierung ersetzt niemals Authorization
- letzten wirksamen Org-Admin nicht versehentlich löschbar machen
- Admin-/Permission-/Security-Änderungen auditieren

Lies `docs/architecture/IDENTITY_PERMISSIONS.md` vollständig bevor du Accounts/Rechte implementierst.

SUPPORT / FEEDBACK

Fullscreen-App-Menü soll später Support/Feedback enthalten:
- FAQ/Hilfe
- App-/Versionsinfo
- Feedback/Bugreport
- optional berechtigten Campaign-/Area-Kontext
- niemals automatisch Secrets, Tokens, TOTP, private Exporte oder exakte GPS-Historie anhängen

MAP / PERFORMANCE

Aktueller Renderer bleibt MapLibre 5.7.1, solange keine neue akzeptierte Entscheidung/Browser-Abnahme einen Wechsel erlaubt.

- gespeicherte Areas/Streets als persistente MapLibre GeoJSON Sources/Layers
- aktive Edit-Geometrie nur kleines SVG Overlay
- kein React/SVG-Loop über alle gespeicherten Geometrien bei jedem Pan/Zoom
- Smart Streets/Houses müssen für Whole-City-Skala geplant werden

SECURITY IST RELEASE-BLOCKING

Account-/Admin-/Permission-System niemals schnell als nur UI/Login-Form bauen.
Es braucht:
- serverseitige Tenant Isolation
- serverseitige Capability Tests
- Injection-/XSS-/CSRF-/Session-/TOTP Tests
- Rate Limit Tests
- QR/Join-Code Brute-Force/Expiry/Revocation Tests
- Audit Events
- sichere Recovery/Transfer-Strategie

NÄCHSTER KONKRETER ARBEITSSCHRITT

1. Ermittle zuerst den tatsächlichen aktuellen Status von PR #24/M5.
2. Wenn M5-Gates noch offen sind, schließe sie auf dem bestehenden Branch/PR ab und merge sauber.
3. Danach nimm den nächsten Slice gemäß `CURRENT.md`, Plan 011/012 und Roadmap.
4. Wenn du mit M8 Accounts/Permissions beginnst: STOPPE vor Implementierung zunächst für die nötige ADR/Threat-Model-Entscheidung, schreibe diese sauber ins Repo und implementiere danach direkt weiter.
5. Halte `CURRENT.md`, Context-Graph und aktive Pläne aktuell.

Gib mir nach dem initialen Lesen nur eine kurze Bestandsaufnahme und beginne anschließend direkt mit der Umsetzung. Stoppe nicht nach einer Planung, außer eine echte externe Aktion oder eine notwendige Architekturentscheidung des Users blockiert die Arbeit.
```
