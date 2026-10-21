//! The recorder for the browser and for tests: ring buffers for events and steps, metrics, probes, and the report. The host gives it a clock.
use crate::{
    breadcrumb::Breadcrumb,
    event::{Event, Value},
    finding::Finding,
    level::Level,
    metrics::Metrics,
    recorder::Recorder,
    report::{problems_of, Report, REPORT_SCHEMA},
    ring::Ring,
};
use std::{cell::RefCell, collections::BTreeMap};

const EVENTS: usize = 600;
const CRUMBS: usize = 50;

struct State {
    events: Ring<Event>,
    crumbs: Ring<Breadcrumb>,
    metrics: Metrics,
    min_level: Level,
}

type Probe = Box<dyn Fn() -> serde_json::Value>;
type Sink = Box<dyn Fn(&Event)>;

pub struct MemoryRecorder {
    clock: Box<dyn Fn() -> u64>,
    state: RefCell<State>,
    probes: RefCell<BTreeMap<String, Probe>>,
    sink: RefCell<Option<Sink>>,
}

impl MemoryRecorder {
    pub fn new(clock: impl Fn() -> u64 + 'static) -> MemoryRecorder {
        MemoryRecorder {
            clock: Box::new(clock),
            state: RefCell::new(State {
                events: Ring::new(EVENTS),
                crumbs: Ring::new(CRUMBS),
                metrics: Metrics::default(),
                min_level: Level::Info,
            }),
            probes: RefCell::new(BTreeMap::new()),
            sink: RefCell::new(None),
        }
    }

    /// Events below this level are dropped (default `info`); warnings and errors are always kept.
    pub fn set_min_level(&self, level: Level) {
        self.state.borrow_mut().min_level = level.min(Level::Warn);
    }

    /// Every kept event is also handed to this function (the browser console).
    pub fn set_sink(&self, sink: impl Fn(&Event) + 'static) {
        *self.sink.borrow_mut() = Some(Box::new(sink));
    }

    /// A named view into some part of the app (store, sync loop, map): called when a report is built.
    pub fn register_probe(&self, name: &str, probe: impl Fn() -> serde_json::Value + 'static) {
        self.probes
            .borrow_mut()
            .insert(name.to_string(), Box::new(probe));
    }

    pub fn events(&self) -> Vec<Event> {
        self.state.borrow().events.iter().cloned().collect()
    }

    pub fn counter(&self, name: &str) -> u64 {
        self.state
            .borrow()
            .metrics
            .counters()
            .get(name)
            .copied()
            .unwrap_or(0)
    }

    pub fn clear(&self) {
        let mut s = self.state.borrow_mut();
        s.events.clear();
        s.crumbs.clear();
    }

    /// Build the report now. `env` describes the device (browser, screen, storage); `findings` come from the checks of the parts (for example the store's).
    pub fn report(
        &self,
        build: &str,
        env: BTreeMap<String, Value>,
        findings: Vec<Finding>,
    ) -> Report {
        let probes = self
            .probes
            .borrow()
            .iter()
            .map(|(name, probe)| (name.clone(), probe()))
            .collect();
        let s = self.state.borrow();
        Report {
            schema: REPORT_SCHEMA,
            created_at: (self.clock)(),
            build: build.to_string(),
            env,
            counters: s.metrics.counters().clone(),
            gauges: s.metrics.gauges().clone(),
            histograms: s.metrics.histograms(),
            problems: problems_of(s.events.iter()),
            findings,
            probes,
            breadcrumbs: s.crumbs.iter().cloned().collect(),
            events: s.events.iter().cloned().collect(),
            events_dropped: s.events.dropped(),
            breadcrumbs_dropped: s.crumbs.dropped(),
        }
    }
}

impl Recorder for MemoryRecorder {
    fn now_ms(&self) -> u64 {
        (self.clock)()
    }
    fn record(&self, event: Event) {
        if event.level < self.state.borrow().min_level {
            return;
        }
        if let Some(sink) = self.sink.borrow().as_ref() {
            sink(&event);
        }
        let mut s = self.state.borrow_mut();
        if event.level >= Level::Warn {
            s.metrics
                .count(&format!("events.{}", event.level.as_str()), 1);
        }
        s.events.push(event);
    }
    fn count(&self, name: &str, n: u64) {
        self.state.borrow_mut().metrics.count(name, n);
    }
    fn gauge(&self, name: &str, value: f64) {
        self.state.borrow_mut().metrics.gauge(name, value);
    }
    fn observe(&self, name: &str, value: f64) {
        self.state.borrow_mut().metrics.observe(name, value);
    }
    fn breadcrumb(&self, step: &str, n: Option<i64>) {
        let t = (self.clock)();
        self.state.borrow_mut().crumbs.push(Breadcrumb {
            t,
            step: crate::redact::redact_text(step, 60),
            n,
        });
    }
}
