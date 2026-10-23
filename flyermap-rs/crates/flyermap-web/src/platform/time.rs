//! The two clocks: wall time for the store and the sync (ms since the epoch), and a monotonic clock for durations.

pub fn now_ms() -> u64 {
    js_sys::Date::now().max(0.0) as u64
}

/// Milliseconds since the page started (monotonic; for spans and timings only).
pub fn mono_ms() -> f64 {
    web_sys::window().and_then(|w| w.performance()).map(|p| p.now()).unwrap_or_else(js_sys::Date::now)
}
