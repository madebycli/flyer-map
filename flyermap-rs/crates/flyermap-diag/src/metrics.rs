use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const SAMPLES: usize = 200;
const MAX_NAMES: usize = 400;

/// Count, sum, extremes and the last 200 samples (for percentiles) of one measured thing, for example a request time in ms.
#[derive(Clone, Debug, Default)]
pub struct Histogram {
    count: u64,
    sum: f64,
    min: f64,
    max: f64,
    recent: std::collections::VecDeque<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HistogramSummary {
    pub count: u64,
    pub mean: f64,
    pub min: f64,
    pub max: f64,
    pub p50: f64,
    pub p95: f64,
}

impl Histogram {
    pub fn observe(&mut self, value: f64) {
        if !value.is_finite() {
            return;
        }
        if self.count == 0 {
            self.min = value;
            self.max = value;
        } else {
            self.min = self.min.min(value);
            self.max = self.max.max(value);
        }
        self.count += 1;
        self.sum += value;
        if self.recent.len() == SAMPLES {
            self.recent.pop_front();
        }
        self.recent.push_back(value);
    }

    pub fn summary(&self) -> HistogramSummary {
        let mut sorted: Vec<f64> = self.recent.iter().copied().collect();
        sorted.sort_by(f64::total_cmp);
        let at = |q: f64| {
            if sorted.is_empty() {
                0.0
            } else {
                sorted[((sorted.len() - 1) as f64 * q).round() as usize]
            }
        };
        HistogramSummary {
            count: self.count,
            mean: if self.count > 0 {
                self.sum / self.count as f64
            } else {
                0.0
            },
            min: self.min,
            max: self.max,
            p50: at(0.5),
            p95: at(0.95),
        }
    }
}

/// Counters (only go up), gauges (a value right now) and histograms (a distribution). Names are bounded so that a bug cannot grow the maps forever.
#[derive(Clone, Debug, Default)]
pub struct Metrics {
    counters: BTreeMap<String, u64>,
    gauges: BTreeMap<String, f64>,
    histograms: BTreeMap<String, Histogram>,
}

impl Metrics {
    fn room(&self, name: &str) -> bool {
        self.counters.contains_key(name)
            || self.gauges.contains_key(name)
            || self.histograms.contains_key(name)
            || self.counters.len() + self.gauges.len() + self.histograms.len() < MAX_NAMES
    }
    pub fn count(&mut self, name: &str, n: u64) {
        if self.room(name) {
            *self.counters.entry(name.to_string()).or_insert(0) += n;
        }
    }
    pub fn gauge(&mut self, name: &str, value: f64) {
        if self.room(name) {
            self.gauges.insert(name.to_string(), value);
        }
    }
    pub fn observe(&mut self, name: &str, value: f64) {
        if self.room(name) {
            self.histograms
                .entry(name.to_string())
                .or_default()
                .observe(value);
        }
    }
    pub fn counters(&self) -> &BTreeMap<String, u64> {
        &self.counters
    }
    pub fn gauges(&self) -> &BTreeMap<String, f64> {
        &self.gauges
    }
    pub fn histograms(&self) -> BTreeMap<String, HistogramSummary> {
        self.histograms
            .iter()
            .map(|(k, h)| (k.clone(), h.summary()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentiles_come_from_recent_samples() {
        let mut h = Histogram::default();
        for v in 1..=100 {
            h.observe(f64::from(v));
        }
        h.observe(f64::NAN);
        let s = h.summary();
        assert_eq!((s.count, s.min, s.max), (100, 1.0, 100.0));
        assert!(
            (s.p50 - 50.0).abs() <= 1.0 && (s.p95 - 95.0).abs() <= 1.0,
            "{s:?}"
        );
    }

    #[test]
    fn names_are_bounded() {
        let mut m = Metrics::default();
        for n in 0..1000 {
            m.count(&format!("c{n}"), 1);
        }
        assert_eq!(m.counters().len(), MAX_NAMES);
        m.count("c0", 4);
        assert_eq!(m.counters()["c0"], 5, "known names keep counting");
    }
}
