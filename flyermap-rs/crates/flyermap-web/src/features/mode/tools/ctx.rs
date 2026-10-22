//! What a finger tool needs from the app: the map, the ink, the field (index and engine), the latest choices, and a way to apply a marking. Closures,
//! so a tool knows nothing of signals or the session.
use crate::{
    field::Field,
    map::{ink::InkCanvas, FieldMap},
    marking::MarkState,
    platform::Theme,
};
use flyermap_core::{Key, Status};
use std::rc::Rc;

/// The choices at the moment of a gesture (read when the finger goes down and as it moves, never captured).
#[derive(Clone)]
pub struct ToolView {
    pub state: MarkState,
    pub theme: Theme,
}

pub struct ToolCtx {
    pub map: FieldMap,
    pub ink: Rc<InkCanvas>,
    pub field: Rc<Field>,
    pub view: Box<dyn Fn() -> ToolView>,
    /// Set `status` on these keys (the app filters by rights, buzzes, remembers it for the undo).
    pub apply: Box<dyn Fn(Vec<Key>, Status)>,
}
