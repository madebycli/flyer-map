//! What the marking tool remembers: the mode, the brush (a status), the options, and the points tapped for a route. Pure: one reducer, native tests.
//! The device keeps the choices (not the points) under the key of the React app, in its shape, so a person who switches between the apps keeps them.
use flyermap_core::Status;
use serde::{Deserialize, Serialize};

/// The four ways to mark. Strecke first: it is what almost every shift is made of.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Tap points along the streets, then confirm: the whole stretch gets the status.
    #[default]
    Route,
    /// One tap: a house, or a street with its houses.
    #[serde(rename = "tap")]
    Stamp,
    /// Paint over many like a highlighter.
    #[serde(rename = "paint")]
    Brush,
    /// Circle an area.
    Lasso,
}

impl Mode {
    pub const ALL: [Mode; 4] = [Mode::Route, Mode::Stamp, Mode::Brush, Mode::Lasso];

    pub fn label(self) -> &'static str {
        match self {
            Mode::Route => "Strecke",
            Mode::Stamp => "Stempeln",
            Mode::Brush => "Wischen",
            Mode::Lasso => "Lasso",
        }
    }

    /// `data-mode` of the browser flows.
    pub fn key(self) -> &'static str {
        match self {
            Mode::Route => "route",
            Mode::Stamp => "stamp",
            Mode::Brush => "brush",
            Mode::Lasso => "lasso",
        }
    }

    /// Wischen and Lasso need a finger that rested a moment; a quick drag stays the map's.
    pub fn takes_a_held_finger(self) -> bool {
        matches!(self, Mode::Brush | Mode::Lasso)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BrushSize {
    Fine,
    #[default]
    Medium,
    Wide,
}

impl BrushSize {
    pub const ALL: [BrushSize; 3] = [BrushSize::Fine, BrushSize::Medium, BrushSize::Wide];

    /// Diameter of the stroke in screen pixels: the same on every zoom level, so what is under it is what is marked.
    pub fn px(self) -> f64 {
        match self {
            BrushSize::Fine => 26.0,
            BrushSize::Medium => 44.0,
            BrushSize::Wide => 72.0,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            BrushSize::Fine => "Fein",
            BrushSize::Medium => "Mittel",
            BrushSize::Wide => "Breit",
        }
    }
}

/// A point of a route: a street piece (the route runs through them), or a single house added to the selection.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Tap {
    Segment(String),
    House(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct MarkState {
    pub mode: Mode,
    /// The brush: what a marking sets.
    pub status: Status,
    /// A street takes its houses along.
    pub with_houses: bool,
    /// Streets without houses are left out (and hidden).
    pub houses_only: bool,
    pub size: BrushSize,
    pub taps: Vec<Tap>,
}

impl Default for MarkState {
    fn default() -> MarkState {
        MarkState { mode: Mode::Route, status: Status::Completed, with_houses: true, houses_only: false, size: BrushSize::Medium, taps: Vec::new() }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum MarkAction {
    SetMode(Mode),
    SetStatus(Status),
    SetSize(BrushSize),
    ToggleHouses,
    ToggleHousesOnly,
    /// A tap on a street piece in Strecke mode.
    TapSegment(String),
    /// A tap on a house in Strecke mode: a second tap takes it out again.
    TapHouse(String),
    /// The last point back.
    UndoTap,
    ClearTaps,
}

impl MarkState {
    pub fn reduce(&mut self, action: MarkAction) {
        match action {
            MarkAction::SetMode(mode) => {
                if mode != self.mode {
                    self.taps.clear();
                }
                self.mode = mode;
            }
            MarkAction::SetStatus(status) => self.status = status,
            MarkAction::SetSize(size) => self.size = size,
            MarkAction::ToggleHouses => self.with_houses = !self.with_houses,
            MarkAction::ToggleHousesOnly => self.houses_only = !self.houses_only,
            MarkAction::TapSegment(id) => self.taps.push(Tap::Segment(id)),
            MarkAction::TapHouse(id) => match self.taps.iter().position(|t| *t == Tap::House(id.clone())) {
                Some(i) => {
                    self.taps.remove(i);
                }
                None => self.taps.push(Tap::House(id)),
            },
            MarkAction::UndoTap => {
                self.taps.pop();
            }
            MarkAction::ClearTaps => self.taps.clear(),
        }
    }

    /// The street pieces tapped, in order (the route runs through them).
    pub fn anchors(&self) -> Vec<String> {
        self.taps.iter().filter_map(|t| if let Tap::Segment(id) = t { Some(id.clone()) } else { None }).collect()
    }

    /// The houses tapped one by one.
    pub fn picked(&self) -> Vec<String> {
        self.taps.iter().filter_map(|t| if let Tap::House(id) = t { Some(id.clone()) } else { None }).collect()
    }
}

/// The choices as the React app stores them (`vf-v5-mark-2`): `{"mode":"route","brush":"completed","withHouses":true,"housesOnly":false,"size":"medium"}`.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Saved {
    mode: Mode,
    brush: Status,
    with_houses: bool,
    houses_only: bool,
    size: BrushSize,
}

impl Default for Saved {
    fn default() -> Saved {
        let d = MarkState::default();
        Saved { mode: d.mode, brush: d.status, with_houses: d.with_houses, houses_only: d.houses_only, size: d.size }
    }
}

pub const SAVED_KEY: &str = "vf-v5-mark-2";

impl MarkState {
    /// What the device stored; anything unreadable (or a field with a value we do not know) falls back to the default for that field alone.
    pub fn load(stored: Option<&str>) -> MarkState {
        let value: serde_json::Value = stored.and_then(|s| serde_json::from_str(s).ok()).unwrap_or(serde_json::Value::Null);
        fn pick<T: serde::de::DeserializeOwned>(value: &serde_json::Value, name: &str) -> Option<T> {
            value.get(name).cloned().and_then(|v| serde_json::from_value(v).ok())
        }
        let d = MarkState::default();
        MarkState {
            mode: pick(&value, "mode").unwrap_or(d.mode),
            status: pick(&value, "brush").unwrap_or(d.status),
            with_houses: pick(&value, "withHouses").unwrap_or(d.with_houses),
            houses_only: pick(&value, "housesOnly").unwrap_or(d.houses_only),
            size: pick(&value, "size").unwrap_or(d.size),
            taps: Vec::new(),
        }
    }

    pub fn to_saved(&self) -> String {
        serde_json::to_string(&Saved { mode: self.mode, brush: self.status, with_houses: self.with_houses, houses_only: self.houses_only, size: self.size })
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaving_strecke_forgets_the_points_and_a_second_tap_takes_a_house_out() {
        let mut s = MarkState::default();
        s.reduce(MarkAction::TapSegment("1#0".into()));
        s.reduce(MarkAction::TapHouse("a".into()));
        s.reduce(MarkAction::TapSegment("2#0".into()));
        assert_eq!((s.anchors(), s.picked()), (vec!["1#0".to_string(), "2#0".into()], vec!["a".to_string()]));
        s.reduce(MarkAction::TapHouse("a".into()));
        assert!(s.picked().is_empty());
        s.reduce(MarkAction::UndoTap);
        assert_eq!(s.anchors(), ["1#0"]);
        s.reduce(MarkAction::SetMode(Mode::Route));
        assert_eq!(s.taps.len(), 1, "the same mode keeps the points");
        s.reduce(MarkAction::SetMode(Mode::Lasso));
        assert!(s.taps.is_empty());
    }

    #[test]
    fn the_choices_round_trip_in_the_shape_of_the_react_app() {
        let mut s = MarkState::default();
        s.reduce(MarkAction::SetMode(Mode::Brush));
        s.reduce(MarkAction::SetStatus(Status::NotDeliverable));
        s.reduce(MarkAction::ToggleHousesOnly);
        s.reduce(MarkAction::SetSize(BrushSize::Wide));
        let saved = s.to_saved();
        assert_eq!(saved, r#"{"mode":"paint","brush":"not-deliverable","withHouses":true,"housesOnly":true,"size":"wide"}"#);
        assert_eq!(MarkState::load(Some(&saved)), s);
        let react = MarkState::load(Some(r#"{"mode":"tap","brush":"later","withHouses":false,"housesOnly":false,"size":"fine"}"#));
        assert_eq!((react.mode, react.status, react.with_houses, react.size), (Mode::Stamp, Status::Later, false, BrushSize::Fine));
    }

    #[test]
    fn something_unreadable_gives_the_default_field_by_field() {
        assert_eq!(MarkState::load(None), MarkState::default());
        assert_eq!(MarkState::load(Some("{nope")), MarkState::default());
        let partly = MarkState::load(Some(r#"{"mode":"lasso","brush":"banana","size":"huge"}"#));
        assert_eq!((partly.mode, partly.status, partly.size), (Mode::Lasso, Status::Completed, BrushSize::Medium));
    }

    #[test]
    fn only_the_painting_modes_wait_for_a_held_finger() {
        assert!(Mode::Brush.takes_a_held_finger() && Mode::Lasso.takes_a_held_finger());
        assert!(!Mode::Route.takes_a_held_finger() && !Mode::Stamp.takes_a_held_finger());
        assert_eq!(Mode::ALL.map(Mode::key), ["route", "stamp", "brush", "lasso"]);
    }
}
