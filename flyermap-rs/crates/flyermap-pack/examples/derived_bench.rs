//! What the derived pack saves, measured on the synthetic city of the tests (`tests/support/city.rs`, the same generator, so a number here
//! can be reproduced by anyone and no real place is involved).
//!
//!     cargo run --release -p flyermap-pack --example derived_bench -- [blocks ...]      (default: 10 30 80; 80 blocks = about 51 000 houses)
//!
//! Three questions, answered per size:
//!  1. What does the device save? Deriving itself (parse the raw pack, derive, cut to the Gebiet, merge) against loading the derived pack
//!     (check, inflate, decode, merge). Both start from bytes that came over the network.
//!  2. What does it cost on the wire? Raw pack (gzip JSON) against derived pack (gzip bincode).
//!  3. What does an update cost? A delta after OSM edits to a few houses in a thousand, against the new pack and against the new raw pack.
//!  4. Where do the bytes go? Streets, houses and coordinates, inflated and compressed, so the next saving is found where the bytes are.
//!  5. Which gzip level? The pack is compressed once on the server (`COMPRESSION_LEVEL`), so this is the table that level was chosen from.
//!
//! Times are the median of three runs, native and single-threaded. The browser runs the same code as WebAssembly, which is slower by a
//! factor that depends on the phone: read the ratios, not the milliseconds.
#[path = "../tests/support/mod.rs"]
mod support;

use flate2::{read::GzDecoder, write::DeflateEncoder, Compression};
use flyermap_engine::Session;
use flyermap_pack::derived::{apply, apply_to_payload, derive_pack_json, diff, load_into, manifest, DerivedPack, PartRef, COMPRESSION_LEVEL};
use flyermap_pack::{encode, plan, ENGINE_VERSION};
use std::io::{Read, Write};
use std::time::{Duration, Instant};
use support::city::{city, edit};
use support::{pack_of, raw_of};

const RUNS: usize = 3;
/// Edits per thousand buildings, with the number of streets renamed.
const EDITS: [(usize, usize); 4] = [(2, 0), (10, 1), (30, 2), (100, 5)];

fn median<T>(mut run: impl FnMut() -> T) -> (Duration, T) {
    let mut times = Vec::with_capacity(RUNS);
    let mut last = None;
    for _ in 0..RUNS {
        let t = Instant::now();
        let out = run();
        times.push(t.elapsed());
        last = Some(out);
    }
    times.sort();
    (times[RUNS / 2], last.expect("at least one run"))
}

fn ms(d: Duration) -> String {
    let v = d.as_secs_f64() * 1000.0;
    if v >= 100.0 {
        format!("{v:.0} ms")
    } else {
        format!("{v:.1} ms")
    }
}

fn size(n: usize) -> String {
    match n {
        0..=9_999 => format!("{n} B"),
        10_000..=9_999_999 => format!("{:.1} kB", n as f64 / 1e3),
        _ => format!("{:.1} MB", n as f64 / 1e6),
    }
}

fn gunzip(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    GzDecoder::new(bytes).read_to_end(&mut out).expect("gzip");
    out
}

