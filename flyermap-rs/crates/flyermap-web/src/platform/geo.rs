//! Where the device is, once, when the person asks (the quick bar's locate button). The position stays on the device: it is shown on the map and
//! never sent anywhere. Refusal and failure are answers, not errors the interface has to survive.
use wasm_bindgen::{closure::Closure, JsCast};

/// `[lng, lat]` and the accuracy in metres.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fix {
    pub at: [f64; 2],
    pub accuracy_m: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GeoError {
    /// The browser has no geolocation.
    Unsupported,
    /// The person said no (or the site may not ask).
    Denied,
    /// No position could be found (no signal, timeout).
    Unavailable,
}

impl GeoError {
    pub fn message(self) -> &'static str {
        match self {
            GeoError::Unsupported => "Dieses Gerät kann den Standort nicht bestimmen.",
            GeoError::Denied => "Der Standort ist nicht erlaubt. Erlaube ihn in den Einstellungen des Browsers.",
            GeoError::Unavailable => "Der Standort konnte nicht bestimmt werden.",
        }
    }
}

/// The code of a `PositionError` (1 denied, 2 unavailable, 3 timeout).
pub fn error_of(code: u16) -> GeoError {
    if code == 1 {
        GeoError::Denied
    } else {
        GeoError::Unavailable
    }
}

/// Ask once; `done` is called with the fix or the reason.
pub fn locate(done: impl FnOnce(Result<Fix, GeoError>) + 'static) {
    let Some(geo) = web_sys::window().and_then(|w| w.navigator().geolocation().ok()) else {
        done(Err(GeoError::Unsupported));
        return;
    };
    // both callbacks share the one `done`
    let done = std::rc::Rc::new(std::cell::RefCell::new(Some(done)));
    let ok_done = std::rc::Rc::clone(&done);
    let ok = Closure::once_into_js(move |position: web_sys::Position| {
        let c = position.coords();
        if let Some(f) = ok_done.borrow_mut().take() {
            f(Ok(Fix { at: [c.longitude(), c.latitude()], accuracy_m: c.accuracy() }));
        }
    });
    let failed = Closure::once_into_js(move |error: web_sys::PositionError| {
        if let Some(f) = done.borrow_mut().take() {
            f(Err(error_of(error.code())));
        }
    });
    let options = web_sys::PositionOptions::new();
    options.set_enable_high_accuracy(true);
    options.set_timeout(15_000);
    options.set_maximum_age(10_000);
    let _ = geo.get_current_position_with_error_callback_and_options(ok.unchecked_ref(), Some(failed.unchecked_ref()), &options);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refusal_is_told_apart_from_no_signal() {
        assert_eq!(error_of(1), GeoError::Denied);
        assert_eq!(error_of(2), GeoError::Unavailable);
        assert_eq!(error_of(3), GeoError::Unavailable);
        assert!(GeoError::Denied.message().contains("erlaubt"));
    }
}
