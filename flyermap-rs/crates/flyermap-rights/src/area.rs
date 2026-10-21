use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CollectionStatus {
    Open,
    Claimed,
    InProgress,
    Completed,
    Archived,
}

/// A Gebiet of either kind: distribution Gebiete belong to a Gruppe, collection Gebiete are claimed by a Run.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "kebab-case")]
pub enum AreaRef {
    Distribution { id: String, team_id: String },
    Collection { id: String, status: CollectionStatus, run_id: Option<String> },
}

impl AreaRef {
    pub fn id(&self) -> &str {
        match self {
            AreaRef::Distribution { id, .. } | AreaRef::Collection { id, .. } => id,
        }
    }
}
