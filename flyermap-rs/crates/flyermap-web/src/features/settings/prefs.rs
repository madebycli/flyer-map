//! The device settings as reactive values. The settings screen writes them, the app applies and persists them (`app::effects`).
use crate::{
    platform::{Hand, Settings, Theme},
    ui::palette::DEFAULT_SEED,
};
use leptos::prelude::*;

#[derive(Clone, Copy)]
pub struct Prefs {
    pub theme: RwSignal<Theme>,
    pub hand: RwSignal<Hand>,
    pub base_on: RwSignal<bool>,
    pub awake: RwSignal<bool>,
    pub haptics: RwSignal<bool>,
    pub sound: RwSignal<bool>,
    /// `#rrggbb`.
    pub seed: RwSignal<String>,
}

impl Prefs {
    pub fn new(s: Settings) -> Prefs {
        Prefs {
            theme: RwSignal::new(s.theme),
            hand: RwSignal::new(s.hand),
            base_on: RwSignal::new(s.base_on),
            awake: RwSignal::new(s.awake),
            haptics: RwSignal::new(s.haptics),
            sound: RwSignal::new(s.sound),
            seed: RwSignal::new(seed_or_default(s.seed.as_deref())),
        }
    }
}

impl Prefs {
    /// How marking feels right now.
    pub fn feedback(&self) -> crate::platform::Feedback {
        crate::platform::Feedback::from_flags(self.haptics.get(), self.sound.get())
    }

    pub fn set_feedback(&self, feedback: crate::platform::Feedback) {
        let (haptic, sound) = feedback.flags();
        self.haptics.set(haptic);
        self.sound.set(sound);
    }

    /// The confirmation of a mark, as chosen (buzz, tone, both or nothing).
    pub fn confirm(&self) {
        crate::platform::sound::confirm(self.haptics.get_untracked(), self.sound.get_untracked());
    }
}

/// A stored seed that is not a colour any more counts as the default.
pub fn seed_or_default(stored: Option<&str>) -> String {
    match stored {
        Some(seed) if crate::ui::palette::color::parse_hex(seed).is_some() => seed.to_string(),
        _ => DEFAULT_SEED.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_broken_seed_is_the_default() {
        assert_eq!(seed_or_default(None), DEFAULT_SEED);
        assert_eq!(seed_or_default(Some("blue")), DEFAULT_SEED);
        assert_eq!(seed_or_default(Some("#2f6bd8")), "#2f6bd8");
    }
}
