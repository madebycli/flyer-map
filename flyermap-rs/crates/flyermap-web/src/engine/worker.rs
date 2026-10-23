//! The main-thread end of the engine worker (`engine-worker.js`): one request, one awaited reply. Every request is measured (round trip as
//! the app sees it, compute time inside the worker) through `flyermap-diag`.
use super::error::EngineError;
use js_sys::{Array, Function, Promise, Reflect, Uint8Array};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
};
use wasm_bindgen::{closure::Closure, JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;

/// One argument of an engine function: a number, or bytes the worker copies into engine memory (pointer + length).
pub enum Arg {
    Num(f64),
    Bytes(Uint8Array),
}

pub struct Reply {
    /// What the engine function returned (for most: 0 = failure, else the length of the result).
    pub n: u32,
    pub bytes: Option<Uint8Array>,
}

type Pending = Rc<RefCell<HashMap<u32, Function>>>;

pub struct EngineWorker {
    worker: web_sys::Worker,
    pending: Pending,
    next: Cell<u32>,
    _on_message: Closure<dyn FnMut(web_sys::MessageEvent)>,
    _on_error: Closure<dyn FnMut()>,
}

impl EngineWorker {
    /// Start the worker from `url` (relative to the page). `None` when the browser cannot start it.
    pub fn start(url: &str) -> Option<EngineWorker> {
        let worker = web_sys::Worker::new(url).ok()?;
        let pending: Pending = Rc::default();
        let waiting = Rc::clone(&pending);
        let on_message = Closure::<dyn FnMut(web_sys::MessageEvent)>::new(move |event: web_sys::MessageEvent| {
            let data = event.data();
            let id = Reflect::get(&data, &"id".into()).ok().and_then(|v| v.as_f64()).unwrap_or(-1.0) as u32;
            if let Some(resolve) = waiting.borrow_mut().remove(&id) {
                let _ = resolve.call1(&JsValue::NULL, &data);
            }
        });
        worker.set_onmessage(Some(on_message.as_ref().unchecked_ref()));
        let failed = Rc::clone(&pending);
        let on_error = Closure::<dyn FnMut()>::new(move || {
            flyermap_diag::count("engine.worker.crashed", 1);
            flyermap_diag::diag!(flyermap_diag::Level::Error, "engine", code "engine.worker.crashed", "the engine worker crashed");
            let crashed = js_sys::Object::new();
            let _ = Reflect::set(&crashed, &"error".into(), &"engine_worker_failed".into());
            for (_, resolve) in failed.borrow_mut().drain() {
                let _ = resolve.call1(&JsValue::NULL, &crashed);
            }
        });
        worker.set_onerror(Some(on_error.as_ref().unchecked_ref()));
        Some(EngineWorker { worker, pending, next: Cell::new(1), _on_message: on_message, _on_error: on_error })
    }

    /// Call `function` in the engine. `give` hands the bytes of the arguments over instead of copying them (a 10 MB pack is not duplicated).
    pub async fn call(&self, function: &str, args: Vec<Arg>, give: bool) -> Result<Reply, EngineError> {
        let id = self.next.get();
        self.next.set(id.wrapping_add(1));
        let list = Array::new();
        let transfer = Array::new();
        for arg in args {
            match arg {
                Arg::Num(n) => list.push(&JsValue::from_f64(n)),
                Arg::Bytes(bytes) => {
                    if give {
                        transfer.push(&bytes.buffer());
                    }
                    list.push(&bytes)
                }
            };
        }
        let message = js_sys::Object::new();
        let _ = Reflect::set(&message, &"id".into(), &JsValue::from(id));
        let _ = Reflect::set(&message, &"fn".into(), &JsValue::from_str(function));
        let _ = Reflect::set(&message, &"args".into(), &list);
        let pending = Rc::clone(&self.pending);
        let promise = Promise::new(&mut |resolve, _reject| {
            pending.borrow_mut().insert(id, resolve);
        });
        let t0 = crate::platform::time::mono_ms();
        if self.worker.post_message_with_transfer(&message, &transfer).is_err() {
            self.pending.borrow_mut().remove(&id);
            return Err(EngineError::Unavailable);
        }
        let data = JsFuture::from(promise).await.map_err(|_| EngineError::Unavailable)?;
        let rtt = crate::platform::time::mono_ms() - t0;
        let field = |name: &str| Reflect::get(&data, &name.into()).ok().filter(|v| !v.is_undefined() && !v.is_null());
        if let Some(error) = field("error").and_then(|e| e.as_string()) {
            return Err(EngineError::Worker(error));
        }
        let ms = field("ms").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let op = function.trim_start_matches("session_");
        flyermap_diag::observe(&format!("engine.{op}.rtt_ms"), rtt);
        flyermap_diag::observe(&format!("engine.{op}.compute_ms"), ms);
        Ok(Reply { n: field("n").and_then(|v| v.as_f64()).unwrap_or(0.0) as u32, bytes: field("bytes").and_then(|b| b.dyn_into::<Uint8Array>().ok()) })
    }
}

impl Drop for EngineWorker {
    fn drop(&mut self) {
        self.worker.terminate();
    }
}
