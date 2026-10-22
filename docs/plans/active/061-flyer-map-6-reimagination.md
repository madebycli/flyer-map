---
status: gilt (Entwurf des Architekten, Vorgaben des Eigentümers eingearbeitet)
supersedes: 060-flyermap-rs-neu-gedacht.md; ersetzt in 059-flyermap-rs.md die Meilensteine M4-Rest, M7, M8
---

# Plan 061: Flyer Map 6, neu gedacht (Rust, App-first)

Name für Endnutzer bleibt **Verteil-Flyer / Flyer Map**; intern `flyermap-rs`.

## 0. Vorgaben des Eigentümers (gelten über alles)

1. **Reimagination, keine Übersetzung.** Es wird nichts nachgebaut, weil es früher so war. Prinzipien dürfen bleiben, Code und Formate nicht.
2. **Alle Daten sind Test- und Fakedaten.** Keine Migration, keine Adapter für alte Tabellen, Links, Sitzungen oder Passwörter. Ein sauberer neuer Anfang.
3. **App-first (PWA).** Bisher: Gruppenlinks zum Bearbeiten auf einer Website. Künftig: die installierte App ist das Produkt. Ein Link ist nur noch Einladung zum Beitreten.
4. **Passkeys** als Option, **TOTP** bleibt Option. Passwort bleibt möglich, ist aber nicht der Standardweg.
5. **Alles in Rust**, TypeScript raus (außer MapLibre als fremdes Bauteil und ein paar Zeilen JS-Brücke).
6. **UI:** Material-3-Basis, Smart Marking und die Funktionen bleiben; der Schnellknopf für die Markiermodi und das Schnell-Einstellungsmenü waren gut; die Hauptansicht ohne offenes Menü war sauber. Schlecht waren: Menüs mit vielen Punkten, die Beschriftung „Admin / aktuelle Runs“, die **Suche**. Die Kartenbedienung ist grundsätzlich gut, soll aber ordentlich neu gebaut werden.
7. **Unverändert aus AGENTS.md:** Produktion nie anfassen (Worker `flyer-map`, D1 `flyer-map-db`), nichts deployen ohne Freigabe, nur auf `claude/rewrite-phase5-delete-legacy` und `unstable` pushen, keine Geheimnisse im Repo, Rechte entscheidet der Worker.

## 1. Leitgedanken

- **Eine Aktion ist ein Akteur.** Jede Aktion läuft als eigenes Durable Object mit eigenem SQLite: ein einziger Schreiber, dadurch keine Sequenz-Tricks in der Datenbank, Live-Push an alle Geräte über WebSocket, Skalierung pro Aktion von selbst. D1 hält nur das **Verzeichnis** (Personen, Zugänge, Mitgliedschaften, Aktionen-Index, Audit).
- **Das Gerät ist offline-first.** Der Server ist Vermittler und Schiedsrichter, nicht Voraussetzung zum Arbeiten.
- **Eine Regel, eine Stelle.** Berechtigungen sind eine reine Funktion (`flyermap-identity::decide`). Keine Rechte in SQL-Klauseln, Guards oder Wrappern.
- **Einmal typisiert.** Client und Server teilen dieselben Nachrichtentypen (`flyermap-wire`), versioniert; kein Handabgleich.
- **Karte einmal ableiten.** Der Server berechnet das Straßen-/Häusernetz einmal, binär und nach Inhalt adressiert; Geräte laden Fertiges.
- **Erweiterbar ohne Neuschreiben.** Kleine Crates mit einer Aufgabe, Schnittstellen über Traits (Speicher, Zeit, Zufall, Netz), Funktionen als Fähigkeiten statt Sonderfälle.

## 2. Fachmodell

Begriffe bleiben, weil die Nutzer sie kennen: **Organisation**, **Aktion**, **Gruppe**, **Gebiet**, **Lauf** (zeitlich begrenzter gemeinsamer Einsatz), **Abholen**.

- Gebiete haben `art: austeilen | abholen`; beide Arten bleiben getrennt (Entscheidung Plan 057). Abholen: ein Hauptgebiet mit Teilgebieten darin.
- Ein **Lauf** ersetzt „Raum/Run“: Gebiet + Zeitfenster + Personen (von Hand gezählt) + Beitritt. Er ist die Einheit für Live-Ansicht, Statistik und Planung.
- **Markierungen** (Haus/Straße) sind Register mit „letzter Schreiber gewinnt“ (HLC) wie bisher; das Prinzip ist gut und bleibt, das Format wird neu.

