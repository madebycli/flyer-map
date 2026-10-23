//! The one marking panel, as data. The panel has the same places in every mode: *mode*, *status* (the brush), *context* (the one control or line that belongs
//! to the mode), *options* (houses along, only streets with houses), *undo* (bottom left) and *confirm* (bottom right). A mode only decides what stands
//! in its context place and what the confirm button says; nothing moves. The screen draws exactly this.
use super::state::{BrushSize, MarkState, Mode, Tap};
use crate::{engine::Route, ui::status::Kind};
use flyermap_core::Status;

/// What the route is right now, as far as the panel needs it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RouteFacts {
    /// Street pieces on the way (chunks), houses and metres along it.
    pub streets: usize,
    pub houses: usize,
    pub meters: f64,
    /// Keys the confirm would set.
    pub keys: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Context {
    /// A line of words; `warn` when the person should do something else.
    Line { text: String, warn: bool },
    /// Strecke: the points so far and what they make.
    Points { count: usize, text: String, warn: bool },
    /// Wischen: the width of the stroke.
    Size(BrushSize),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConfirmKind {
    /// Strecke: set the status on the selection.
    Apply,
    /// The other modes mark as they go: this ends the marking.
    Finish,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PanelModel {
    pub mode: Mode,
    pub status: Status,
    pub context: Context,
    pub houses_on: bool,
    pub houses_only_on: bool,
    /// Lasso picks houses and streets exactly: "with houses" means nothing there.
    pub houses_enabled: bool,
    pub undo_label: &'static str,
    pub undo_enabled: bool,
    pub confirm_label: String,
    pub confirm_enabled: bool,
    pub confirm_kind: ConfirmKind,
}

/// `4,2 km` / `240 m`.
pub fn meters(m: f64) -> String {
    if m >= 1000.0 {
        format!("{:.1} km", m / 1000.0).replace('.', ",")
    } else {
        format!("{} m", m.round() as i64)
    }
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// The words of Strecke for the situation (port of `FabCaption`).
fn route_context(state: &MarkState, route: Option<&Route>, facts: RouteFacts) -> Context {
    let taps = state.taps.len();
    let (anchors, picked) = (state.anchors().len(), state.picked().len());
    let line = |text: &str, warn: bool| Context::Points { count: taps, text: text.to_string(), warn };
    if taps == 0 {
        return line("Straße oder Häuser antippen", false);
    }
    if anchors == 0 {
        return line(&format!("{} · weitere antippen", plural(picked, "Haus", "Häuser")), false);
    }
    match route {
        Some(Route::Disconnected) => line("Nicht verbunden – anderen Punkt wählen", true),
        Some(Route::Selected { ambiguous, .. }) if anchors >= 2 || picked > 0 => {
            let mut text = format!("{} · {} · {}", plural(facts.streets, "Straße", "Straßen"), plural(facts.houses, "Haus", "Häuser"), meters(facts.meters));
            if *ambiguous {
                text.push_str(" · Zwischenpunkt?");
            }
            Context::Points { count: taps, text, warn: *ambiguous }
        }
        _ if anchors == 1 && picked == 0 => line("Endpunkt antippen", false),
        _ if picked > 0 => line(&format!("{} · weitere antippen", plural(picked, "Haus", "Häuser")), false),
        _ => line("Strecke wird berechnet …", false),
    }
}

pub fn model(state: &MarkState, route: Option<&Route>, facts: RouteFacts, kind: Kind, can_undo: bool) -> PanelModel {
    let route_mode = state.mode == Mode::Route;
    let words = |s: Status| crate::ui::status::label(kind, s);
    let context = match state.mode {
        Mode::Route => route_context(state, route, facts),
        Mode::Stamp => Context::Line { text: format!("Straße oder Haus antippen · {}", words(state.status)), warn: false },
        Mode::Brush => Context::Size(state.size),
        Mode::Lasso => Context::Line { text: format!("Kurz halten, dann Umriss ziehen · {}", words(state.status)), warn: false },
    };
    let has_taps = !state.taps.is_empty();
    let ready = route_mode && facts.keys > 0 && (!state.picked().is_empty() || (matches!(route, Some(Route::Selected { .. })) && state.anchors().len() >= 2));
    PanelModel {
        mode: state.mode,
        status: state.status,
        context,
        houses_on: state.with_houses,
        houses_only_on: state.houses_only,
        houses_enabled: state.mode != Mode::Lasso,
        undo_label: if route_mode && has_taps { "Punkt zurück" } else { "Rückgängig" },
        undo_enabled: if route_mode && has_taps { true } else { can_undo },
        confirm_label: if route_mode {
            if ready {
                format!("Übernehmen · {}", facts.keys)
            } else {
                "Übernehmen".into()
            }
        } else {
            "Fertig".into()
        },
        confirm_enabled: !route_mode || ready,
        confirm_kind: if route_mode { ConfirmKind::Apply } else { ConfirmKind::Finish },
    }
}

/// How many of the taps are houses (for the facts when no route was asked for).
pub fn house_taps(state: &MarkState) -> usize {
    state.taps.iter().filter(|t| matches!(t, Tap::House(_))).count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::marking::state::MarkAction;

    fn selected(ambiguous: bool) -> Route {
        Route::Selected { segment_ids: vec!["a".into(), "b".into()], length: 240.0, ambiguous }
    }

    fn route_state(taps: &[MarkAction]) -> MarkState {
        let mut s = MarkState::default();
        for t in taps {
            s.reduce(t.clone());
        }
        s
    }

    #[test]
    fn every_mode_has_every_place() {
        for mode in Mode::ALL {
            let mut s = MarkState::default();
            s.reduce(MarkAction::SetMode(mode));
            let m = model(&s, None, RouteFacts::default(), Kind::Distribution, false);
            assert_eq!(m.mode, mode);
            assert!(!m.confirm_label.is_empty() && !m.undo_label.is_empty());
        }
    }

    #[test]
    fn strecke_walks_through_its_sentences() {
        let facts = RouteFacts { streets: 2, houses: 14, meters: 240.0, keys: 16 };
        let ctx = |s: &MarkState, r: Option<&Route>, f: RouteFacts| match model(s, r, f, Kind::Distribution, false).context {
            Context::Points { text, warn, count } => (count, text, warn),
            other => panic!("{other:?}"),
        };
        assert_eq!(ctx(&MarkState::default(), None, RouteFacts::default()), (0, "Straße oder Häuser antippen".into(), false));
        let one = route_state(&[MarkAction::TapSegment("a".into())]);
        assert_eq!(ctx(&one, None, RouteFacts::default()).1, "Endpunkt antippen");
        let two = route_state(&[MarkAction::TapSegment("a".into()), MarkAction::TapSegment("b".into())]);
        assert_eq!(ctx(&two, Some(&Route::Disconnected), RouteFacts::default()), (2, "Nicht verbunden – anderen Punkt wählen".into(), true));
        assert_eq!(ctx(&two, Some(&selected(false)), facts).1, "2 Straßen · 14 Häuser · 240 m");
        assert_eq!(ctx(&two, Some(&selected(true)), facts), (2, "2 Straßen · 14 Häuser · 240 m · Zwischenpunkt?".into(), true));
        let houses = route_state(&[MarkAction::TapHouse("h1".into())]);
        assert_eq!(ctx(&houses, None, RouteFacts::default()).1, "1 Haus · weitere antippen");
    }

    #[test]
    fn confirm_needs_a_route_or_houses_and_the_other_modes_just_finish() {
        let facts = RouteFacts { streets: 2, houses: 14, meters: 240.0, keys: 16 };
        let two = route_state(&[MarkAction::TapSegment("a".into()), MarkAction::TapSegment("b".into())]);
        let m = model(&two, Some(&selected(false)), facts, Kind::Distribution, false);
        assert!((m.confirm_enabled, m.confirm_label.as_str(), m.confirm_kind) == (true, "Übernehmen · 16", ConfirmKind::Apply));
        let one = route_state(&[MarkAction::TapSegment("a".into())]);
        assert!(!model(&one, Some(&selected(false)), facts, Kind::Distribution, false).confirm_enabled, "one point is no route");
        let h = route_state(&[MarkAction::TapHouse("h".into())]);
        assert!(model(&h, None, RouteFacts { keys: 1, ..RouteFacts::default() }, Kind::Distribution, false).confirm_enabled, "houses alone are enough");
        let stamp = route_state(&[MarkAction::SetMode(Mode::Stamp)]);
        let m = model(&stamp, None, RouteFacts::default(), Kind::Distribution, false);
        assert_eq!((m.confirm_enabled, m.confirm_label.as_str(), m.confirm_kind), (true, "Fertig", ConfirmKind::Finish));
    }

    #[test]
    fn undo_is_the_last_point_in_strecke_and_the_last_marking_elsewhere() {
        let taps = route_state(&[MarkAction::TapSegment("a".into())]);
        let m = model(&taps, None, RouteFacts::default(), Kind::Distribution, false);
        assert_eq!((m.undo_label, m.undo_enabled), ("Punkt zurück", true));
        let idle = model(&MarkState::default(), None, RouteFacts::default(), Kind::Distribution, true);
        assert_eq!((idle.undo_label, idle.undo_enabled), ("Rückgängig", true));
        assert!(!model(&MarkState::default(), None, RouteFacts::default(), Kind::Distribution, false).undo_enabled);
    }

    #[test]
    fn brush_has_its_width_lasso_has_no_houses_option_and_collecting_uses_its_words() {
        let brush = route_state(&[MarkAction::SetMode(Mode::Brush)]);
        assert_eq!(model(&brush, None, RouteFacts::default(), Kind::Distribution, false).context, Context::Size(BrushSize::Medium));
        let lasso = route_state(&[MarkAction::SetMode(Mode::Lasso)]);
        let m = model(&lasso, None, RouteFacts::default(), Kind::Collection, false);
        assert!(!m.houses_enabled);
        assert!(matches!(m.context, Context::Line { ref text, .. } if text.contains("Abgeholt")));
        assert_eq!(meters(1234.0), "1,2 km");
        assert_eq!(meters(240.4), "240 m");
    }
}
