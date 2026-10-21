//! The questions and answers of the help (generated once from `src/v5/app/help.tsx`; same wording). `roles` limits who sees an entry.
use super::model::{Entry, HelpRole};

pub const ENTRIES: &[Entry] = &[
    Entry {
        q: "Wie markiere ich eine Strecke?",
        tags: "strecke straße smart marking",
        roles: Some(&[HelpRole::Admin, HelpRole::TeamEditor]),
        a: &[
            "Tippe auf das grüne Quadrat unten rechts. Tippe dann auf der Karte die Straße an, bei der du anfängst, und danach die Straße, bei der du aufhörst.",
            "Alles dazwischen wird gewählt. Mit dem Haken bestätigst du, danach wählst du den Status. Danach ist der Markier-Modus wieder aus.",
        ],
    },
    Entry {
        q: "Wie markiere ich einzelne Häuser?",
        tags: "haus häuser einzeln",
        roles: Some(&[HelpRole::Admin, HelpRole::TeamEditor]),
        a: &[
            "Im Markier-Modus tippst du die Häuser einfach an, jedes Haus kommt dazu. Ein zweiter Tipp nimmt es wieder heraus. Mit dem Haken bestätigst du und wählst den Status.",
            "Straße und Häuser lassen sich mischen: erst die Strecke, dann noch ein paar Häuser dazu.",
        ],
    },
    Entry {
        q: "Wie markiere ich viele auf einmal?",
        tags: "wischen lasso tippen modus",
        roles: Some(&[HelpRole::Admin, HelpRole::TeamEditor]),
        a: &[
            "Halte das grüne Quadrat gedrückt (oder tippe im Panel auf die Zahl). Dort wählst du „Wischen“ (wie ein Textmarker: du malst einen durchscheinenden Strich, alles darunter wird markiert; die Breite stellst du dort um), „Lasso“ (einen Bereich umkreisen) oder „Tippen“ (ein Tipp, ein Haus).",
            "Bei diesen drei Modi gilt sofort der Pinsel, den du dort eingestellt hast.",
        ],
    },
    Entry {
        q: "Wie bewege ich die Karte bei „Wischen“ und „Lasso“?",
        tags: "karte bewegen ziehen zoomen halten finger wischen lasso",
        roles: Some(&[HelpRole::Admin, HelpRole::TeamEditor]),
        a: &[
            "Mit einem Finger über die Karte ziehen bewegt sie, mit zwei Fingern zoomst du, wie sonst auch. Zum Markieren legst du den Finger kurz an (ein Ring zeigt, dass es losgeht) und ziehst dann.",
            "Bei „Tippen“ und „Strecke“ gibt es nichts zu halten: Tippen markiert, Ziehen bewegt die Karte.",
        ],
    },
    Entry {
        q: "Was ist ein Raum und wie starte ich einen Run?",
        tags: "raum run runs gruppe starten personen zeit",
        roles: Some(&[HelpRole::Admin, HelpRole::TeamEditor]),
        a: &[
            "Ein Raum ist eine Etappe in einem Gebiet: ihr trefft euch, einer öffnet den Raum, die anderen kommen dazu. Menü → „Runs“ → „Raum öffnen“. Dort stellst du ein, wie viele Personen dabei sind (Schieberegler oder Zahl). Das ist Pflicht und deine Angabe: Geräte werden nie mitgezählt.",
            "Mit „Run beenden“ endet die Etappe. Zeit, Personen und geschaffte Häuser bleiben als Zahlen gespeichert, damit man das nächste Gebiet besser planen kann.",
        ],
    },
    Entry {
        q: "Wie kommen andere in den Raum?",
        tags: "raum beitreten qr link passwort offen gast",
        roles: Some(&[HelpRole::Admin, HelpRole::TeamEditor]),
        a: &[
            "Im Raum siehst du einen QR-Code und einen Link. Wer ihn öffnet, arbeitet bis zum Ende des Runs mit, aber nur in diesem Gebiet. Standard ist „Link / QR“. Du kannst auch „Nur Gruppe“, „Passwort“ oder „Offen“ wählen (offen: jede Person mit dem Link, auch aus anderen Gruppen).",
        ],
    },
    Entry {
        q: "Wo sehe ich, wie viel Zeit noch bleibt?",
        tags: "countdown zeitfenster ende frist zeit",
        roles: Some(&[HelpRole::Admin, HelpRole::TeamEditor, HelpRole::Viewer]),
        a: &[
            "Oben im Menü und in der Übersicht steht, wie lange die Aktion noch läuft, und wie die Zeit zum Fortschritt passt. Admins legen Start und Ende unter Menü → „Runs“ → „Zeitfenster der Aktion“ fest.",
        ],
    },
    Entry {
        q: "Was bedeuten die Farben?",
        tags: "farben status ausgeteilt später nicht möglich offen",
        roles: None,
        a: &[
            "Grün: Ausgeteilt, die Flyer sind eingeworfen. Gelb: Später, wird noch einmal angegangen. Rot: Nicht möglich, zum Beispiel kein Zugang oder Briefkasten nicht erreichbar. Grau: Offen, noch nicht bearbeitet.",
            "Der Fortschritt in Prozent zählt Häuser, nicht Straßen. „Nicht möglich“ zählt nicht gegen den Fortschritt.",
        ],
    },
    Entry {
        q: "Wie mache ich etwas rückgängig?",
        tags: "rückgängig zurück undo",
        roles: Some(&[HelpRole::Admin, HelpRole::TeamEditor]),
        a: &[
            "Direkt nach dem Markieren erscheint oben ein Hinweis mit einem Pfeil: ein Tipp darauf nimmt die letzte Markierung zurück.",
            "Im Markier-Modus entfernt „Zurück“ den letzten Punkt. Eine Markierung kannst du jederzeit einfach überschreiben, indem du den Status neu setzt.",
        ],
    },
    Entry {
        q: "Wie schreibe ich eine Notiz?",
        tags: "notiz notizen briefkasten flag",
        roles: Some(&[HelpRole::Admin, HelpRole::TeamEditor]),
        a: &[
            "Tippe ein Haus oder eine Straße an (nicht im Markier-Modus). Im Fenster findest du schnelle Hinweise wie „Briefkasten voll“ zum Antippen und ein Textfeld.",
            "Wo eine Notiz liegt, erscheint ein kleiner Marker auf der Karte. Tippst du ihn an, siehst du alle Notizen dort.",
        ],
    },
    Entry {
        q: "Wie lege ich Aufgaben zum Abhaken an?",
        tags: "aufgabe aufgaben todo abhaken checkliste liste notiz",
        roles: Some(&[HelpRole::Admin, HelpRole::TeamEditor]),
        a: &[
            "Tippe im Notizfenster auf das Häkchen links neben dem Textfeld, schreibe die Aufgabe und sende sie. Weitere Aufgaben kommen in dieselbe Liste.",
            "Ein Tipp auf das Kästchen hakt eine Aufgabe ab, ein zweiter nimmt es zurück. Alle in der Gruppe sehen den Stand nach dem Abgleich.",
        ],
    },
    Entry {
        q: "Was ist der Fokus-Modus?",
        tags: "brainrot video fokus fenster",
        roles: Some(&[HelpRole::Admin, HelpRole::TeamEditor, HelpRole::Viewer, HelpRole::Collector]),
        a: &[
            "Halte die Menü-Taste fünf Sekunden gedrückt: ein stummes Video läuft in einem kleinen Fenster. Mit einem Finger verschiebst du es (es rastet in einer Ecke ein), mit zwei Fingern oder dem Griff unten rechts machst du es größer oder kleiner, mit dem Kreuz schließt du es.",
        ],
    },
    Entry {
        q: "Wie suche ich eine Straße oder Adresse?",
        tags: "suche suchen lupe adresse",
        roles: None,
        a: &[
            "Tippe oben auf das Suchfeld und gib einen Straßennamen oder eine Adresse ein, zum Beispiel „Hauptstr. 12“. Die Treffer erscheinen direkt darunter. Ein Treffer fliegt zur Stelle und öffnet sie; bei einer Straße wird die ganze Straße ausgewählt.",
        ],
    },
    Entry {
        q: "Wo sehe ich meinen Fortschritt?",
        tags: "fortschritt prozent übersicht",
        roles: None,
        a: &[
            "Oben rechts in der Leiste zeigt die Kapsel den Fortschritt in Prozent. Tippst du darauf, öffnet sich die Übersicht mit den Zahlen je Status und je Gebiet.",
        ],
    },
    Entry {
        q: "Was heißt „überschrieben“?",
        tags: "überschrieben konflikt warnung",
        roles: Some(&[HelpRole::Admin, HelpRole::TeamEditor]),
        a: &[
            "Wenn zwei Personen dieselbe Straße oder dasselbe Haus zur gleichen Zeit unterschiedlich markieren, gilt die neuere Markierung. Du siehst oben ein Warnsymbol mit einer Zahl.",
            "Tippe darauf: dort stehen die betroffenen Stellen. Mit dem Haken stellst du deine Version wieder her, mit „Alle so lassen“ akzeptierst du die neuen.",
        ],
    },
    Entry {
        q: "Was passiert ohne Internet?",
        tags: "offline internet empfang synchronisieren",
        roles: None,
        a: &[
            "Die App arbeitet weiter, du kannst markieren und Notizen schreiben. Die Wolke oben rechts in der Leiste zeigt, ob alles gespeichert ist. Sobald du wieder Empfang hast, gleicht sich alles von selbst ab.",
            "Lade die Seite nicht neu, solange Änderungen noch warten: sie sind auf deinem Gerät gespeichert, aber noch nicht bei den anderen.",
        ],
    },
    Entry {
        q: "Warum kann ich nichts markieren?",
        tags: "nicht markieren ansehen gebiet fremd rechte",
        roles: None,
        a: &[
            "Entweder hast du nur einen Ansichts-Zugang (das Augen-Symbol in der Leiste oben), oder das Gebiet gehört zu einer anderen Gruppe. Ein Admin kann dir einen passenden Link geben.",
        ],
    },
    Entry {
        q: "Wo bin ich auf der Karte?",
        tags: "standort gps position",
        roles: None,
        a: &[
            "Tippe rechts auf das Standort-Symbol. Dein Standort bleibt auf deinem Gerät und wird nicht gespeichert oder an andere gesendet.",
        ],
    },
    Entry {
        q: "Wie ändere ich Aussehen und Hand?",
        tags: "hell dunkel linkshand theme",
        roles: None,
        a: &[
            "Menü → „Einstellungen“: Dort wählst du Hell oder Dunkel, die Farbe der App (Material You), Rechts- oder Linkshand und ob die Straßenkarte darunter zu sehen ist. Alles gilt nur für dieses Gerät. Linkshand spiegelt die Knöpfe auf die andere Seite.",
        ],
    },
    Entry {
        q: "Wie lade ich andere ein?",
        tags: "einladen link zugang freunde",
        roles: Some(&[HelpRole::TeamEditor, HelpRole::Viewer]),
        a: &[
            "Einladungslinks erstellt eine Admin-Person. Frag sie nach einem Link für deine Gruppe (zum Mitmarkieren) oder nur zum Ansehen.",
        ],
    },
    Entry {
        q: "Wie lege ich ein Gebiet an?",
        tags: "gebiet anlegen neu zeichnen",
        roles: Some(&[HelpRole::Admin]),
        a: &[
            "Menü → Gebiete → Plus. Ziehe die Eckpunkte an die richtigen Stellen, an den Kantenmitten kannst du neue Punkte herausziehen. Gib einen Namen ein, wähle die Gruppe und bestätige mit dem Haken.",
            "Straßen und Häuser werden danach automatisch von OpenStreetMap geladen. Das dauert einen Moment, die Karte bleibt benutzbar. Große Gebiete werden in Teilen geladen, ein Hinweis zeigt den Stand.",
        ],
    },
    Entry {
        q: "Wie ändere oder lösche ich ein Gebiet?",
        tags: "gebiet ändern löschen umbenennen verschieben",
        roles: Some(&[HelpRole::Admin]),
        a: &[
            "Menü → Gebiete, dann das Gebiet antippen. Im Fenster kannst du die Eckpunkte bearbeiten, umbenennen, einer anderen Gruppe zuweisen oder löschen.",
            "Beim Löschen gehen Fortschritt und Notizen des Gebiets für alle Geräte verloren. Das lässt sich nicht rückgängig machen.",
        ],
    },
    Entry {
        q: "Wie erstelle ich Gruppen und weise Gebiete zu?",
        tags: "gruppen teams zuweisen farbe",
        roles: Some(&[HelpRole::Admin]),
        a: &[
            "Menü → Gruppen. Lege Gruppen mit Name und Farbe an. Unter „Gebiete zuweisen“ wählst du für jedes Gebiet die Gruppe. Eine Gruppe darf nur in ihren Gebieten markieren.",
        ],
    },
    Entry {
        q: "Wie lade ich Helfer ein?",
        tags: "einladen link zugang helfer gruppe ansehen",
        roles: Some(&[HelpRole::Admin]),
        a: &[
            "Menü → Zugänge. Dort erstellst du Links: für eine Gruppe (darf in deren Gebieten markieren) oder nur zum Ansehen. Schick den Link per Nachricht, die Person muss nichts installieren.",
            "Jeden Link kannst du dort auch wieder widerrufen. Er funktioniert dann sofort nicht mehr.",
        ],
    },
    Entry {
        q: "Wo sehe ich, wer was gemacht hat?",
        tags: "team aktivität wer",
        roles: Some(&[HelpRole::Admin]),
        a: &[
            "Menü → Team zeigt für jede Person, wie viele Häuser sie heute und in den letzten Tagen ausgeteilt hat und wann zuletzt etwas kam.",
        ],
    },
    Entry {
        q: "Was heißt „Kartendaten laden“?",
        tags: "kartendaten laden openstreetmap pack",
        roles: Some(&[HelpRole::Admin]),
        a: &[
            "Straßen und Häuser kommen aus OpenStreetMap und werden einmal je Gebiet geholt. Das Symbol mit dem Pfeil unter der Leiste erscheint, wenn für ein Gebiet noch Daten fehlen.",
            "Wenn die Quelle gerade überlastet ist, steht ein Hinweis da. Dann einfach etwas später nochmal tippen.",
        ],
    },
    Entry {
        q: "Wie speichere und lade ich eine Vorlage?",
        tags: "vorlage template aktion kopieren",
        roles: Some(&[HelpRole::Admin]),
        a: &[
            "Menü → „Vorlagen“: „Als Vorlage speichern“ hält Gruppen und Gebiete ohne Fortschritt als Datei fest. Mit „Vorlage laden“ legst du daraus in einer anderen Aktion alles neu an.",
        ],
    },
    Entry {
        q: "Wie entferne ich veraltete Markierungen?",
        tags: "bereinigen veraltet orphan",
        roles: Some(&[HelpRole::Admin]),
        a: &[
            "Wenn du ein Gebiet kleiner machst, bleiben Markierungen außerhalb zunächst bestehen. Tippe das Gebiet an und wähle „Veraltete Einträge bereinigen“.",
        ],
    },
    Entry {
        q: "Wie übernehme ich ein Teilgebiet?",
        tags: "abholen teilgebiet übernehmen helfer",
        roles: Some(&[HelpRole::Collector]),
        a: &[
            "Tippe in der Liste ein freies Teilgebiet an und wähle „Übernehmen“. Danach gehört es dir, bis du es abschließt oder eine Admin-Person es freigibt.",
        ],
    },
    Entry {
        q: "Was sind Sonder-Marker?",
        tags: "abholen sonder marker",
        roles: Some(&[HelpRole::Collector, HelpRole::Admin]),
        a: &[
            "Orte mit besonderen Hinweisen, zum Beispiel „bitte klingeln“. Tippe auf die Karte, schreibe den Titel und speichere. Er erscheint für alle im Abholgebiet.",
        ],
    },
];
