//! What the diagnostics report shows about the loop.
use crate::machine::Machine;
use flyermap_core::Store;
use serde_json::{json, Value};

impl Machine {
    pub fn probe(&self, store: &Store, now: u64) -> Value {
        json!({
            "state": self.state.as_str(),
            "running": self.is_running(),
            "lastOkAgoS": self.last_ok_at.map(|t| now.saturating_sub(t) / 1000),
            "lastError": self.last_error_code,
            "failures": self.failures,
            "extraFailures": self.extra_failures,
            "backoffMs": self.backoff_ms,
            "retryScheduled": self.retry_timer,
            "pendingOps": store.pending_len(),
            "pendingExtras": self.extras_pending,
            "batchSize": self.cfg.batch_size,
            "rounds": self.history.iter().map(|r| json!({
                "at": r.at, "ms": r.ms, "batches": r.batches, "sent": r.sent, "accepted": r.accepted, "rejected": r.rejected,
                "pages": r.pages, "pulled": r.pulled, "result": r.result.as_str(), "error": r.error,
            })).collect::<Vec<_>>(),
        })
    }
}
