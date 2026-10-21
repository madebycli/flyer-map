//! The colours offered in the colour sheet; the first one is what the app looked like before and stays the default.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Seed {
    pub id: &'static str,
    pub name: &'static str,
    pub hex: &'static str,
}

pub const SEEDS: [Seed; 8] = [
    Seed {
        id: "smaragd",
        name: "Smaragd",
        hex: "#1f8a70",
    },
    Seed {
        id: "blau",
        name: "Blau",
        hex: "#2f6bd8",
    },
    Seed {
        id: "violett",
        name: "Violett",
        hex: "#7a4fd3",
    },
    Seed {
        id: "rosa",
        name: "Rosa",
        hex: "#c8498a",
    },
    Seed {
        id: "rot",
        name: "Rot",
        hex: "#d2453b",
    },
    Seed {
        id: "orange",
        name: "Orange",
        hex: "#d9791f",
    },
    Seed {
        id: "gold",
        name: "Gold",
        hex: "#a98a1f",
    },
    Seed {
        id: "gruen",
        name: "Grün",
        hex: "#4a9a3a",
    },
];

pub const DEFAULT_SEED: &str = SEEDS[0].hex;

/// Whether `seed` is one of the offered colours (any case); otherwise it is the person's own.
pub fn is_offered(seed: &str) -> bool {
    SEEDS.iter().any(|s| s.hex.eq_ignore_ascii_case(seed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offered_ignores_case() {
        assert!(is_offered("#1F8A70"));
        assert!(!is_offered("#123456"));
    }
}