## 3. Identität und Rechte

**Wer:** `Person` (Konto mit Anmeldemitteln) oder `Gast` (nur ein Gerät, über Einladung).
**Anmeldemittel einer Person (alle optional kombinierbar, mindestens eins):** Passkeys (mehrere), Passwort, TOTP (zweiter Faktor, optional), Wiederherstellungscodes (optional).
**Sitzung:** genau eine Art. Undurchsichtiges Token (nur der Hash liegt im Verzeichnis), HttpOnly-Cookie, an ein Gerät gebunden (Name, zuletzt gesehen), einzeln widerrufbar. Eine Geräteliste in der App.
**Einladung:** kurzer Code (Crockford-Base32, 10 Zeichen) + QR + Link `/beitreten/<code>`. Die App löst sie **einmalig** ein und bindet sie an das Gerät; danach ist der Link tot. Parameter: Rolle, Bereich, maximale Nutzungen, Ablauf. Gegen Raten: genug Entropie, Sperre pro Gerät/IP, Suche nur über den Hash.
**Rollen als Fähigkeiten** (Menge von `Fähigkeit`), nicht als Sonderfälle:

| Rolle | Kernfähigkeiten |
| --- | --- |
| Inhaber (Organisation) | alles, Personen & Sicherheit der Organisation |
| Admin (Aktion) | Aktion verwalten, Gruppen/Gebiete/Läufe, Personen, lesen/markieren überall |
| Leitung (Gruppe) | eigene Gruppe verwalten, eigene Gebiete zeichnen, Läufe öffnen, markieren |
| Mitglied | markieren in zugewiesenen Gebieten, Notizen |
| Helfer (Abholen) | markieren im übernommenen Abhol-Gebiet |
| Zuschauer | lesen |

**Bereich (Scope):** Organisation, Aktion, Gruppe oder Gebiet; ein Grant ist `(Person/Gast, Rolle, Bereich, Ablauf, Quelle)`.
**Entscheidung:** `decide(zugriffsmenge, aktion, ressource) -> Erlaubt | Verboten(grund)`. Die Zugriffsmenge (alle Grants einer Sitzung) wird **einmal pro Anfrage** am Rand geladen; das Durable Object bekommt sie vom Edge-Worker (interner Aufruf, nicht von außen erreichbar). Sperre/Widerruf schließt offene Verbindungen.
**Prüfung ohne Altvorbild:** Eigenschaftstests (Rechte werden nie breiter, wenn man einen Grant entfernt; ein Gast kommt nie aus seinem Bereich; Ablauf wirkt), Angriffsfälle als Szenarien.

## 4. Speicher

- **Verzeichnis (D1):** `organisations`, `persons`, `credentials` (Passkey/Passwort/TOTP/Wiederherstellung), `sessions`, `devices`, `grants`, `invites`, `aktionen` (Index), `audit`. Neues Schema in `migrations6/`, kein Altbestand.
- **Aktion (Durable Object, SQLite):** `groups`, `areas`, `marks` (Register), `notes`, `runs`, `maps` (Kartenpaket-Metadaten), `log` (Operationsprotokoll mit laufender Nummer). Der Akteur nummeriert, prüft und verteilt.
- **Kartenpakete:** R2 oder DO-Speicher; Name = Inhalts-Hash (unveränderlich, ewig cachebar).

## 5. Protokoll (v6)

- HTTP für Befehle und Abfragen (typisiert, mit Seiten), **WebSocket** je Aktion für Live: Server schiebt Änderungen („Mark gesetzt“, „Lauf gestartet“, „Person online“); Client schickt Operationen. Beim Verbindungsabbruch: HTTP-Aufholen ab letzter Nummer (der Sync-Zustandsautomat `flyermap-sync` kennt das schon).
- Nachrichten im Crate `flyermap-wire::v6`, JSON zuerst (lesbar, debugbar), Umstellung auf ein Binärformat erst nach Messung.
- Fehler: stabile Codes, deutsche Texte nur im Client.

## 6. Karte und Engine

