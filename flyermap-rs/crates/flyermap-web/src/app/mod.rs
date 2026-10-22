//! The app: the state, the frame with its zones, what a sheet's action does, the effects of the settings, the boot.
pub mod acts;
pub mod effects;
pub mod frame;
pub mod panels;
pub mod root;
pub mod start;
pub mod state;
pub mod zones;

pub use start::start;
