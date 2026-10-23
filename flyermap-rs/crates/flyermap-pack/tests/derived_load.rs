//! The device loader: a derived pack merged into an engine session answers exactly like a session that derived the same data itself
//! (tiles, search, route, lasso, snap, the slim network), for a Gebiet in one piece and for a big one in parts with a manifest.
mod support;
use flyermap_engine::{model::Network, slim, RouteOut, Session};
use flyermap_pack::derived::{derive_pack, load_into, load_network, manifest, DerivedError, DerivedPack, PartRef};
use flyermap_pack::{plan, ENGINE_VERSION};
use serde_json::{json, Value};
use support::city::{city, city_at, Frame};
use support::raw_of;

fn tile_of(lng: f64, lat: f64, z: u32) -> (u32, u32) {
    let n = f64::from(1u32 << z);
    let x = (lng + 180.0) / 360.0 * n;
    let y = (1.0 - (lat.to_radians().tan() + 1.0 / lat.to_radians().cos()).ln() / std::f64::consts::PI) / 2.0 * n;
    (x.floor() as u32, y.floor() as u32)
}

fn route(out: RouteOut) -> Value {
    match out {
        RouteOut::Selected { ids, length, ambiguous } => json!({ "ids": ids, "length": length, "ambiguous": ambiguous }),
        RouteOut::Disconnected => json!("disconnected"),
    }
}

/// Everything a session can be asked, as one value: two sessions are the same when these are equal.
fn answers(s: &mut Session, networks: &[&Network], ring: &[[f64; 2]]) -> Value {
    let mut tiles = Vec::new();
    for z in 11..=17u32 {
        let (x0, y1) = tile_of(ring[0][0], ring[0][1], z);
        let (x1, y0) = tile_of(ring[2][0], ring[2][1], z);
        for x in x0..=x1 {
            for y in y0..=y1 {
                let bytes = s.tile(z, x, y);
                tiles.push(json!([z, x, y, bytes.len(), flyermap_pack_hash(&bytes)]));
            }
        }
    }
    let searches: Vec<Value> =
        ["Querstraße", "quer 3", "längsweg 2", "Querstraße 2 15", "hinterhof", "nichts davon", ""].iter().map(|q| json!(s.search(q, 8))).collect();
    let ids: Vec<String> = networks.iter().flat_map(|n| n.segments.iter().filter(|g| g.visible && g.way_id < 3000).map(|g| g.id.clone())).collect();
    let (first, middle, last) = (ids[0].clone(), ids[ids.len() / 2].clone(), ids[ids.len() - 1].clone());
    let lasso_ring = [
        [ring[0][0] + 0.001, ring[0][1] + 0.001],
        [ring[2][0] - 0.002, ring[0][1] + 0.001],
        [ring[2][0] - 0.002, ring[2][1] - 0.002],
        [ring[0][0] + 0.001, ring[2][1] - 0.002],
    ];
    let mid = [(ring[0][0] + ring[2][0]) / 2.0, (ring[0][1] + ring[2][1]) / 2.0];
    json!({
        "tiles": tiles,
        "search": searches,
        "routes": [route(s.route(&[first.clone(), last])), route(s.route(&[first, middle.clone(), middle])), route(s.route(&["nope".into()]))],
        "lasso": [s.lasso(&lasso_ring, false), s.lasso(&lasso_ring, true)],
        "snap": [s.snap(mid, 25.0, 25.0), s.snap([mid[0] + 0.0003, mid[1]], 5.0, 40.0), s.snap([0.0, 0.0], 5.0, 5.0)],
    })
}

fn flyermap_pack_hash(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3))
}

#[test]
fn a_loaded_pack_answers_like_a_session_that_derived_it() {
    let c = city(8);
    let json = serde_json::to_vec(&raw_of(&c.answer)).unwrap();
    // the device's own way today: parse, derive, cut to the Gebiet, merge
    let direct: Network = flyermap_engine::derive_restricted(&flyermap_engine::parse_raw(&json).unwrap(), &c.ring, None);
    let mut derived = Session::new();
    derived.add(&direct);

    let pack = derive_pack(&raw_of(&c.answer), &c.ring, None, ENGINE_VERSION).unwrap();
    let mut loaded = Session::new();
    let got = load_into(&mut loaded, &pack.bytes).unwrap();

    assert_eq!(serde_json::to_vec(&got.slim).unwrap(), serde_json::to_vec(&slim(&direct)).unwrap(), "the slim network the interface keeps");
    assert_eq!(got.header, pack.header);
    let ours = answers(&mut loaded, &[&direct], &c.ring);
    let theirs = answers(&mut derived, &[&direct], &c.ring);
    assert_eq!(ours, theirs);
    // the comparison can tell sessions apart: a session with another city answers differently
    let other = city(7);
    let mut elsewhere = Session::new();
    elsewhere.add(&flyermap_engine::derive_restricted(
        &flyermap_engine::parse_raw(&serde_json::to_vec(&raw_of(&other.answer)).unwrap()).unwrap(),
        &other.ring,
        None,
    ));
    assert_ne!(answers(&mut elsewhere, &[&direct], &c.ring), theirs);
    let nonempty = ours["tiles"].as_array().unwrap().iter().filter(|t| t[3].as_u64().unwrap() > 0).count();
    assert!(nonempty > 10, "the comparison saw real tiles ({nonempty})");
    assert!(ours["search"][0].as_array().unwrap().len() > 3 && ours["routes"][0]["ids"].as_array().unwrap().len() > 3, "and real answers");

    // loading it again changes nothing (first Area wins)
    load_into(&mut loaded, &pack.bytes).unwrap();
    assert_eq!(answers(&mut loaded, &[&direct], &c.ring), theirs);
    // the pack on its own gives the network the engine derived, byte for byte
    let (_, network) = load_network(&pack.bytes).unwrap();
    assert_eq!(bincode::serialize(&network).unwrap(), bincode::serialize(&direct).unwrap());
    assert_eq!(pack.load_into(&mut Session::new()).unwrap().slim.houses.len(), c.houses);
}

