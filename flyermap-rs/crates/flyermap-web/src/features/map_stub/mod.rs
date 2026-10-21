//! Karte (stand-in): the map zone with fake streets and houses until the MapLibre bridge (`map/`, M5) replaces it.
pub mod drawing;
pub mod view;

pub use drawing::{HouseDot, StreetLine};
pub use view::MapStub;
