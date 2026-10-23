//! Key presses on the page, as plain data. The page-wide shortcuts need to know whether the person is typing in a field (then letters are letters), and
//! whether a modifier is down; the rest of the event stays in the browser. The listener goes away when it is dropped.
use wasm_bindgen::{closure::Closure, JsCast};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pressed {
    /// `KeyboardEvent.key`: "a", "/", "Escape", "ArrowDown".
    pub key: String,
    /// Ctrl or Cmd.
    pub command: bool,
    pub alt: bool,
    /// The press goes to a text field (an input, a text area, a select, an editable element).
    pub typing: bool,
}

pub struct KeyWatch {
    listener: Closure<dyn FnMut(web_sys::KeyboardEvent)>,
}

impl Drop for KeyWatch {
    fn drop(&mut self) {
        if let Some(window) = web_sys::window() {
            let _ = window.remove_event_listener_with_callback("keydown", self.listener.as_ref().unchecked_ref());
        }
    }
}

fn typing_in(target: Option<web_sys::EventTarget>) -> bool {
    let Some(element) = target.and_then(|t| t.dyn_into::<web_sys::HtmlElement>().ok()) else { return false };
    matches!(element.tag_name().as_str(), "INPUT" | "TEXTAREA" | "SELECT") || element.is_content_editable()
}

/// Call `handle` for every key press of the page; it answers whether it used the press (then the browser's own action is cancelled).
pub fn on_keydown(mut handle: impl FnMut(&Pressed) -> bool + 'static) -> Option<KeyWatch> {
    let window = web_sys::window()?;
    let listener = Closure::<dyn FnMut(web_sys::KeyboardEvent)>::new(move |e: web_sys::KeyboardEvent| {
        let pressed = Pressed { key: e.key(), command: e.ctrl_key() || e.meta_key(), alt: e.alt_key(), typing: typing_in(e.target()) };
        if handle(&pressed) {
            e.prevent_default();
        }
    });
    window.add_event_listener_with_callback("keydown", listener.as_ref().unchecked_ref()).ok()?;
    Some(KeyWatch { listener })
}
