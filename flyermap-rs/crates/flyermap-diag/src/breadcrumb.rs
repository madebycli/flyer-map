use serde::{Deserialize, Serialize};

/// One step the person took or the app took for them: "opened the menu", "marked 3 houses", "sync round ok". No positions, names or free text: a
/// short code and a number are enough to reproduce a path through the app.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Breadcrumb {
    pub t: u64,
    pub step: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub n: Option<i64>,
}