- Die Engine (Rust/Wasm) bleibt, wird aber **auf dem Server** einmal pro Gebiet/Teil ausgeführt; Ergebnis binär (bincode) + Hash. Geräte laden das Netz, rechnen nur lokal, was lokal nötig ist (Routen, Lasso, Suche).
- **Suche neu:** lokal und sofort über Straßen, Hausnummern, Gebiete, Personen, Notizen; tippfehlertolerant (Umlaute/Groß-Klein egal, Teilwörter), gruppiert, zuletzt Benutzt, Vorschau auf der Karte. Sie ist zugleich die **Befehlsleiste** („Neues Gebiet“, „Lauf starten“, „Zu Gruppe Nord“), und ersetzt lange Menüs.

## 7. Oberfläche (responsiv, ein Gesicht)

- **Handy:** Vollbildkarte mit drei Ankern: (1) **Modusknopf** (Smart Marking: Stempeln, Wischen, Strecke, Lasso) mit festem Panel, in jedem Modus gleiche Plätze; (2) **Schnellleiste** (Einstellungen, die man im Einsatz braucht: Hand, Karte, Status, Ton/Haptik); (3) **Such-/Befehlsleiste** oben. Alles andere erscheint **am Gegenstand** (Tippen auf Gebiet/Haus/Person öffnet ein Blatt mit seinen Aktionen), nicht in Menüs.
- **Tablet/Desktop:** dieselbe Karte, dazu eine feste Seitenspalte „Studio“ (Gruppen, Gebiete, Läufe, Personen, Zugänge). Dieselben Bausteine, mehr Platz, Tastatur und Zeiger voll unterstützt.
- **Live-Streifen** zeigt, wer gerade im Einsatz ist (Läufe), antippen = folgen. Statt „Admin / aktuelle Runs“.
- Design-System bleibt (Material 3, Farbrollen, 44-px-Ziele, hell/dunkel); wird als Leptos-Bibliothek `flyermap-web::ui` weitergeführt.

## 8. Crates (Ziel)

`core` (Domäne), `identity` (Rechte, Einladungen, TOTP, Passkeys, Tokens; rein), `aktion` (der Akteur: Zustandsautomat über Speicher-Trait), `wire` (Nachrichten v6), `sync` (Geräteseite), `pack` (Kartendaten), `engine` (Wasm), `area` (Zeichnen), `diag`, `server` (Edge-Worker + DO-Hüllen; dünn), `web` (App).
Regeln wie Plan 059: Dateien ≤300 Zeilen (hart 500), `unsafe` verboten außer Engine, Diagnose von Anfang an.
Das bestehende `flyermap-worker` (/api/v5) bleibt als Brücke, bis die Rust-App die TypeScript-App ersetzt; danach wird es gelöscht.

## 9. Reihenfolge

1. `flyermap-identity` (rein, testbar) und Verzeichnis-Schema mit Anmelden/Einladen/Sitzungen/Geräte.
2. `flyermap-aktion` (Akteur: Gruppen, Gebiete, Markierungen, Läufe) mit nativen Tests; danach die DO-Hülle mit WebSocket.
3. Server-seitige Kartenableitung, binär, adressiert.
4. Rust-App: Karte, Store/Sync (Live), Marker-Panel, Such-/Befehlsleiste, Studio.
5. Umschalten: TypeScript-App und Altcode löschen (nach Freigabe des Eigentümers; Unstable zuerst).

## 10. Beweise

Eigenschaftstests (Rechte, Sync-Konvergenz, Ableitung wiederholbar), Szenario-Tests je Rolle, Messwerte auf der 51k-Häuser-Aktion, Browser-Abläufe (Headless-Chromium; echte Geräte erst nach Deployment auf Unstable).

## 11. Stand: Schritt 2, der Akteur (Branch `rs-aktion`)

**Fertig und geprüft:** `flyermap-protocol` (Protokoll v6 als reine Typen) und `flyermap-aktion` (der Akteur als Zustandsautomat über einen schmalen, synchronen SQL-Trait; keine Uhr, kein Zufall, kein I/O außer über den Trait).

