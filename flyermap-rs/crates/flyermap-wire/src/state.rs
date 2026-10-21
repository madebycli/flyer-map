use flyermap_core::{Key, OpId, Status};
use serde::{Deserialize, Serialize};

/// One row of the shared state as the server sends it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateOp {
    pub id: OpId,
    pub key: Key,
    pub status: Status,
    pub by: String,
    pub area: String,
}

/// `GET /campaigns/:id/state?since=N&limit=M`: rows newer than the cursor, oldest first.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StatePage {
    pub ops: Vec<StateOp>,
    pub cursor: u64,
    pub more: bool,
    /// The server's clock in ms: devices correct their own with it.
    #[serde(rename = "serverNow")]
    pub server_now: u64,
}

impl StateOp {
    pub fn into_op(self) -> flyermap_core::Op {
        flyermap_core::Op {
            id: self.id,
            key: self.key,
            status: self.status,
            by: self.by,
            area: Some(self.area),
        }
    }
}
