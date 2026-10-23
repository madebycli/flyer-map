//! The way in for a device without access: an invitation code (typed, pasted, or read from the link a QR code opens) makes it a guest, an account signs in with a
//! passkey or a password and, if asked, six digits. `code` is the format of the code, `flow` the state machine, `screen` the page.
pub mod code;
pub mod flow;
pub mod screen;

pub use code::{code_from_text, display_code, normalize_code, CODE_LEN};
pub use flow::{Join, JoinAction, Step, Way};
pub use screen::JoinScreen;
