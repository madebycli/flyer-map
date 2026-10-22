use crate::{Role, Scope};
use serde::{Deserialize, Serialize};

/// One right given to a person or guest: a role in a scope, for a while.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Grant {
    pub role: Role,
    pub scope: Scope,
    /// Milliseconds since the epoch; `None` = until revoked.
    pub not_after: Option<u64>,
}

impl Grant {
    pub fn new(role: Role, scope: Scope) -> Grant {
        Grant { role, scope, not_after: None }
    }

    pub fn until(mut self, not_after: u64) -> Grant {
        self.not_after = Some(not_after);
        self
    }

    pub fn is_active(&self, now: u64) -> bool {
        self.not_after.is_none_or(|end| now < end)
    }
}
