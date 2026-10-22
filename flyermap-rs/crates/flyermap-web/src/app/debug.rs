//! The hook of the browser flows: with `?debug` in the address the page offers `window.__rsApp` (what a flow needs to look at and to prove things the
//! screens only show indirectly) beside `window.__rsMap` of the map bridge. It reads; the one thing it writes is a marking, through the same
//! `Session::mark` the screens use. Nothing here is reachable without `debug`.
use crate::session::Session;
use flyermap_core::{Key, Status};
use js_sys::{Array, Function, Object, Reflect};
use leptos::prelude::*;
use wasm_bindgen::{closure::Closure, JsCast, JsValue};

fn set(target: &Object, name: &str, f: Function) {
    let _ = Reflect::set(target, &name.into(), &f);
}

fn closure(f: impl Fn(Vec<JsValue>) -> JsValue + 'static) -> Function {
    let c = Closure::<dyn Fn(JsValue, JsValue) -> JsValue>::new(move |a, b| f(vec![a, b]));
    let function = c.as_ref().unchecked_ref::<Function>().clone();
    c.forget();
    function
}

pub fn install(session: Session) {
    if !web_sys::window().and_then(|w| w.location().search().ok()).is_some_and(|s| s.contains("debug")) {
        return;
    }
    let api = Object::new();
    // keys(gebiet, n): the first n house keys of a Gebiet
    set(
        &api,
        "keys",
        closure(move |a| {
            let (gebiet, n) = (a[0].as_string().unwrap_or_default(), a[1].as_f64().unwrap_or(1.0) as usize);
            let keys = Array::new();
            if let Some(l) = session.loaded.get_untracked() {
                let mut found: Vec<&Key> = l.field.area_of.iter().filter(|(k, g)| **g == gebiet && k.as_str().starts_with("h:")).map(|(k, _)| k).collect();
                found.sort();
                for k in found.into_iter().take(n) {
                    keys.push(&JsValue::from_str(k.as_str()));
                }
            }
            keys.into()
        }),
    );
    // mark(keys, status): through the same path as a tap on the map; answers how many changed
    set(
        &api,
        "mark",
        closure(move |a| {
            let keys: Vec<Key> = Array::from(&a[0]).iter().filter_map(|v| v.as_string()).map(Key::new).collect();
            let status = a[1].as_string().and_then(|s| Status::parse(&s)).unwrap_or(Status::Completed);
            JsValue::from_f64(session.mark(&keys, status).count() as f64)
        }),
    );
    // sync(): state, queued edits, the cursor of the store
    set(
        &api,
        "sync",
        closure(move |_| {
            let view = session.sync.get_untracked();
            let (cursor, pending) = session.loaded.get_untracked().map_or((0, 0), |l| {
                let store = l.host.store();
                let s = store.borrow();
                (s.cursor(), s.pending_len())
            });
            JsValue::from_str(&format!(r#"{{"state":"{}","pending":{},"cursor":{},"queued":{}}}"#, view.state.as_str(), view.pending, cursor, pending))
        }),
    );
    // status(key): what this device shows for a key
    set(
        &api,
        "status",
        closure(move |a| {
            let key = Key::new(a[0].as_string().unwrap_or_default());
            let status = session.loaded.get_untracked().map_or(Status::Open, |l| l.host.store().borrow().status_of(&key));
            JsValue::from_str(status.as_str())
        }),
    );
    if let Some(window) = web_sys::window() {
        let _ = Reflect::set(&window, &"__rsApp".into(), &api);
    }
}
