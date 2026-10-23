//! Protocol v6 (Plan 061 §5): everything that flows between the app and the Akteur of an Aktion, as types. Nothing here decides anything.
//!
//! - [`model`]: Gruppe, Gebiet, Lauf, Mark, Notiz as a device is told them.
//! - [`command`]: what a device asks ([`Command`] with an idempotency id, [`Body`]).
//! - [`answer`]: what comes back ([`Answer`], [`Verdict`], [`Reason`] with stable codes).
//! - [`change`]: the log ([`Entry`], [`Change`]): the state is a function of it.
//! - [`view`]: snapshot, pages of marks and notes, catching up ([`Catchup`]), the HTTP push.
//! - [`frame`]: the live channel, with the version in every frame.
//! - [`limits`]: the bounds both sides keep to.
//!
//! No German texts live here: errors are codes, the app says them in words. JSON is the format; the shapes are the contract and are pinned by the tests.
pub mod answer;
pub mod change;
pub mod command;
pub mod frame;
pub mod ids;
pub mod limits;
pub mod model;
pub mod view;

pub use answer::{Answer, Reason, Refused, RingFault, Verdict, Why};
pub use change::{Change, Entry};
pub use command::{Body, Command, GebietIn, GruppeIn, LaufIn, MarkIn, NoteIn};
pub use frame::{ClientFrame, ClientMsg, Online, Presence, ProtocolError, ServerFrame, ServerMsg, You, VERSION};
pub use ids::{CommandId, LaufId, NoteId};
pub use model::{Collected, Counts, Gebiet, Gruppe, Join, Lauf, LaufStatus, Mark, Notiz, Ring};
pub use view::{Catchup, MarkCursor, MarksPage, NoteCursor, NotesPage, PushReply, PushRequest, Snapshot};

// Re-exported so that a user of the protocol needs one import for the vocabulary it is made of.
pub use flyermap_core::{note::Flag, Key, OpId, Status};
pub use flyermap_identity::{AktionId, Art, GebietId, GruppeId, OrgId};
