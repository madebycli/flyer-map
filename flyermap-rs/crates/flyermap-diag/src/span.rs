use crate::recorder;

/// Measures how long a stretch of code took and records it as a histogram (`<name>_ms`) when it ends. Needs a recorder for the clock; without one it does nothing.
pub struct Span {
    name: String,
    start: Option<u64>,
}

pub fn span(name: &str) -> Span {
    Span { name: format!("{name}_ms"), start: recorder::now_ms() }
}

impl Span {
    /// End now and return the milliseconds (0 when there is no clock).
    pub fn end(mut self) -> u64 {
        self.finish()
    }
    fn finish(&mut self) -> u64 {
        let Some(start) = self.start.take() else {
            return 0;
        };
        let took = recorder::now_ms().unwrap_or(start).saturating_sub(start);
        recorder::observe(&self.name, took as f64);
        took
    }
}

impl Drop for Span {
    fn drop(&mut self) {
        self.finish();
    }
}
