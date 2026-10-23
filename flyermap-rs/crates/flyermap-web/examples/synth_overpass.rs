//! Prints the synthetic Overpass answer of the mock backend for a box, for the local test stack (`scripts/rs-e2e/overpass-stub.mjs` answers the Worker's
//! map data requests with it): `synth_overpass <south> <west> <north> <east> [salt]`. Nothing real: a street grid with houses, made up.
use flyermap_web::backend::mock::synth::overpass;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let n = |i: usize| args.get(i).and_then(|v| v.parse::<f64>().ok());
    let (Some(s), Some(w), Some(nn), Some(e)) = (n(0), n(1), n(2), n(3)) else {
        eprintln!("usage: synth_overpass <south> <west> <north> <east> [salt]");
        std::process::exit(2);
    };
    let salt = args.get(4).map_or("stub", String::as_str);
    println!("{}", overpass([s, w, nn, e], salt));
}
