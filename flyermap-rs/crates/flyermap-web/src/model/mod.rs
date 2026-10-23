//! What the screens talk about, as plain data: the Aktion with its Gruppen, Gebiete, Läufe, Personen and Zugänge ([`World`]), what the person may
//! do ([`Rights`], a mirror of `flyermap_identity::decide`) and what a tap can mean ([`Subject`] with its [`Act`]s). No browser, no network:
//! every rule here is a native test, and any [`crate::backend::Backend`] fills the same types.
pub mod rights;
pub mod subject;
pub mod world;

pub use rights::{role_name, Rights};
pub use subject::{actions_for, Act, Subject, SubjectContext};
pub use world::{ring_bounds, ring_center, Aktion, Basemap, Gebiet, Gruppe, Lauf, LngLat, Me, Person, Teilnehmer, World, Zugang, ZugangKind};
