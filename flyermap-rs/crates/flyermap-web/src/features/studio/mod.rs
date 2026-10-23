//! Studio: Gruppen, Gebiete, Läufe, Personen, Zugänge in one place, the column next to the map on a wide screen and a sheet on a phone. A list per tab; a row opens
//! the sheet of the thing (`features::subject`), the same one a tap on the map opens.
pub mod model;
pub mod view;

pub use model::{empty_text, label, rows, tabs, Row};
pub use view::StudioPanel;
