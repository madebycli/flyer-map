//! The finger tools of the marking panel: Wischen (a highlighter) and Lasso. They take a finger only after it rested a moment; Stempeln and Strecke
//! work with taps (the app handles those).
pub mod brush;
pub mod ctx;
pub mod lasso;

pub use brush::Brush;
pub use ctx::{ToolCtx, ToolView};
pub use lasso::Lasso;
