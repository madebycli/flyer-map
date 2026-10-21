use serde::{Deserialize, Serialize};

/// What happened to a house or a street piece. `Open` is also what nothing says.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    Open,
    Completed,
    Later,
    NotDeliverable,
}

impl Status {
    /// Fixed order: it is the order of counters and of the colours in the interface.
    pub const ALL: [Status; 4] = [Status::Open, Status::Completed, Status::Later, Status::NotDeliverable];

    pub fn as_str(self) -> &'static str {
        match self {
            Status::Open => "open",
            Status::Completed => "completed",
            Status::Later => "later",
            Status::NotDeliverable => "not-deliverable",
        }
    }

    pub fn parse(text: &str) -> Option<Status> {
        Status::ALL.into_iter().find(|s| s.as_str() == text)
    }

    /// Position in [`Status::ALL`], for fixed-size counter arrays.
    pub fn index(self) -> usize {
        self as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_round_trip_and_match_the_wire() {
        for status in Status::ALL {
            assert_eq!(Status::parse(status.as_str()), Some(status));
            assert_eq!(serde_json::to_string(&status).unwrap(), format!("\"{}\"", status.as_str()));
        }
        assert_eq!(Status::parse("done"), None);
        assert_eq!(Status::NotDeliverable.index(), 3);
    }
}
