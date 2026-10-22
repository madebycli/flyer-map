//! The tile source of the map: a JavaScript function `(z, x, y) → Promise<bytes>` that asks the engine (in its worker) for the vector tile.
use crate::engine::Engine;
use js_sys::{Function, Promise};
use std::rc::Rc;
use wasm_bindgen::{closure::Closure, JsCast, JsValue};
use wasm_bindgen_futures::future_to_promise;

/// One provider per loaded field; the closure lives as long as the page (a few bytes per load).
pub fn provider(engine: Rc<Engine>) -> Function {
    let closure = Closure::<dyn Fn(u32, u32, u32) -> Promise>::new(move |z, x, y| {
        let engine = Rc::clone(&engine);
        future_to_promise(async move { engine.tile(z, x, y).await.map(JsValue::from).map_err(|e| JsValue::from_str(e.code())) })
    });
    let function: Function = closure.as_ref().unchecked_ref::<Function>().clone();
    closure.forget();
    function
}
