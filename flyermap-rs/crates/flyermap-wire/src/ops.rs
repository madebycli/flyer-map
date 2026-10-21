use flyermap_core::{Key, Op, OpId, Status};
use serde::{Deserialize, Serialize};

/// One edit as it goes to the server: only what the server needs (who made it follows from the session).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WireOp {
    pub id: OpId,
    pub key: Key,
    pub status: Status,
    pub area: String,
}

impl WireOp {
    /// An edit without a known Gebiet cannot be authorised yet: it stays in the outbox.
    pub fn from_op(op: &Op) -> Option<WireOp> {
        Some(WireOp {
            id: op.id.clone(),
            key: op.key.clone(),
            status: op.status,
            area: op.area.clone()?,
        })
    }
}

/// `POST /campaigns/:id/ops`. The elements are `serde_json::Value` on the server side (it judges the shape itself); this is what a correct client sends.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PushRequest {
    pub ops: Vec<WireOp>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PushRejected {
    pub id: String,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PushResponse {
    pub accepted: Vec<String>,
    pub rejected: Vec<PushRejected>,
}

impl PushResponse {
    /// The server holds another truth for some key (it belongs to another Gebiet): the client pulls everything again.
    pub fn wants_refetch(&self) -> bool {
        self.rejected
            .iter()
            .any(|r| r.reason == "key_owned_elsewhere")
    }
}
