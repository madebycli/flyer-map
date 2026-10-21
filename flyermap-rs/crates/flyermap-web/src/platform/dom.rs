//! The few document-level things the app changes: attributes and CSS variables on `<html>`, the `theme-color` meta tag, the start screen.
use super::error::PlatformError;
use wasm_bindgen::JsCast;

pub fn document() -> Result<web_sys::Document, PlatformError> {
    web_sys::window().and_then(|w| w.document()).ok_or(PlatformError::NoWindow)
}

fn root() -> Result<web_sys::HtmlElement, PlatformError> {
    document()?.document_element().and_then(|e| e.dyn_into::<web_sys::HtmlElement>().ok()).ok_or(PlatformError::NoWindow)
}

pub fn set_root_attr(name: &str, value: &str) -> Result<(), PlatformError> {
    root()?.set_attribute(name, value).map_err(|_| PlatformError::Refused("setAttribute"))
}

pub fn remove_root_attr(name: &str) -> Result<(), PlatformError> {
    root()?.remove_attribute(name).map_err(|_| PlatformError::Refused("removeAttribute"))
}

/// A CSS custom property on `<html>` (inline, so it wins over the stylesheet). `name` includes the leading `--`.
pub fn set_root_var(name: &str, value: &str) -> Result<(), PlatformError> {
    root()?.style().set_property(name, value).map_err(|_| PlatformError::Refused("style.setProperty"))
}

pub fn remove_root_var(name: &str) -> Result<(), PlatformError> {
    root()?.style().remove_property(name).map(|_| ()).map_err(|_| PlatformError::Refused("style.removeProperty"))
}

pub fn set_theme_color(color: &str) -> Result<(), PlatformError> {
    let meta = document()?.query_selector("meta[name=\"theme-color\"]").ok().flatten().ok_or(PlatformError::Unsupported("theme-color meta tag"))?;
    meta.set_attribute("content", color).map_err(|_| PlatformError::Refused("setAttribute"))
}

/// How long the start screen's fade takes (`#splash` in `index.html`), with a little margin.
const SPLASH_FADE_MS: i32 = 400;

/// The plain-HTML start screen of `index.html` fades out once the app has drawn itself, then leaves the document.
pub fn finish_splash() {
    let Some(splash) = document().ok().and_then(|d| d.get_element_by_id("splash")) else {
        return;
    };
    let _ = splash.class_list().add_1("done");
    let remove = wasm_bindgen::closure::Closure::once_into_js(move || splash.remove());
    if let Some(window) = web_sys::window() {
        let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(remove.unchecked_ref(), SPLASH_FADE_MS);
    }
}

/// Leave the app for another page of the site.
pub fn navigate(url: &str) {
    if let Some(window) = web_sys::window() {
        let _ = window.location().assign(url);
    }
}
