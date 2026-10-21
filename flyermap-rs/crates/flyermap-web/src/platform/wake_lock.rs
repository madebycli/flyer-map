//! Keep the screen on while the page is visible (port of `keepAwake` in `src/pwa/device.ts`). The browser drops the lock when the tab hides, so
//! it is asked for again when the tab shows. `navigator.wakeLock` is an unstable API in `web-sys`; it is reached through `js_sys::Reflect`
//! instead of a crate-wide `--cfg web_sys_unstable_apis`.
use super::{dom, error::PlatformError};
use js_sys::{Function, Promise, Reflect};
use std::{cell::RefCell, rc::Rc};
use wasm_bindgen::{closure::Closure, JsCast, JsValue};
use wasm_bindgen_futures::{spawn_local, JsFuture};

#[derive(Default)]
struct State {
    sentinel: Option<JsValue>,
    asking: bool,
    stopped: bool,
}

/// Holds the lock until dropped.
pub struct KeepAwake {
    state: Rc<RefCell<State>>,
    on_visible: Closure<dyn FnMut()>,
}

fn wake_lock_api() -> Result<JsValue, PlatformError> {
    let navigator = web_sys::window().ok_or(PlatformError::NoWindow)?.navigator();
    let api = Reflect::get(&navigator, &"wakeLock".into()).map_err(|_| PlatformError::Unsupported("wake lock"))?;
    if api.is_undefined() || api.is_null() {
        return Err(PlatformError::Unsupported("wake lock"));
    }
    Ok(api)
}

fn release(sentinel: &JsValue) {
    if let Ok(f) = Reflect::get(sentinel, &"release".into()).and_then(|f| f.dyn_into::<Function>()) {
        // The promise it returns may reject when the lock is already gone; nothing to do about that.
        let _ = f.call0(sentinel);
    }
}

fn ask(state: &Rc<RefCell<State>>) {
    let visible = dom::document().map(|d| d.visibility_state() == web_sys::VisibilityState::Visible).unwrap_or(false);
    {
        let s = state.borrow();
        if s.stopped || s.asking || s.sentinel.is_some() || !visible {
            return;
        }
    }
    let Ok(api) = wake_lock_api() else { return };
    let request = Reflect::get(&api, &"request".into()).ok().and_then(|f| f.dyn_into::<Function>().ok());
    let Some(promise) = request.and_then(|f| f.call1(&api, &"screen".into()).ok()).and_then(|p| p.dyn_into::<Promise>().ok()) else {
        return;
    };
    state.borrow_mut().asking = true;
    let state = Rc::clone(state);
    spawn_local(async move {
        let result = JsFuture::from(promise).await;
        let stopped = {
            let mut s = state.borrow_mut();
            s.asking = false;
            s.stopped
        };
        // Refused (battery saver, no user gesture yet): the next `visibilitychange` asks again.
        let Ok(sentinel) = result else { return };
        if stopped {
            release(&sentinel);
            return;
        }
        let weak = Rc::downgrade(&state);
        let on_release = Closure::once_into_js(move || {
            if let Some(state) = weak.upgrade() {
                if let Ok(mut s) = state.try_borrow_mut() {
                    s.sentinel = None;
                }
            }
        });
        if let Ok(add) = Reflect::get(&sentinel, &"addEventListener".into()).and_then(|f| f.dyn_into::<Function>()) {
            let _ = add.call2(&sentinel, &"release".into(), &on_release);
        }
        state.borrow_mut().sentinel = Some(sentinel);
    });
}

impl KeepAwake {
    /// `Err(Unsupported)` where the browser has no wake lock (Firefox before 126, older iOS): the setting then simply does nothing.
    pub fn start() -> Result<KeepAwake, PlatformError> {
        wake_lock_api()?;
        let state = Rc::new(RefCell::new(State::default()));
        let again = Rc::clone(&state);
        let on_visible = Closure::<dyn FnMut()>::new(move || ask(&again));
        dom::document()?
            .add_event_listener_with_callback("visibilitychange", on_visible.as_ref().unchecked_ref())
            .map_err(|_| PlatformError::Refused("addEventListener"))?;
        ask(&state);
        Ok(KeepAwake { state, on_visible })
    }
}

impl Drop for KeepAwake {
    fn drop(&mut self) {
        let sentinel = {
            let mut s = self.state.borrow_mut();
            s.stopped = true;
            s.sentinel.take()
        };
        // Released only after the borrow ends: the browser fires the sentinel's `release` event synchronously inside `release()`, and
        // its listener writes to the same state (found by scripts/rs-e2e/shell.mjs: "RefCell already borrowed").
        if let Some(sentinel) = sentinel {
            release(&sentinel);
        }
        if let Ok(document) = dom::document() {
            let _ = document.remove_event_listener_with_callback("visibilitychange", self.on_visible.as_ref().unchecked_ref());
        }
    }
}
