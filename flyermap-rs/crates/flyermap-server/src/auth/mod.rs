//! Who is asking, and how people come in: the caller of a request, sessions, and the brake against guessing.
pub mod brake;
pub mod caller;
pub mod passkeys;
pub mod session;

pub use caller::{resolve, Caller};
