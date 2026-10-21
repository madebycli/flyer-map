//! What follows from the settings: the theme and the palette on the page, the screen kept awake, a buzz as confirmation, and everything stored
//! with the keys of the React app. Runs once per app.
use crate::{
    features::settings::Prefs,
    platform::{keys, settings, theme, vibrate, wake_lock::KeepAwake, LocalStore},
    ui::palette::{self, DEFAULT_SEED},
};
use leptos::prelude::*;

/// Apply the look before the first render (no flash of the default colours).
pub fn apply_look(prefs: &Prefs) {
    let theme = prefs.theme.get_untracked();
    theme::apply(theme);
    prefs.seed.with_untracked(|seed| palette::apply(seed, theme));
}

pub fn install(prefs: Prefs) {
    let store = LocalStore;
    // Storage errors are ignored on purpose: the value lives on in memory for the session (see `platform::storage`).
    Effect::new(move |_| {
        let (theme_now, seed) = (prefs.theme.get(), prefs.seed.get());
        theme::apply(theme_now);
        palette::apply(&seed, theme_now);
        let _ = settings::save_theme(&store, theme_now);
        let _ = settings::save_seed(&store, &seed, DEFAULT_SEED);
    });
    Effect::new(move |_| {
        let _ = settings::save_hand(&store, prefs.hand.get());
    });
    Effect::new(move |_| {
        let _ = settings::save_toggle(&store, keys::BASE, prefs.base_on.get());
    });

    // The lock is not `Send` (it holds browser objects), so it lives in local storage of the reactive arena.
    let lock = StoredValue::new_local(None::<KeepAwake>);
    Effect::new(move |_| {
        let on = prefs.awake.get();
        let _ = settings::save_toggle(&store, keys::AWAKE, on);
        // Dropping the old lock releases it; a browser without wake lock leaves `None`.
        lock.set_value(if on { KeepAwake::start().ok() } else { None });
    });
    Effect::new(move |before: Option<bool>| {
        let on = prefs.haptics.get();
        let _ = settings::save_toggle(&store, keys::HAPTICS, on);
        // switching it on buzzes once, so the person feels what they chose
        if before == Some(false) && on {
            vibrate::tick(true);
        }
        on
    });
}
