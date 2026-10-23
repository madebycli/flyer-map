//! The screens and the anchors of the map. A feature gets its data and callbacks from the app and knows nothing about the others.
//!
//! The three anchors of the phone: the command bar (`search`), the mode button (`mode`), the quick bar (`quick`). Everything else shows up at
//! the thing it concerns (`subject`) or in the Studio, and the live strip (`live`) says who is out.
pub mod help;
pub mod join;
pub mod live;
pub mod map;
pub mod mode;
pub mod overview;
pub mod palette;
pub mod quick;
pub mod search;
pub mod settings;
pub mod studio;
pub mod subject;
