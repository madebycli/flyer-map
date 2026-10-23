//! Page-level events the sync and the map react to (online, offline, visibility, page hide), as listeners that are removed when dropped.
use wasm_bindgen::{closure::Closure, JsCast};

pub struct Listener {
    target: web_sys::EventTarget,
    name: &'static str,
    callback: Closure<dyn FnMut()>,
}

impl Drop for Listener {
    fn drop(&mut self) {
        let _ = self.target.remove_event_listener_with_callback(self.name, self.callback.as_ref().unchecked_ref());
    }
}

fn listen(target: web_sys::EventTarget, name: &'static str, f: impl FnMut() + 'static) -> Option<Listener> {
    let callback = Closure::<dyn FnMut()>::new(f);
    target.add_event_listener_with_callback(name, callback.as_ref().unchecked_ref()).ok()?;
    Some(Listener { target, name, callback })
}

/// `online`, `offline`, `pagehide` on the window.
pub fn on_window(name: &'static str, f: impl FnMut() + 'static) -> Option<Listener> {
    listen(web_sys::window()?.into(), name, f)
}

/// `visibilitychange` on the document.
pub fn on_document(name: &'static str, f: impl FnMut() + 'static) -> Option<Listener> {
    listen(web_sys::window()?.document()?.into(), name, f)
}

/// What the browser believes about the network (a hint: true does not promise that the server answers).
pub fn online() -> bool {
    web_sys::window().map(|w| w.navigator().on_line()).unwrap_or(true)
}

pub fn page_visible() -> bool {
    web_sys::window().and_then(|w| w.document()).map(|d| d.visibility_state() == web_sys::VisibilityState::Visible).unwrap_or(true)
}

/// A query parameter of the page address (`?campaign=…`).
pub fn query_param(name: &str) -> Option<String> {
    let search = web_sys::window()?.location().search().ok()?;
    web_sys::UrlSearchParams::new_with_str(&search).ok()?.get(name).filter(|v| !v.is_empty())
}
