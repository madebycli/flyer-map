use flyermap_diag::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoundResult {
    Ok,
    /// The edits went through but a side channel (notes) failed.
    ExtrasFailed,
    Failed,
}

impl RoundResult {
    pub fn as_str(self) -> &'static str {
        match self {
            RoundResult::Ok => "ok",
            RoundResult::ExtrasFailed => "notes-failed",
            RoundResult::Failed => "failed",
        }
    }
}

/// One line per sync round: what was sent, accepted, refused, pulled, and how long it took. Newest last; the report shows the last ones.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyncRound {
    pub at: u64,
    pub ms: u64,
    pub batches: u32,
    pub sent: usize,
    pub accepted: usize,
    pub rejected: usize,
    pub pages: u32,
    pub pulled: usize,
    pub result: RoundResult,
    pub error: Option<String>,
}

impl SyncRound {
    pub fn fresh(at: u64) -> SyncRound {
        SyncRound { at, ms: 0, batches: 0, sent: 0, accepted: 0, rejected: 0, pages: 0, pulled: 0, result: RoundResult::Ok, error: None }
    }

    /// For the diagnostics probe.
    pub fn fields(&self) -> Vec<(&'static str, Value)> {
        vec![
            ("ms", self.ms.into()),
            ("batches", self.batches.into()),
            ("sent", self.sent.into()),
            ("accepted", self.accepted.into()),
            ("rejected", self.rejected.into()),
            ("pages", self.pages.into()),
            ("pulled", self.pulled.into()),
            ("result", self.result.as_str().into()),
        ]
    }
}
