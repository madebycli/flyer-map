use flyermap_diag::{breadcrumb, count, diag, install, observe, span, uninstall, Level, MemoryRecorder, Recorder};
use std::{cell::Cell, collections::BTreeMap, rc::Rc};

fn recorder() -> (Rc<MemoryRecorder>, Rc<Cell<u64>>) {
    let now = Rc::new(Cell::new(1000));
    let clock = Rc::clone(&now);
    let r = Rc::new(MemoryRecorder::new(move || clock.get()));
    install(Rc::clone(&r) as Rc<dyn Recorder>);
    (r, now)
}

#[test]
fn nothing_is_built_without_a_recorder() {
    uninstall();
    diag!(Level::Error, "sync", "nobody listens", count = 3);
    count("x", 1);
    assert_eq!(span("y").end(), 0);
}

#[test]
fn events_carry_time_code_and_redacted_fields() {
    let (r, now) = recorder();
    now.set(2000);
    diag!(Level::Warn, "sync", code "sync.push.rejected", "edits refused for good", count = 3, refetch = true);
    diag!(Level::Info, "map", "a position 51.12345, 13.54321 and a link https://x.example/a?b=c", position = "51.1,13.5", ok = true);
    diag!(Level::Debug, "map", "too quiet to keep");
    let events = r.events();
    assert_eq!(events.len(), 2, "debug is below the default level");
    assert_eq!((events[0].t, events[0].code.as_deref()), (2000, Some("sync.push.rejected")));
    assert_eq!(events[1].message, "a position [num] and a link [url]");
    assert_eq!(serde_json::to_value(&events[1].fields["position"]).unwrap(), "[removed]");
    assert_eq!(r.counter("events.warn"), 1);
}

#[test]
fn spans_time_themselves_and_the_report_says_what_went_wrong() {
    let (r, now) = recorder();
    let s = span("sync.round");
    now.set(1250);
    assert_eq!(s.end(), 250);
    observe("net.api_ms", 40.0);
    breadcrumb("menu.open", None);
    breadcrumb("mark", Some(3));
    diag!(Level::Error, "map", code "map.style.failed", "style did not load");
    r.register_probe("store", || serde_json::json!({"pending": 2}));
    let report = r.report("6.0.1", BTreeMap::new(), vec![]);
    assert_eq!(report.histograms["sync.round_ms"].count, 1);
    assert_eq!(report.histograms["sync.round_ms"].max, 250.0);
    assert_eq!(report.problems[0].code, "map.style.failed");
    assert_eq!(report.probes["store"]["pending"], 2);
    assert_eq!(report.breadcrumbs.iter().map(|b| (b.step.as_str(), b.n)).collect::<Vec<_>>(), [("menu.open", None), ("mark", Some(3))]);
    let json = serde_json::to_string(&report).unwrap();
    assert!(!json.contains("style did not load\u{0}"), "plain JSON");
    assert_eq!(serde_json::from_str::<flyermap_diag::Report>(&json).unwrap(), report);
}
