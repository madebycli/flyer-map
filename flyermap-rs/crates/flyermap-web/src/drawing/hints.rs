//! The words of drawing: what to do next, why a drawing does not work yet, how big it is. German, short, and always saying what to do about it. Pure.
use super::state::Kind;
use flyermap_area::DrawError;

/// What to do while nothing (or not enough) is drawn: `n` points are down, `target` is the name of the Gebiet the drawing is aimed at.
pub fn next_step(kind: Kind, n: usize, target: Option<&str>) -> String {
    let border = target.map_or_else(|| "eines Gebiets".to_string(), |t| format!("von „{t}“"));
    match (kind, n) {
        (Kind::Free, 0) => "Tippe die Ecken des neuen Gebiets nacheinander an.".into(),
        (Kind::Free, 1) => "Noch zwei Ecken, dann ist es ein Gebiet.".into(),
        (Kind::Free, _) => "Noch eine Ecke, dann ist es ein Gebiet.".into(),
        (Kind::Connect, 0) => format!("Tippe auf die Grenze {border}: dort beginnt das neue Gebiet."),
        (Kind::Extend, 0) => format!("Tippe auf die Grenze {border}: dort beginnt der neue Teil."),
        (Kind::Split, 0) => format!("Tippe auf die Grenze {border}: dort beginnt der Schnitt."),
        (Kind::Connect | Kind::Extend, _) => "Tippe die Ecken außen herum an und zum Schluss wieder auf dieselbe Grenze.".into(),
        (Kind::Split, _) => "Tippe die Linie durch das Gebiet an und zum Schluss wieder auf die Grenze.".into(),
    }
}

/// What the sentence says once the drawing works.
pub fn ready_text(kind: Kind) -> &'static str {
    match kind {
        Kind::Free | Kind::Connect => "Das passt. Lege das Gebiet an, wenn es so stimmt.",
        Kind::Extend => "Das passt. Erweitere das Gebiet, wenn es so stimmt.",
        Kind::Split => "Das passt. Teile das Gebiet, wenn es so stimmt.",
    }
}

/// The words on the confirm button.
pub fn confirm_label(kind: Kind) -> &'static str {
    match kind {
        Kind::Free | Kind::Connect => "Anlegen",
        Kind::Extend => "Erweitern",
        Kind::Split => "Teilen",
    }
}

/// The start of a drawing along a border is not on one.
pub fn start_off_border() -> String {
    "Der Anfang liegt nicht auf einer Grenze. Nimm den Punkt zurück und tippe näher an die Linie.".into()
}

/// Why the drawing cannot become a Gebiet, and what to do. `names` are the Gebiete in the order the area crate counts them.
pub fn explain(error: &DrawError, kind: Kind, names: &[String]) -> String {
    let name = |i: &usize| names.get(*i).map_or_else(|| "einem anderen Gebiet".to_string(), |n| format!("„{n}“"));
    match error {
        DrawError::TooFewPoints => "Ein Gebiet braucht mindestens drei Ecken.".into(),
        DrawError::SelfCrossing => "Die Linie kreuzt sich selbst. Nimm die letzte Ecke zurück und setze sie anders.".into(),
        DrawError::TooSmall => "Das ist winzig (unter 100 m²). Zeichne es größer oder nimm eine Ecke zurück.".into(),
        DrawError::OverlapsArea(i) => format!("Das liegt über {}. Zeichne daneben, oder beginne auf der Grenze und wähle „Anschließen“.", name(i)),
        DrawError::DifferentAreas => "Anfang und Ende müssen auf der Grenze desselben Gebiets liegen.".into(),
        DrawError::WrongSide if kind == Kind::Split => "Die Linie muss durch das Gebiet laufen, nicht außen herum.".into(),
        DrawError::WrongSide => "Die Linie verläuft innerhalb des Gebiets. Zeichne sie außen herum.".into(),
        DrawError::Empty => "Setze zwischen Anfang und Ende noch einen Punkt.".into(),
        DrawError::UnknownArea(_) => "Dieses Gebiet gibt es nicht mehr.".into(),
    }
}

/// `ca. 850 m²`, `ca. 2,4 ha`, `ca. 1.250 ha` (German separators).
pub fn area_text(m2: f64) -> String {
    if m2 < 10_000.0 {
        return format!("ca. {} m²", group(m2.round() as i64));
    }
    let ha = m2 / 10_000.0;
    if ha < 100.0 {
        format!("ca. {} ha", format!("{ha:.1}").replace('.', ","))
    } else {
        format!("ca. {} ha", group(ha.round() as i64))
    }
}

fn group(n: i64) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push('.');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_next_step_depends_on_the_kind_and_how_far_it_is() {
        assert!(next_step(Kind::Free, 0, None).contains("Ecken"));
        assert!(next_step(Kind::Free, 1, None).contains("zwei"));
        assert!(next_step(Kind::Free, 2, None).contains("eine Ecke"));
        assert!(next_step(Kind::Connect, 0, Some("Altstadt")).contains("„Altstadt“"));
        assert!(next_step(Kind::Connect, 0, None).contains("eines Gebiets"));
        assert!(next_step(Kind::Split, 3, None).contains("durch das Gebiet"));
    }

    #[test]
    fn every_error_has_a_sentence_that_says_what_to_do() {
        let names = vec!["Nordstadt".to_string()];
        for e in [
            DrawError::TooFewPoints,
            DrawError::SelfCrossing,
            DrawError::TooSmall,
            DrawError::OverlapsArea(0),
            DrawError::DifferentAreas,
            DrawError::WrongSide,
            DrawError::Empty,
            DrawError::UnknownArea(7),
        ] {
            let text = explain(&e, Kind::Connect, &names);
            assert!(text.ends_with('.') && text.len() > 20, "{e:?}: {text}");
        }
        assert!(explain(&DrawError::OverlapsArea(0), Kind::Free, &names).contains("„Nordstadt“"));
        assert!(explain(&DrawError::OverlapsArea(5), Kind::Free, &names).contains("einem anderen Gebiet"));
        assert_ne!(explain(&DrawError::WrongSide, Kind::Split, &names), explain(&DrawError::WrongSide, Kind::Connect, &names));
    }

    #[test]
    fn sizes_read_the_german_way() {
        assert_eq!(area_text(850.4), "ca. 850 m²");
        assert_eq!(area_text(24_000.0), "ca. 2,4 ha");
        assert_eq!(area_text(1_250_000.0), "ca. 125 ha");
        assert_eq!(area_text(12_500_000.0), "ca. 1.250 ha");
    }
}