#[test]
fn damaged_packs_never_reach_the_session() {
    let pack = derive_pack(&raw_of(&city(2).answer), &city(2).ring, None, ENGINE_VERSION).unwrap();
    for at in [0, 5, 50, 91, 92, 120, pack.bytes.len() / 2, pack.bytes.len() - 1] {
        let mut bad = pack.bytes.clone();
        bad[at] ^= 0x10;
        let mut session = Session::new();
        assert!(load_into(&mut session, &bad).is_err(), "byte {at}");
        assert!(session.search("Querstraße", 5).is_empty(), "nothing was merged");
    }
    assert!(matches!(load_network(&pack.bytes[..pack.bytes.len() - 3]), Err(DerivedError::Corrupt)));
}

fn answer_for(answer: &Value, [s, w, n, e]: [f64; 4]) -> Value {
    let inside = |lat: f64, lon: f64| lat >= s && lat <= n && lon >= w && lon <= e;
    let kept: Vec<Value> = answer["elements"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|el| match el["geometry"].as_array() {
            Some(points) => points.iter().any(|p| inside(p["lat"].as_f64().unwrap(), p["lon"].as_f64().unwrap())),
            None => inside(el["lat"].as_f64().unwrap_or(f64::NAN), el["lon"].as_f64().unwrap_or(f64::NAN)),
        })
        .cloned()
        .collect();
    json!({ "elements": kept })
}

#[test]
fn a_big_gebiet_in_parts_loads_like_the_parts_derived_one_by_one() {
    // The city is placed so that the corner of four grid cells (lon -30.0, lat 45.0) lies in the middle of it: streets and houses on both
    // sides of both borders. The outline is 3 km x 3 km around it, which the plan cuts into parts.
    let lat0 = 45.0 - 500.0 / 110_574.0;
    let c = city_at(10, Frame([-30.0 - 500.0 / Frame([0.0, lat0]).m_lng(), lat0]));
    let corner = Frame([-30.0, 45.0]);
    let ring: Vec<[f64; 2]> =
        vec![corner.pt(-1500.0, -1500.0), corner.pt(1500.0, -1500.0), corner.pt(1500.0, 1500.0), corner.pt(-1500.0, 1500.0), corner.pt(-1500.0, -1500.0)];
    let the_plan = plan(&ring);
    assert_eq!(the_plan.parts.len(), 4, "four cells");

    let (mut derived, mut loaded, mut networks, mut refs) = (Session::new(), Session::new(), Vec::new(), Vec::new());
    let mut houses = 0;
    for part in &the_plan.parts {
        let raw = raw_of(&answer_for(&c.answer, part.bbox));
        let pack: DerivedPack = derive_pack(&raw, &ring, part.cell, ENGINE_VERSION).unwrap();
        let direct = flyermap_engine::derive_restricted(&flyermap_engine::parse_raw(&serde_json::to_vec(&raw).unwrap()).unwrap(), &ring, part.cell);
        derived.add(&direct);
        load_into(&mut loaded, &pack.bytes).unwrap();
        houses += pack.header.counts.houses as usize;
        refs.push(PartRef::of(part, &pack));
        networks.push(direct);
    }
    assert_eq!(houses, c.houses, "the parts partition the houses: none twice, none lost");
    assert!(networks.iter().all(|n| n.houses.len() > 100), "every part holds houses: {:?}", networks.iter().map(|n| n.houses.len()).collect::<Vec<_>>());
    let all: Vec<&Network> = networks.iter().collect();
    assert_eq!(answers(&mut loaded, &all, &c.ring), answers(&mut derived, &all, &c.ring));

    let whole = manifest(&refs);
    assert_eq!(whole.parts.len(), the_plan.parts.len());
    assert_eq!(whole.hash, manifest(&refs.iter().rev().cloned().collect::<Vec<_>>()).hash, "arrival order does not matter");
    assert_eq!(flyermap_pack::derived::Manifest::from_json(&whole.to_json()).unwrap(), whole);
}
