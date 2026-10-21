//! Replays the requests the TypeScript Worker answered (`scripts/rs-vectors/http.ts`) against the Rust Worker on the same database, in the same
//! order, and demands the same status, the same JSON body and the same caching headers.
use flyermap_worker::{db::sqlite::SqliteDb, App, Options, Request};
use serde_json::Value;

mod randoms;

fn vectors() -> (Value, String) {
    let dir = format!("{}/tests/vectors", env!("CARGO_MANIFEST_DIR"));
    let json = serde_json::from_str(&std::fs::read_to_string(format!("{dir}/v5.json")).unwrap()).unwrap();
    (json, std::fs::read_to_string(format!("{dir}/v5.seed.sql")).unwrap())
}

#[test]
fn the_rust_worker_answers_like_the_typescript_worker() {
    let (v, seed) = vectors();
    let db = SqliteDb::in_memory().unwrap();
    db.exec(&seed).unwrap();
    let now = v["now"].as_u64().unwrap();
    let app = App::new(db, Options { now: Box::new(move || now), ..Options::default() });
    let mut failures = Vec::new();
    let mut randoms = randoms::Randoms::default();
    for (n, e) in v["exchanges"].as_array().unwrap().iter().enumerate() {
        let mut request = Request::new(e["method"].as_str().unwrap(), &format!("https://example.test{}", randoms.rewrite(e["path"].as_str().unwrap())));
        for (name, value) in e["headers"].as_object().unwrap() {
            request = request.with_header(name, &randoms.rewrite(value.as_str().unwrap()));
        }
        if let Some(body) = e["body"].as_str() {
            request = request.with_body(randoms.rewrite(body).into_bytes());
        }
        let response = futures::executor::block_on(app.handle(&request)).expect("a v5 route");
        let label = format!("#{n} {} {} {}", e["who"], e["method"], e["path"]);
        if u64::from(response.status) != e["status"].as_u64().unwrap() {
            failures.push(format!("{label}: status {} instead of {}\n  body {}", response.status, e["status"], String::from_utf8_lossy(&response.body)));
            continue;
        }
        if !randoms.same(&e["response"], &response.body_json()) {
            failures.push(format!("{label}: body differs\n  rust {}\n  ts   {}", response.body_json(), e["response"]));
        }
        for (header, key) in [("content-type", "contentType"), ("cache-control", "cacheControl")] {
            if response.header(header) != e[key].as_str() {
                failures.push(format!("{label}: {header} {:?} instead of {:?}", response.header(header), e[key]));
            }
        }
        if !randoms.same_cookie(e["setCookie"].as_str(), response.header("set-cookie")) {
            failures.push(format!("{label}: set-cookie {:?} instead of {:?}", response.header("set-cookie"), e["setCookie"]));
        }
        assert!(response.header("x-request-id").is_some() && response.header("server-timing").is_some(), "{label}: observability headers");
    }
    assert!(failures.is_empty(), "{} of {} exchanges differ:\n{}", failures.len(), v["exchanges"].as_array().unwrap().len(), failures.join("\n"));
}
