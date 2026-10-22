//! Replays the requests the TypeScript Worker answered (`scripts/rs-vectors/http.ts`) against the Rust Worker on the same database, in the same
//! order, and demands the same status, the same JSON body and the same caching headers.
use flyermap_worker::Response;
use flyermap_worker::{db::sqlite::SqliteDb, App, Options, Request};
use serde_json::Value;

mod randoms;
mod upstream;

fn base64(text: &str) -> Vec<u8> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut bits = 0u32;
    let mut count = 0;
    let mut out = Vec::new();
    for b in text.bytes().filter(|b| *b != b'=') {
        bits = (bits << 6) | ALPHABET.iter().position(|a| *a == b).unwrap() as u32;
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
        }
    }
    out
}

/// A pack is compared by what is inside (the gzip bytes depend on the compressor); anything else not JSON by its text.
fn same_body(randoms: &mut randoms::Randoms, recorded: &Value, response: &Response) -> bool {
    if let Some(encoded) = recorded.get("base64").and_then(Value::as_str) {
        let want = base64(encoded);
        return match (flyermap_pack::decode(&want), flyermap_pack::decode(&response.body)) {
            (Some(a), Some(b)) => a == b,
            _ => want == response.body,
        };
    }
    if response.header("content-type") != Some("application/json") {
        return recorded.as_str() == Some(String::from_utf8_lossy(&response.body).as_ref());
    }
    randoms.same(recorded, &response.body_json())
}

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
    let source = upstream::replay(&v["upstream"], v["overpass"].as_str().unwrap());
    let options = Options { now: Box::new(move || now), fetch: source.fetch, overpass_url: v["overpass"].as_str().map(str::to_string), ..Options::default() };
    let app = App::new(db, options);
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
        if !same_body(&mut randoms, &e["response"], &response) {
            failures.push(format!("{label}: body differs\n  rust {}\n  ts   {}", String::from_utf8_lossy(&response.body), e["response"]));
        }
        for (header, value) in e["headersOut"].as_object().into_iter().flatten() {
            if response.header(header) != value.as_str() {
                failures.push(format!("{label}: {header} {:?} instead of {value}", response.header(header)));
            }
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
    failures.extend(source.problems.borrow().iter().cloned());
    if !source.left.borrow().is_empty() {
        failures.push(format!("upstream: {} recorded requests were never sent", source.left.borrow().len()));
    }
    assert!(failures.is_empty(), "{} of {} exchanges differ:\n{}", failures.len(), v["exchanges"].as_array().unwrap().len(), failures.join("\n"));
}