fn main() {
    let blocks: Vec<usize> = std::env::args().skip(1).filter_map(|a| a.parse().ok()).collect();
    let blocks = if blocks.is_empty() { vec![10, 30, 80] } else { blocks };
    println!("derived pack · engine {ENGINE_VERSION} · synthetic city · median of {RUNS} runs · native, one thread\n");
    for n in blocks {
        let c = city(n);
        let raw = raw_of(&c.answer);
        let raw_gz = encode(&raw);
        let raw_json = serde_json::to_vec(&raw).expect("json");
        println!("## {n} x {n} blocks: {} houses, {} raw JSON, {} as raw pack (gzip)\n", c.houses, size(raw_json.len()), size(raw_gz.len()));

        // 1. the server makes the pack once
        let (make, pack) = median(|| derive_pack_json(&raw_json, &c.ring, None, ENGINE_VERSION).expect("derives"));
        // 2. the device, the old way: raw pack in, network out
        let (derive_on_device, houses) = median(|| {
            let json = gunzip(&raw_gz);
            let parsed = flyermap_engine::parse_raw(&json).expect("parse");
            let network = flyermap_engine::derive_restricted(&parsed, &c.ring, None);
            let mut session = Session::new();
            session.add(&network);
            flyermap_engine::slim(&network).houses.len()
        });
        // 3. the device, with the pack
        let (load_on_device, loaded) = median(|| {
            let mut session = Session::new();
            load_into(&mut session, &pack.bytes).expect("loads").slim.houses.len()
        });
        assert_eq!(houses, loaded, "both ways end with the same houses");
        let (verify_only, _) = median(|| flyermap_pack::derived::verify(&pack.bytes).expect("verifies"));
        println!("| | raw pack | derived pack |");
        println!("|---|---|---|");
        println!("| on the wire (gzip) | {} | {} ({:.1}x) |", size(raw_gz.len()), size(pack.bytes.len()), pack.bytes.len() as f64 / raw_gz.len() as f64);
        println!("| inflated | {} | {} |", size(raw_json.len()), size(pack.header.payload_len as usize));
        println!(
            "| device: bytes to session | {} | {} ({:.1}x faster) |",
            ms(derive_on_device),
            ms(load_on_device),
            derive_on_device.as_secs_f64() / load_on_device.as_secs_f64()
        );
        println!("| device: check only (head + hash of the file) | | {} |", ms(verify_only));
        println!("| server: made once | | {} |", ms(make));
        println!("| name | | `{}` |\n", flyermap_pack::derived::address(&pack));

        // where the bytes are
        let network = pack.network().expect("network");
        let (segments, houses_bytes) = (bincode::serialize(&network.segments).expect("bincode"), bincode::serialize(&network.houses).expect("bincode"));
        let points = network.segments.iter().map(|s| s.coords.len()).sum::<usize>() + network.houses.iter().map(|h| h.ring.len() + 1).sum::<usize>();
        let packed = |bytes: &[u8]| {
            let mut encoder = DeflateEncoder::new(Vec::new(), Compression::new(COMPRESSION_LEVEL));
            encoder.write_all(bytes).expect("memory");
            encoder.finish().expect("memory").len()
        };
        println!("| inside | inflated | compressed |");
        println!("|---|---|---|");
        println!("| {} street pieces | {} | {} |", network.segments.len(), size(segments.len()), size(packed(&segments)));
        println!("| {} houses | {} | {} |", network.houses.len(), size(houses_bytes.len()), size(packed(&houses_bytes)));
        println!("| of it coordinates: {points} points x 16 B | {} ({:.0} %) | |", size(points * 16), points as f64 * 1600.0 / pack.header.payload_len as f64);
        println!(
            "| per house | {} B | {} B |\n",
            pack.header.payload_len / u64::from(pack.header.counts.houses.max(1)),
            pack.bytes.len() / pack.header.counts.houses.max(1) as usize
        );

        // gzip levels of the same payload
        let payload = pack.payload().expect("payload");
        println!("| gzip level | derived pack | compressing |");
        println!("|---|---|---|");
        for level in [1, 6, 9] {
            let (time, packed) = median(|| {
                let mut encoder = DeflateEncoder::new(Vec::new(), Compression::new(level));
                encoder.write_all(&payload).expect("memory");
                encoder.finish().expect("memory")
            });
            let note = if level == COMPRESSION_LEVEL { " (used)" } else { "" };
            println!("| {level}{note} | {} | {} |", size(packed.len()), ms(time));
        }
        println!();

        // 4. updates
        let old_payload = payload;
        println!("| OSM edits | delta | vs new pack | vs new raw pack | diff (server) | apply on device | apply and seal (cache) |");
        println!("|---|---|---|---|---|---|---|");
        for (round, (per_mille, streets)) in EDITS.into_iter().enumerate() {
            let (answer, done) = edit(&c.answer, per_mille, streets, 7 + round as u64);
            let new_raw_gz = encode(&raw_of(&answer));
            let new: DerivedPack = pack_of(&answer, &c.ring);
            let what = format!("{} houses changed, {} streets", done.renumbered + done.removed + done.added, done.renamed_streets);
            let (diff_time, delta) = median(|| diff(&pack, &new).expect("diffs"));
            match delta {
                Some(delta) => {
                    // the device holds the inflated payload of the pack it has and hands the new one to the engine
                    let (apply_time, new_payload) = median(|| apply_to_payload(&old_payload, &delta).expect("applies"));
                    assert_eq!(new_payload, new.payload().expect("payload"), "the delta gives the new payload, byte for byte");
                    let (sealed_time, rebuilt) = median(|| apply(&pack, &delta).expect("applies"));
                    assert_eq!(rebuilt.bytes, new.bytes, "and the new pack, byte for byte");
                    println!(
                        "| {what} | {} | {:.1} % | {:.1} % | {} | {} | {} |",
                        size(delta.bytes.len()),
                        delta.bytes.len() as f64 * 100.0 / new.bytes.len() as f64,
                        delta.bytes.len() as f64 * 100.0 / new_raw_gz.len() as f64,
                        ms(diff_time),
                        ms(apply_time),
                        ms(sealed_time)
                    );
                }
                None => println!(
                    "| {what} | not worth a delta: the pack ({}) | 100 % | {:.1} % | {} | | |",
                    size(new.bytes.len()),
                    new.bytes.len() as f64 * 100.0 / new_raw_gz.len() as f64,
                    ms(diff_time)
                ),
            }
        }
        println!();
    }

    // 5. a big Gebiet in parts: the manifest is the one small file that is fetched first
    let corner = support::city::Frame([-30.0, 45.0]);
    let ring: Vec<[f64; 2]> =
        vec![corner.pt(-4500.0, -4500.0), corner.pt(4500.0, -4500.0), corner.pt(4500.0, 4500.0), corner.pt(-4500.0, 4500.0), corner.pt(-4500.0, -4500.0)];
    let the_plan = plan(&ring);
    let refs: Vec<PartRef> = the_plan
        .parts
        .iter()
        .map(|part| {
            // an empty part is the cheapest possible pack: what a manifest costs for a cell with nothing in it
            let pack = derive_pack_json(br#"{"ways":[],"buildings":[],"addresses":[]}"#, &ring, part.cell, ENGINE_VERSION).expect("derives");
            PartRef::of(part, &pack)
        })
        .collect();
    let whole = manifest(&refs);
    println!("## manifest of a 9 km x 9 km Gebiet\n");
    println!(
        "{} parts, manifest {} (`{}`); a device that holds all of them fetches {} more\n",
        whole.parts.len(),
        size(whole.to_json().len()),
        whole.address(),
        size(whole.bytes_to_fetch(&whole) as usize)
    );
}
