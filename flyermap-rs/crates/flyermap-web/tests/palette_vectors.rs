//! The palette in Rust gives the same hex codes as `src/ui/palette.ts` for every vector made by `scripts/rs-vectors/palette.ts`.
use flyermap_web::{
    platform::Theme,
    ui::palette::{scheme_for, tone_color},
};
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
struct Vectors {
    schemes: Vec<SchemeCase>,
    tones: Vec<ToneCase>,
}

#[derive(Deserialize)]
struct SchemeCase {
    seed: String,
    mode: String,
    scheme: BTreeMap<String, String>,
}

#[derive(Deserialize)]
struct ToneCase {
    hue: f64,
    chroma: f64,
    tone: f64,
    hex: String,
}

fn vectors() -> Vectors {
    serde_json::from_str(include_str!("vectors/palette.json")).expect("palette vectors")
}

#[test]
fn every_scheme_matches_the_typescript_palette() {
    let v = vectors();
    assert!(v.schemes.len() >= 20);
    for case in v.schemes {
        let theme = Theme::parse(Some(case.mode.as_str()));
        let ours = scheme_for(&case.seed, theme);
        assert_eq!(ours.len(), case.scheme.len(), "{} {}", case.seed, case.mode);
        for (role, hex) in &case.scheme {
            assert_eq!(ours.get(role), Some(hex.as_str()), "{} {} {role}", case.seed, case.mode);
        }
    }
}

#[test]
fn every_tone_matches_the_typescript_palette() {
    for case in vectors().tones {
        assert_eq!(tone_color(case.hue, case.chroma, case.tone), case.hex, "hue {} chroma {} tone {}", case.hue, case.chroma, case.tone);
    }
}
