//! When a round starts besides local edits: the network comes back, the page shows again, and every 15 s while visible (other devices'
//! marks arrive without a push channel). Hiding or leaving the page saves everything at once.
use super::host::SyncHost;
use crate::platform::events::{on_document, on_window, page_visible, Listener};
use wasm_bindgen::{closure::Closure, JsCast};

const POLL_MS: i32 = 15_000;

/// Keeps the triggers alive; dropping it removes them.
pub struct Triggers {
    _listeners: Vec<Listener>,
    _poll: Closure<dyn FnMut()>,
    poll_id: Option<i32>,
}

impl Drop for Triggers {
    fn drop(&mut self) {
        if let (Some(window), Some(id)) = (web_sys::window(), self.poll_id) {
            window.clear_interval_with_handle(id);
        }
    }
}

pub fn install(host: &SyncHost) -> Triggers {
    let mut listeners = Vec::new();
    let h = host.clone();
    listeners.extend(on_window("online", move || {
        flyermap_diag::breadcrumb("net.online", None);
        h.kick();
    }));
    listeners.extend(on_window("offline", move || flyermap_diag::breadcrumb("net.offline", None)));
    let h = host.clone();
    listeners.extend(on_document("visibilitychange", move || if page_visible() { h.kick() } else { h.flush() }));
    let h = host.clone();
    listeners.extend(on_window("pagehide", move || h.flush()));
    let h = host.clone();
    let poll = Closure::<dyn FnMut()>::new(move || {
        if page_visible() {
            h.kick();
        }
    });
    let poll_id = web_sys::window().and_then(|w| w.set_interval_with_callback_and_timeout_and_arguments_0(poll.as_ref().unchecked_ref(), POLL_MS).ok());
    Triggers { _listeners: listeners, _poll: poll, poll_id }
}
