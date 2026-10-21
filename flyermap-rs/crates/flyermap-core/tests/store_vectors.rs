//! Replays the scenarios made by the TypeScript store (`scripts/rs-vectors/store.ts`) and demands the same state after every step.
//! `VECTORS_FILE=/path/big.json cargo test -p flyermap-core --test store_vectors` runs a long fuzz file instead of the committed one.
use flyermap_core::{Key, Op, OpId, Persisted, Status, Store};
use serde_json::{json, Value};
use std::collections::HashMap;

fn load() -> Value {
    let path = std::env::var("VECTORS_FILE")
        .unwrap_or_else(|_| format!("{}/tests/vectors/store.json", env!("CARGO_MANIFEST_DIR")));
    serde_json::from_str(&std::fs::read_to_string(path).expect("vector file")).expect("vector json")
}

fn keys(v: &Value) -> Vec<Key> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|k| Key::new(k.as_str().unwrap()))
        .collect()
}
fn ids(v: &Value) -> Vec<OpId> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|k| OpId::new(k.as_str().unwrap()))
        .collect()
}
fn areas(v: &Value) -> HashMap<Key, Option<String>> {
    v.as_object()
        .unwrap()
        .iter()
        .map(|(k, a)| (Key::new(k.as_str()), a.as_str().map(String::from)))
        .collect()
}

fn overlay_of(store: &Store) -> Value {
    let mut rows: Vec<(String, &'static str, String, String)> = store
        .entries()
        .map(|(k, e)| {
            (
                k.to_string(),
                e.status.as_str(),
                e.at.to_string(),
                e.by.clone(),
            )
        })
        .collect();
    rows.sort();
    json!(rows)
}

fn conflicts_of(store: &Store) -> Value {
    json!(store
        .conflicts()
        .iter()
        .map(|c| json!({"key": c.key, "mine": c.mine, "theirs": c.theirs, "by": c.by, "at": c.at}))
        .collect::<Vec<_>>())
}

fn observe(store: &Store) -> Value {
    json!({"overlay": overlay_of(store), "pending": store.pending_ops(), "cursor": store.cursor(), "conflicts": conflicts_of(store), "clockOffset": store.clock_offset_ms()})
}

fn changes_of(store: &mut Store) -> Value {
    let mut rows: Vec<(String, &'static str)> = store
        .take_changes()
        .into_iter()
        .map(|(k, s)| (k.to_string(), s.as_str()))
        .collect();
    rows.sort();
    json!(rows)
}

#[test]
fn the_rust_store_follows_the_typescript_store_step_by_step() {
    let vectors = load();
    let mut steps_run = 0;
    for scenario in vectors["scenarios"].as_array().unwrap() {
        let seed = scenario["seed"].as_u64().unwrap();
        let mut store = Store::new(scenario["actor"].as_str().unwrap());
        for (n, step) in scenario["steps"].as_array().unwrap().iter().enumerate() {
            let at = format!("seed {seed} step {n} ({})", step["cmd"]);
            let now = step["now"].as_u64().unwrap_or(0);
            let mut result = Value::Null;
            match step["cmd"].as_str().unwrap() {
                "set" => {
                    let table = areas(&step["areas"]);
                    let status = Status::parse(step["status"].as_str().unwrap()).unwrap();
                    let ops = store.set(&keys(&step["keys"]), status, now, &|k| {
                        table.get(k).cloned().flatten()
                    });
                    result = json!(ops);
                }
                "receive" => {
                    let ops: Vec<Op> = serde_json::from_value(step["ops"].clone()).unwrap();
                    store.receive(&ops, step["cursor"].as_u64(), now);
                }
                "acknowledge" => store.acknowledge(&ids(&step["ids"])),
                "rollback" => store.rollback(&ids(&step["ids"])),
                "forget" => result = json!(store.forget(&keys(&step["keys"]))),
                "reconcile" => {
                    let known = keys(&step["known"]);
                    let table = areas(&step["areas"]);
                    result = json!(store.reconcile_pending(&|k| known.contains(k), &|k| table
                        .get(k)
                        .cloned()
                        .flatten()));
                }
                "sync_clock" => store.sync_clock(step["serverNow"].as_u64().unwrap(), now),
                "rewind" => store.rewind_cursor(),
                "dismiss" => match step["keys"].as_array() {
                    Some(_) => store.dismiss_conflicts(Some(&keys(&step["keys"]))),
                    None => store.dismiss_conflicts(None),
                },
                "restart" => {
                    let saved: Persisted = serde_json::from_value(step["saved"].clone()).unwrap();
                    let mut again = Store::restore(scenario["actor"].as_str().unwrap(), &saved);
                    let expected = &step["result"]["restored"];
                    assert_eq!(
                        overlay_of(&again),
                        expected["overlay"],
                        "{at}: restored overlay"
                    );
                    assert_eq!(
                        json!(again.pending_ops()),
                        expected["pending"],
                        "{at}: restored queue"
                    );
                    assert_eq!(
                        again.cursor(),
                        expected["cursor"].as_u64().unwrap(),
                        "{at}: restored cursor"
                    );
                    let _ = again.take_changes();
                    // what we would save ourselves must be what the oracle saved
                    let mine = store.snapshot(true);
                    assert_eq!(
                        json!(mine.pending),
                        json!(saved.pending),
                        "{at}: saved queue"
                    );
                    assert_eq!(mine.cursor, saved.cursor, "{at}: saved cursor");
                    assert_eq!(mine.clock, saved.clock, "{at}: saved clock");
                    let mut theirs = saved.overlay.clone();
                    theirs.sort_by(|a, b| a.0.cmp(&b.0));
                    assert_eq!(mine.overlay, theirs, "{at}: saved overlay");
                    result = step["result"].clone();
                }
                other => panic!("unknown step {other}"),
            }
            if step["cmd"] != "restart" {
                assert_eq!(result, step["result"], "{at}: result");
            }
            assert_eq!(observe(&store), step["after"], "{at}: state");
            assert_eq!(changes_of(&mut store), step["changes"], "{at}: changes");
            let findings: Vec<_> = store
                .check()
                .into_iter()
                .filter(|f| f.code != "overlay.bad_id")
                .collect();
            assert!(findings.is_empty(), "{at}: invariants broken: {findings:?}");
            steps_run += 1;
        }
    }
    assert!(steps_run > 500, "only {steps_run} steps ran");
}
