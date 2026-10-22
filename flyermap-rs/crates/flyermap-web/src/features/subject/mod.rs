//! Blätter am Gegenstand: what a tap on a Gebiet, a house, a street, a person or a Lauf opens (instead of a menu of everything).
pub mod object;
pub mod object_sheet;
pub mod sheet;
pub mod view;

pub use object::{describe_object, status_line, summarize, ObjectView, Summary};
pub use object_sheet::ObjectSheet;
pub use sheet::{GoneSheet, SubjectSheet};
pub use view::{act_label, describe, SubjectView};
