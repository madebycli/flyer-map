//! Diagnostics for Verteil-Flyer, designed so that one report tells what happened, in which order, how long it took and what the person did before,
//! without anything that identifies a person or a place.
//!
//! Pure crates only *emit* (`emit`, `count`, `observe`, `breadcrumb`, `span`); with no recorder installed that costs a branch. The host installs a
//! [`Recorder`] once: the browser a [`MemoryRecorder`] (ring buffer, metrics, breadcrumbs, report), the Worker a recorder that writes one JSON line per event.
//!
//! Text is redacted when an event is *built* (`redact`), so unsafe text never reaches a buffer, a console or a server log.
pub mod breadcrumb;
pub mod event;
pub mod finding;
pub mod level;
pub mod memory;
pub mod metrics;
pub mod recorder;
pub mod redact;
pub mod report;
pub mod ring;
pub mod span;

pub use breadcrumb::Breadcrumb;
pub use event::{Event, Value};
pub use finding::Finding;
pub use level::Level;
pub use memory::MemoryRecorder;
pub use metrics::{Histogram, HistogramSummary, Metrics};
pub use recorder::{breadcrumb, count, emit, gauge, install, observe, uninstall, Recorder};
pub use report::{Report, REPORT_SCHEMA};
pub use span::{span, Span};
