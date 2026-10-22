//! Markieren: the rules of marking as pure data. [`MarkState`] (mode, brush, options, the points of a route) with its reducer, and [`PanelModel`]: the
//! one panel with fixed places for every mode. The screens (`features::mode`) draw the model; the map tools (`features::mode::tools`) carry out the gestures.
pub mod panel;
pub mod state;

pub use panel::{house_taps, meters, model, ConfirmKind, Context, PanelModel, RouteFacts};
pub use state::{BrushSize, MarkAction, MarkState, Mode, Tap, SAVED_KEY};
