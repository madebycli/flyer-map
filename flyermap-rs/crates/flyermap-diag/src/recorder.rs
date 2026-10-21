//! The seam between pure code and the host. Pure crates call [`emit`], [`count`], [`gauge`], [`observe`] and [`breadcrumb`]; the host installs one
//! [`Recorder`] per thread (the browser and the Worker are single threaded; every native test thread has its own, so tests cannot disturb each other).
use crate::{
    event::{Event, Value},
    level::Level,
};
use std::{cell::RefCell, rc::Rc};

pub trait Recorder {
    /// Milliseconds since the epoch; the only clock diagnostics use.
    fn now_ms(&self) -> u64;
    fn record(&self, event: Event);
    fn count(&self, _name: &str, _n: u64) {}
    fn gauge(&self, _name: &str, _value: f64) {}
    fn observe(&self, _name: &str, _value: f64) {}
    fn breadcrumb(&self, _step: &str, _n: Option<i64>) {}
}

thread_local! {
    static CURRENT: RefCell<Option<Rc<dyn Recorder>>> = const { RefCell::new(None) };
}

pub fn install(recorder: Rc<dyn Recorder>) {
    CURRENT.with(|c| *c.borrow_mut() = Some(recorder));
}

pub fn uninstall() {
    CURRENT.with(|c| *c.borrow_mut() = None);
}

fn with<R>(f: impl FnOnce(&dyn Recorder) -> R) -> Option<R> {
    let recorder = CURRENT.with(|c| c.borrow().clone())?;
    Some(f(recorder.as_ref()))
}

pub fn now_ms() -> Option<u64> {
    with(|r| r.now_ms())
}

/// Record one event. With no recorder installed nothing is built.
pub fn emit(level: Level, area: &str, code: Option<&str>, message: &str, fields: &[(&str, Value)]) {
    with(|r| r.record(Event::new(r.now_ms(), level, area, code, message, fields)));
}

pub fn count(name: &str, n: u64) {
    with(|r| r.count(name, n));
}
pub fn gauge(name: &str, value: f64) {
    with(|r| r.gauge(name, value));
}
pub fn observe(name: &str, value: f64) {
    with(|r| r.observe(name, value));
}
pub fn breadcrumb(step: &str, n: Option<i64>) {
    with(|r| r.breadcrumb(step, n));
}

/// `diag!(Level::Warn, "sync", code "sync.push.rejected", "edits refused", count = 3, refetch = true)` without the field list noise.
#[macro_export]
macro_rules! diag {
    ($level:expr, $area:expr, $message:expr $(, $key:ident = $value:expr)* $(,)?) => {
        $crate::emit($level, $area, None, $message, &[$((stringify!($key), $crate::Value::from($value))),*])
    };
    ($level:expr, $area:expr, code $code:expr, $message:expr $(, $key:ident = $value:expr)* $(,)?) => {
        $crate::emit($level, $area, Some($code), $message, &[$((stringify!($key), $crate::Value::from($value))),*])
    };
}
