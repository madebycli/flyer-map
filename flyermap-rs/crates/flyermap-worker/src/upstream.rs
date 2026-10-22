//! Requests the Worker sends elsewhere (the map data source). Behind a function in [`crate::Options`], so the handlers never see the platform:
//! the Worker passes the real `fetch` with a time limit, tests pass recorded answers.
use std::{future::Future, pin::Pin};

pub struct Outgoing {
    pub url: String,
    pub headers: Vec<(String, String)>,
    /// Sent as a POST body.
    pub body: String,
}

pub struct Incoming {
    pub status: u16,
    pub body: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    /// No answer within the time limit.
    Timeout,
    /// No answer at all (DNS, connection, TLS).
    Unreachable,
}

pub type Answer = Pin<Box<dyn Future<Output = Result<Incoming, Failure>>>>;
pub type Fetch = Box<dyn Fn(Outgoing) -> Answer>;

/// For hosts without network (tests that do not care): every request fails as unreachable.
pub fn offline() -> Fetch {
    Box::new(|_| Box::pin(async { Err(Failure::Unreachable) }))
}

/// The platform's `fetch`, cancelled after `limit_ms` (the body included).
#[cfg(target_arch = "wasm32")]
pub fn platform(limit_ms: u64) -> Fetch {
    use std::{cell::Cell, rc::Rc};
    use worker::{AbortController, Delay, Headers, Method, RequestInit};
    Box::new(move |out: Outgoing| {
        Box::pin(async move {
            let headers = Headers::new();
            for (name, value) in &out.headers {
                headers.set(name, value).map_err(|_| Failure::Unreachable)?;
            }
            let mut init = RequestInit::new();
            init.with_method(Method::Post).with_headers(headers).with_body(Some(worker::wasm_bindgen::JsValue::from_str(&out.body)));
            let request = worker::Request::new_with_init(&out.url, &init).map_err(|_| Failure::Unreachable)?;
            let controller = AbortController::default();
            let signal = controller.signal();
            let timed_out = Rc::new(Cell::new(false));
            let flag = timed_out.clone();
            worker::wasm_bindgen_futures::spawn_local(async move {
                Delay::from(std::time::Duration::from_millis(limit_ms)).await;
                flag.set(true);
                controller.abort();
            });
            let failure = |timed_out: &Rc<Cell<bool>>| if timed_out.get() { Failure::Timeout } else { Failure::Unreachable };
            let mut response = worker::Fetch::Request(request).send_with_signal(&signal).await.map_err(|_| failure(&timed_out))?;
            let status = response.status_code();
            let body = response.text().await.map_err(|_| failure(&timed_out))?;
            Ok(Incoming { status, body })
        })
    })
}
