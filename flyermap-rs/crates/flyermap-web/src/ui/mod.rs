//! The design system: few containers (bar, sheet, card), few row kinds, one look. Components are Rust; the styling is the classes of the
//! React app's stylesheets (`assets/css`), so the DOM contract of the browser flows stays.
pub mod button;
pub mod card;
pub mod command_bar;
pub mod fold;
pub mod icon;
pub mod list;
pub mod palette;
pub mod progress;
pub mod segmented;
pub mod sheet;
pub mod status;
pub mod status_tiles;
pub mod toast;

pub use button::{Button, ButtonVariant, IconButton, IconButtonVariant};
pub use card::{Card, Hint, Overlay};
pub use command_bar::{flat, CommandBar, Hit, HitKind, PillState, ResultGroup, StatusPill, SyncDot};
pub use icon::{Icon, IconName};
pub use list::{ListGroup, ListRow, RowTone, SwitchRow};
pub use progress::Progress;
pub use segmented::{SegOption, Segmented};
pub use sheet::{Sheet, SheetActions, SheetFooter, SheetMeta, SheetToolbar};
pub use status_tiles::StatusTiles;
pub use toast::Toast;
