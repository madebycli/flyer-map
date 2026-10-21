use crate::{clock::OpId, key::Key, status::Status};
use serde::{Deserialize, Serialize};

/// One edit: "this key has this status", stamped with the clock of the device that made it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Op {
    /// Globally unique: the encoded clock.
    pub id: OpId,
    pub key: Key,
    pub status: Status,
    pub by: String,
    /// The Area the edit was made in; the server enforces the scope with it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub area: Option<String>,
}
