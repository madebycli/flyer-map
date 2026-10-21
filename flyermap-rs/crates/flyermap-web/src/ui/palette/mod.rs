//! Material You colours from one seed colour (port of `src/ui/palette.ts`). The web cannot read the wallpaper, so the seed is a choice on this
//! device: one of [`SEEDS`] or any colour.
pub mod apply;
pub mod color;
pub mod scheme;
pub mod seeds;
pub mod tone;

pub use apply::apply;
pub use scheme::{scheme_for, Scheme};
pub use seeds::{is_offered, Seed, DEFAULT_SEED, SEEDS};
pub use tone::tone_color;
