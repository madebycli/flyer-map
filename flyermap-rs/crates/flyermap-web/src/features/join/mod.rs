//! Joining and signing in (step 4 builds the screens; the code format is here from the start because the mock backend reads codes).
pub mod code;

pub use code::{code_from_text, display_code, normalize_code, CODE_LEN};
