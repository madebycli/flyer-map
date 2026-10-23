//! Gebiete zeichnen: the rules of the drawing tool as pure data. [`Draw`] (the kind, the target, the points tapped, snapped to borders) with its reducer;
//! [`evaluate`] says what the points make (not enough yet, ready to save, or a German hint why not) with the geometry of `flyermap-area`; [`geojson`] draws it on
//! the map; [`drafts`] turns a finished drawing into what the backend stores. The screens (`features::draw`) show it, the app (`app::draw`) wires it to the map.
pub mod drafts;
pub mod hints;
pub mod preview;
pub mod state;
pub mod verdict;

pub use drafts::{drafts, suggest_name};
pub use hints::{confirm_label, ready_text};
pub use preview::geojson;
pub use state::{metres_per_pixel, Draw, DrawAction, Kind, Point, Reach};
pub use verdict::{evaluate, kinds_for, Areas, Ready, Verdict};