- **Befehle:** Markierungen (Register, neuester Stempel gewinnt), Notizen, Gruppen, Gebiete (Austeilen/Abholen, Haupt- und Teilgebiete, Überlappung und Lage geprüft mit `flyermap-area`), Abholen/Zurückgeben, Läufe (Treffer werden aus den Markierungen im Zeitfenster gezählt, nie aufaddiert), Aufräumen verwaister Markierungen (nur nach Bestätigung der Zahlen), Übergabe von Markierungen zwischen Gebieten. Jeder Befehl geschieht ganz oder gar nicht; derselbe Befehl (Aufrufer + Befehls-Id) zweimal geschieht einmal und bekommt dieselbe Antwort.
- **Lesen:** Snapshot, Seiten für Markierungen und Notizen, Aufholen ab einer Nummer (`Resync`, wenn das Gerät hinter der verdichteten Stelle oder vor dem Kopf liegt). Alles wird je Aufrufer zugeschnitten, ausschließlich über `flyermap-identity::decide`; in keiner SQL-Klausel steht eine Rechteregel. `Audience` schneidet denselben Zuschnitt für den Live-Strom (Host: WebSocket).
- **Beweise:** Szenario-Tests je Rolle und Angriff, Fehlerinjektion an jeder Stelle jedes Befehlstyps (nichts bleibt halb zurück, der Wiederholversuch gelingt), Wiedergabe des Protokolls ergibt dieselben Tabellen, Eigenschaftstests über 2 x 120 Zufallsverläufe zu je 120 Befehlen (Invarianten nach jedem Befehl, niemand verursacht Einträge ohne Recht, Wiederholung, Geräte aus Snapshot + Seiten + Aufholen bzw. Live-Strom enden bei dem, was die Rechte erlauben, mit und ohne Verdichtung). Bewusst eingesetzte Fehler (fehlende Rechteprüfung, fehlende Übergabe-Meldung) werden gefunden.
- **Messung** (51 000 Häuser in 102 Stapeln, nativ, SQLite im Speicher): 18 µs je Haus, Stapel zu 500 im Median 8,7 ms (99 %: 16 ms); Snapshot 0,15 ms; alle Markierungen in Seiten zu 1000: 52 ms; 12 MB Speicher mit 50 000 Protokolleinträgen. Reproduzierbar mit `cargo run --release -p flyermap-aktion --example measure`.

**Entscheidungen, die man kennen muss:**

1. Jeder Eintrag betrifft genau ein Gebiet (oder eine Gruppe), damit "wer erfährt es" eine einzige Frage an eine einzige Sache ist. Eine Übergabe zwischen zwei Gebieten sind deshalb zwei Arten von Einträgen: `MarkSet`/`NoteSet` im neuen Gebiet und `HandedOver` im alten. Ohne Letzteres behielten die Leser des alten Gebiets die Markierungen für immer (vom Eigenschaftstest gefunden).
2. Der SQL-Trait kennt kein `PRAGMA`, `BEGIN`, `SAVEPOINT`, höchstens 100 Parameter je Anweisung, Zahlen unter 2^53 und keine Zeilenzählung: so läuft dasselbe SQL im Durable Object. Der native Host (`RusqliteSql`, Feature `sqlite`) hat zusätzlich Fehlerinjektion für Tests.
3. Wer wann was darf, ändert sich nur durch Grants, nicht durch den Akteur. Ändert sich das Recht eines Aufrufers (Grant endet, Gebiet wird einer anderen Gruppe gegeben), sieht er die Einträge nicht, die ihm etwas entziehen: der Host schickt ihm dann einen neuen Snapshot (siehe Kopf von `flyermap-protocol/src/change.rs`). Der Eigenschaftstest vermeidet solche Wechsel bewusst.
4. `Collected` und `Released` tragen keine Revision; Geräte wenden Einträge deshalb in Reihenfolge der Nummer an und überspringen, was sie schon haben.

**Offen (nächste Schritte):**

- Durable-Object-Hülle: WebSocket (`Subscribe`, Anwesenheit, Ping), `Audience` je Verbindung, Alarm für `Aktion::compact`, Wiederaufnahme nach Neustart, `Sql` über `ctx.storage.sql`.
- Edge-Worker: Zugriffsmenge einmal je Anfrage laden und dem Akteur übergeben; Verbindungen schließen bei Sperre/Widerruf (Entscheidung 3).
- Der Host vergibt die Zugriffe, die der Akteur nur ankündigt: ein Grant am Gebiet bei `Collected` (endet bei `Released`), Gast-Zugang für einen Lauf mit `Join::Link` (endet bei `LaufEnded`).
- Geräteseite: `flyermap-sync` auf Protokoll v6 (Snapshot, Seiten, Aufholen, Live) und `flyermap-wire`-Abbildung; die Testklasse `Mirror` in `crates/flyermap-aktion/tests/support/mirror.rs` ist eine Vorlage dafür.
- Verzeichnis (D1) und Kartenableitung (Schritte 1 und 3) sind davon unberührt.
