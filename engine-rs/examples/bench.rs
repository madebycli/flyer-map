use std::time::Instant;
fn main() {
    let raw = std::fs::read("/tmp/bench/raw.json").unwrap();
    for _ in 0..3 {
        let t = Instant::now();
        let parsed = verteil_engine::parse_raw(&raw).unwrap();
        let t1 = t.elapsed();
        let net = verteil_engine::derive_parsed(&parsed);
        let t2 = t.elapsed();
        let out = serde_json::to_vec(&net).unwrap();
        let t3 = t.elapsed();
        println!("parse {:?} · derive {:?} · serialize {:?} ({} MB)", t1, t2 - t1, t3 - t2, out.len() / 1_000_000);
    }
}
