//! The app: the state, the frame with its zones, what a sheet's action does, the effects of the settings, the boot.
pub mod acts;
pub mod debug;
pub mod draw;
pub mod draw_views;
pub mod effects;
pub mod frame;
pub mod join;
pub mod marking;
pub mod object;
pub mod panels;
pub mod root;
pub mod search;
pub mod shortcuts;
pub mod start;
pub mod state;
pub mod studio;
pub mod zones;

pub use start::start;
