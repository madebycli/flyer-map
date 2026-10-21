use crate::{
    breadcrumb::Breadcrumb,
    event::{Event, Value},
    finding::Finding,
    level::Level,
    metrics::HistogramSummary,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Bumped when the shape changes, so a report read later says which shape it has.
pub const REPORT_SCHEMA: u32 = 1;

/// All warnings and errors with the same code, folded into one line.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Problem {
    pub code: String,
    pub level: Level,
    pub count: u64,
    pub first_t: u64,
    pub last_t: u64,
    pub last_message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Report {
    pub schema: u32,
    pub created_at: u64,
    pub build: String,
    pub env: BTreeMap<String, Value>,
    pub counters: BTreeMap<String, u64>,
    pub gauges: BTreeMap<String, f64>,
    pub histograms: BTreeMap<String, HistogramSummary>,
    /// Warnings and errors by code, worst first: where to look first.
    pub problems: Vec<Problem>,
    pub findings: Vec<Finding>,
    /// What the registered probes saw (the store, the sync loop, the map ...), each a small JSON object.
    pub probes: BTreeMap<String, serde_json::Value>,
    pub breadcrumbs: Vec<Breadcrumb>,
    pub events: Vec<Event>,
    /// How many older events and steps fell off the buffers.
    pub events_dropped: u64,
    pub breadcrumbs_dropped: u64,
}

/// Group warnings and errors by code (events without a code group by area and level), most severe and most frequent first.
pub fn problems_of<'a>(events: impl Iterator<Item = &'a Event>) -> Vec<Problem> {
    let mut by: BTreeMap<String, Problem> = BTreeMap::new();
    for e in events.filter(|e| e.level >= Level::Warn) {
        let code = e
            .code
            .clone()
            .unwrap_or_else(|| format!("{}.{}", e.area, e.level.as_str()));
        let p = by.entry(code.clone()).or_insert_with(|| Problem {
            code,
            level: e.level,
            count: 0,
            first_t: e.t,
            last_t: e.t,
            last_message: String::new(),
        });
        p.count += 1;
        p.level = p.level.max(e.level);
        p.last_t = e.t;
        p.last_message = e.message.clone();
    }
    let mut list: Vec<Problem> = by.into_values().collect();
    list.sort_by(|a, b| {
        b.level
            .cmp(&a.level)
            .then(b.count.cmp(&a.count))
            .then(a.code.cmp(&b.code))
    });
    list
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(t: u64, level: Level, code: Option<&str>, message: &str) -> Event {
        Event::new(t, level, "sync", code, message, &[])
    }

    #[test]
    fn problems_fold_by_code_and_rank_errors_first() {
        let events = [
            ev(1, Level::Warn, Some("sync.push.rejected"), "a"),
            ev(2, Level::Warn, Some("sync.push.rejected"), "b"),
            ev(3, Level::Error, Some("map.style.failed"), "c"),
            ev(4, Level::Info, Some("ignored"), "d"),
            ev(5, Level::Warn, None, "e"),
        ];
        let p = problems_of(events.iter());
        assert_eq!(
            p.iter().map(|p| p.code.as_str()).collect::<Vec<_>>(),
            ["map.style.failed", "sync.push.rejected", "sync.warn"]
        );
        assert_eq!(
            (
                p[1].count,
                p[1].first_t,
                p[1].last_t,
                p[1].last_message.as_str()
            ),
            (2, 1, 2, "b")
        );
    }
}
