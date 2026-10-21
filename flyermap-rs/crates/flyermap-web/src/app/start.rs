//! Boot: panic hook, settings, look, viewport, then mount the app and let the start screen go.
use super::{effects, fake, root::App, state::AppState};
use crate::{
    features::settings::Prefs,
    platform::{dom, panic, viewport, LocalStore, Settings},
};
use leptos::prelude::*;

pub fn start() {
    panic::install();
    let prefs = Prefs::new(Settings::load(&LocalStore));
    effects::apply_look(&prefs);
    // The watch lives as long as the page.
    std::mem::forget(viewport::watch());
    let state = AppState::new(prefs, fake::world());
    // `mount_to_body` keeps the app for the life of the page (it forgets its own handle).
    leptos::mount::mount_to_body(move || {
        effects::install(prefs);
        view! { <App state=state /> }
    });
    dom::finish_splash();
}
