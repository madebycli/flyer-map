//! Boot: panic hook, settings, look, viewport, the backend the address asks for, then mount the app and let the start screen go.
use super::{effects, root::App, state::AppState};
use crate::{
    backend::{mock::MockBackend, v5::V5Backend, Backend},
    features::settings::Prefs,
    platform::{dom, events::query_param, panic, time::now_ms, viewport, LocalStore, Settings},
    session::Session,
};
use leptos::prelude::*;
use std::rc::Rc;

/// `?campaign=<id>` talks to the `/api/v5` bridge of the Worker; without it the app runs on the mock (`?mock=member` and so on, see the README).
fn backend_for_address() -> Rc<dyn Backend> {
    match query_param("campaign") {
        Some(campaign) => Rc::new(V5Backend::new(&campaign)),
        None => {
            let search = web_sys::window().and_then(|w| w.location().search().ok()).unwrap_or_default();
            Rc::new(MockBackend::new(MockBackend::persona_from(&search), now_ms))
        }
    }
}

pub fn start() {
    panic::install();
    let prefs = Prefs::new(Settings::load(&LocalStore));
    effects::apply_look(&prefs);
    // The watch lives as long as the page.
    std::mem::forget(viewport::watch());
    let session = Session::new(backend_for_address());
    let state = AppState::new(prefs, session);
    super::debug::install(session);
    // `mount_to_body` keeps the app for the life of the page (it forgets its own handle).
    leptos::mount::mount_to_body(move || {
        effects::install(prefs);
        session.start();
        view! { <App state=state /> }
    });
    dom::finish_splash();
}
