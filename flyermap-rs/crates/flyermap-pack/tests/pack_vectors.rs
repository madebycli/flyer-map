//! The pack steps against the TypeScript engine (`scripts/rs-vectors/pack.ts`): the same parts, the same query text, the same cleaned data.
use flyermap_pack::{decode, encode, normalize, overpass_query, padded_bbox, plan};
use serde_json::{json, Value};

fn vectors() -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("{}/tests/vectors/pack.json", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap()
}

fn ring(v: &Value) -> Vec<[f64; 2]> {
    serde_json::from_value(v.clone()).unwrap()
}

/// Numbers compared as numbers (`13` and `13.0` are the same).
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(a, b)| same(a, b)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w))),
        _ => a == b,
    }
}

#[test]
fn plans_match() {
    for case in vectors()["plans"].as_array().unwrap() {
        let r = ring(&case["ring"]);
        let ours = serde_json::to_value(plan(&r)).unwrap();
        assert!(same(&ours, &case["plan"]), "{}: plan differs\n rust {ours}\n ts   {}", case["name"], case["plan"]);
        assert!(same(&json!(padded_bbox(&r, 80.0)), &case["padded"]), "{}: padded box", case["name"]);
    }
}

#[test]
fn queries_match_word_for_word() {
    for case in vectors()["queries"].as_array().unwrap() {
        let bbox: [f64; 4] = serde_json::from_value(case["bbox"].clone()).unwrap();
        assert_eq!(overpass_query(&bbox), case["query"].as_str().unwrap());
    }
}

#[test]
fn answers_are_cleaned_the_same_way() {
    for case in vectors()["normalized"].as_array().unwrap() {
        match (normalize(&case["answer"]), case.get("error")) {
            (Ok((raw, stats)), None) => {
                let ours = json!({ "raw": raw, "stats": stats });
                assert!(same(&ours, &case["result"]), "differs\n rust {ours}\n ts   {}", case["result"]);
                assert!(same(&decode(&encode(&raw)).unwrap(), &case["result"]["raw"]), "the pack holds the raw data");
            }
            (Err(_), Some(_)) => {}
            (ours, ts) => panic!("rust {ours:?}, ts error {ts:?}"),
        }
    }
}

#[test]
fn the_engine_version_is_the_engines() {
    assert_eq!(flyermap_pack::ENGINE_VERSION, flyermap_engine::ENGINE_VERSION);
}
