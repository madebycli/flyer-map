//! The device settings of the app (look and feel, nothing that changes data), read and written with the keys of the React app.
use super::{error::PlatformError, keys, storage::KeyValue, theme::Theme};

/// The hand that holds the phone: the floating controls sit on its side.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Hand {
    #[default]
    Right,
    Left,
}

impl Hand {
    pub fn parse(stored: Option<&str>) -> Hand {
        if stored == Some("left") {
            Hand::Left
        } else {
            Hand::Right
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Hand::Right => "right",
            Hand::Left => "left",
        }
    }
}

/// An on/off setting that is on unless it was switched off (`"off"`).
pub fn parse_toggle(stored: Option<&str>) -> bool {
    stored != Some("off")
}

pub fn toggle_str(on: bool) -> &'static str {
    if on {
        "on"
    } else {
        "off"
    }
}

/// How marking feels: a buzz, a tone, both or neither. The quick bar steps through the four with one button.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Feedback {
    #[default]
    Off,
    Haptic,
    HapticSound,
    Sound,
}

impl Feedback {
    pub fn from_flags(haptic: bool, sound: bool) -> Feedback {
        match (haptic, sound) {
            (false, false) => Feedback::Off,
            (true, false) => Feedback::Haptic,
            (true, true) => Feedback::HapticSound,
            (false, true) => Feedback::Sound,
        }
    }

    /// `(haptic, sound)`.
    pub fn flags(self) -> (bool, bool) {
        match self {
            Feedback::Off => (false, false),
            Feedback::Haptic => (true, false),
            Feedback::HapticSound => (true, true),
            Feedback::Sound => (false, true),
        }
    }

    pub fn next(self) -> Feedback {
        match self {
            Feedback::Off => Feedback::Haptic,
            Feedback::Haptic => Feedback::HapticSound,
            Feedback::HapticSound => Feedback::Sound,
            Feedback::Sound => Feedback::Off,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Feedback::Off => "Aus",
            Feedback::Haptic => "Vibration",
            Feedback::HapticSound => "Vibration und Ton",
            Feedback::Sound => "Ton",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Settings {
    pub theme: Theme,
    pub hand: Hand,
    /// The street map under the houses.
    pub base_on: bool,
    /// Keep the screen awake while the app is visible.
    pub awake: bool,
    /// A short buzz when marking.
    pub haptics: bool,
    /// A short tone when marking (off unless chosen).
    pub sound: bool,
    /// The stored seed colour (`#rrggbb`), `None` for the default.
    pub seed: Option<String>,
}

impl Settings {
    pub fn load(store: &dyn KeyValue) -> Settings {
        let read = |key| store.read(key);
        Settings {
            theme: Theme::parse(read(keys::THEME).as_deref()),
            hand: Hand::parse(read(keys::HAND).as_deref()),
            base_on: parse_toggle(read(keys::BASE).as_deref()),
            awake: parse_toggle(read(keys::AWAKE).as_deref()),
            haptics: parse_toggle(read(keys::HAPTICS).as_deref()),
            sound: read(keys::SOUND).as_deref() == Some("on"),
            seed: read(keys::SEED),
        }
    }
}

pub fn save_theme(store: &dyn KeyValue, theme: Theme) -> Result<(), PlatformError> {
    store.write(keys::THEME, theme.as_str())
}

pub fn save_hand(store: &dyn KeyValue, hand: Hand) -> Result<(), PlatformError> {
    store.write(keys::HAND, hand.as_str())
}

pub fn save_toggle(store: &dyn KeyValue, key: &str, on: bool) -> Result<(), PlatformError> {
    store.write(key, toggle_str(on))
}

/// The default seed is not stored, so a later change of the default reaches everybody who never chose.
pub fn save_seed(store: &dyn KeyValue, seed: &str, default: &str) -> Result<(), PlatformError> {
    if seed.eq_ignore_ascii_case(default) {
        store.remove(keys::SEED)
    } else {
        store.write(keys::SEED, seed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::storage::MemoryStore;

    #[test]
    fn defaults_when_nothing_is_stored() {
        let s = Settings::load(&MemoryStore::default());
        assert_eq!(s.theme, Theme::Dark);
        assert_eq!(s.hand, Hand::Right);
        assert!(s.base_on && s.awake && s.haptics);
        assert!(!s.sound, "a tone is a choice");
        assert_eq!(s.seed, None);
    }

    #[test]
    fn the_four_feelings_go_round() {
        let mut f = Feedback::Off;
        let mut seen = Vec::new();
        for _ in 0..4 {
            f = f.next();
            seen.push(f.flags());
        }
        assert_eq!(seen, [(true, false), (true, true), (false, true), (false, false)]);
        assert_eq!(Feedback::from_flags(true, true).label(), "Vibration und Ton");
        assert_eq!(Feedback::from_flags(false, false), Feedback::Off);
    }

    #[test]
    fn what_is_saved_is_loaded_with_the_react_keys() {
        let store = MemoryStore::default();
        save_theme(&store, Theme::Light).unwrap();
        save_hand(&store, Hand::Left).unwrap();
        save_toggle(&store, keys::BASE, false).unwrap();
        save_toggle(&store, keys::AWAKE, false).unwrap();
        save_seed(&store, "#2f6bd8", "#1f8a70").unwrap();
        assert_eq!(store.read("vf-v5-theme").as_deref(), Some("light"));
        assert_eq!(store.read("vf-v5-base").as_deref(), Some("off"));
        let s = Settings::load(&store);
        assert_eq!((s.theme, s.hand, s.base_on, s.awake, s.haptics), (Theme::Light, Hand::Left, false, false, true));
        assert_eq!(s.seed.as_deref(), Some("#2f6bd8"));
        save_seed(&store, "#1F8A70", "#1f8a70").unwrap();
        assert_eq!(Settings::load(&store).seed, None, "the default seed is removed, not stored");
    }
}
