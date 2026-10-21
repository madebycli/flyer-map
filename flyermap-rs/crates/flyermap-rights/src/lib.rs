//! The rules, in one place. The Worker decides with them (it is the only judge), the client mirrors them to show what is possible, and both use the
//! same functions, so the interface can never offer what the server refuses.
//!
//! `role` and `caller` say who asks; `area` says where; `rules` combine them; `op_rules` judge a batch of edits; `pickup` holds the Sonder-Marker rights.
pub mod area;
pub mod caller;
pub mod op_rules;
pub mod pickup;
pub mod role;
pub mod rules;

pub use area::{AreaRef, CollectionStatus};
pub use caller::Caller;
pub use op_rules::{
    screen_ops, RawOp, Reason, Rejection, Screened, Write, FUTURE_SKEW_MS, MAX_OPS,
};
pub use pickup::PickupRights;
pub use role::Role;
pub use rules::{can_read_area, can_write_area, in_room_area, is_scoped, writes_allowed};
