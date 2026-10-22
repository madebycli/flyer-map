//! Blätter am Gegenstand: what a tap on a Gebiet, a street, a person or a Lauf opens (instead of a menu of everything).
pub mod sheet;
pub mod view;

pub use sheet::{GoneSheet, SubjectSheet};
pub use view::{act_label, describe, SubjectView};
