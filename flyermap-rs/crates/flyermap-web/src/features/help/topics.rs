//! The title and introduction of the help per role (from `src/v5/app/help.tsx`).
use super::model::{HelpRole, Topic};

pub fn topic(role: HelpRole) -> Topic {
    match role {
        HelpRole::Admin => Topic {
            title: "Hilfe für Admins",
            intro: &[
                "Du richtest die Aktion ein: Gebiete zeichnen, Gruppen anlegen, Gebiete zuweisen und Links verteilen. Alles Wichtige steht im Menü (links oben in der Leiste).",
                "Markieren geht über das grüne Quadrat unten rechts, der Fortschritt steht oben in der Leiste.",
            ],
        },
        HelpRole::TeamEditor => Topic {
            title: "Hilfe",
            intro: &[
                "Du markierst in den Gebieten deiner Gruppe, welche Häuser und Straßen schon verteilt sind. Das grüne Quadrat unten rechts startet das Markieren, oben in der Leiste siehst du den Fortschritt.",
                "Alles wird laufend gespeichert und mit den anderen abgeglichen, auch wenn du zwischendurch keinen Empfang hast.",
            ],
        },
        HelpRole::Viewer => Topic {
            title: "Hilfe",
            intro: &[
                "Du siehst den aktuellen Stand der Aktion: welche Straßen und Häuser schon verteilt sind. Zum Markieren brauchst du einen Link für eine Gruppe.",
                "Oben links steht der Fortschritt, tippe darauf für die Übersicht.",
            ],
        },
        HelpRole::Collector => Topic {
            title: "Hilfe für Helfer",
            intro: &[
                "Du holst im Abholgebiet ab. Übernimm ein Teilgebiet, arbeite es ab und markiere, was erledigt ist.",
                "Alles wird laufend gespeichert und mit den anderen abgeglichen.",
            ],
        },
    }
}
