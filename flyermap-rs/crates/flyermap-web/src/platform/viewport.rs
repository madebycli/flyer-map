//! The visible part of the screen (port of `src/v5/app/viewport.ts`). A touch keyboard covers the lower part of the page without shrinking it, so
//! anything pinned to the bottom ends up behind the keys. The visual viewport knows better: `--vvh` is its height and `--kb` the height of what
//! covers the bottom, both in px on `<html>`; `data-kb` is set while a keyboard is up. Sheets use them to stay above the keys.
use super::dom;
use wasm_bindgen::{closure::Closure, JsCast};

/// More than this many covered pixels is a keyboard, not a browser bar.
const KEYBOARD_MIN_PX: i64 = 120;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Visible {
    /// Height of the visible area, px.
    pub height: i64,
    /// Height covered at the bottom, px.
    pub covered: i64,
    pub keyboard: bool,
}

/// `inner_height` of the layout viewport; the visual viewport's height and top offset when the browser has one.
pub fn measure(inner_height: f64, visual: Option<(f64, f64)>) -> Visible {
    let (height, bottom) = match visual {
        Some((h, top)) => (h, h + top),
        None => (inner_height, inner_height),
    };
    let covered = (inner_height - bottom).round().max(0.0) as i64;
    Visible { height: height.round() as i64, covered, keyboard: covered > KEYBOARD_MIN_PX }
}

fn apply() {
    let Some(window) = web_sys::window() else {
        return;
    };
    let inner = window.inner_height().ok().and_then(|v| v.as_f64()).unwrap_or(0.0);
    let visual = window.visual_viewport().map(|vv| (vv.height(), vv.offset_top()));
    let v = measure(inner, visual);
    let _ = dom::set_root_var("--vvh", &format!("{}px", v.height));
    let _ = dom::set_root_var("--kb", &format!("{}px", v.covered));
    let _ = if v.keyboard { dom::set_root_attr("data-kb", "") } else { dom::remove_root_attr("data-kb") };
}

/// Keeps the variables up to date until dropped.
pub struct ViewportWatch {
    listener: Closure<dyn FnMut()>,
}

impl Drop for ViewportWatch {
    fn drop(&mut self) {
        let Some(window) = web_sys::window() else {
            return;
        };
        let f = self.listener.as_ref().unchecked_ref();
        if let Some(vv) = window.visual_viewport() {
            let _ = vv.remove_event_listener_with_callback("resize", f);
            let _ = vv.remove_event_listener_with_callback("scroll", f);
        }
        let _ = window.remove_event_listener_with_callback("resize", f);
    }
}

pub fn watch() -> Option<ViewportWatch> {
    let window = web_sys::window()?;
    apply();
    let listener = Closure::<dyn FnMut()>::new(apply);
    let f = listener.as_ref().unchecked_ref();
    if let Some(vv) = window.visual_viewport() {
        let _ = vv.add_event_listener_with_callback("resize", f);
        let _ = vv.add_event_listener_with_callback("scroll", f);
    }
    let _ = window.add_event_listener_with_callback("resize", f);
    Some(ViewportWatch { listener })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_visual_viewport_means_nothing_covered() {
        assert_eq!(measure(844.0, None), Visible { height: 844, covered: 0, keyboard: false });
    }

    #[test]
    fn a_keyboard_covers_the_bottom() {
        let v = measure(844.0, Some((508.4, 0.0)));
        assert_eq!((v.height, v.covered, v.keyboard), (508, 336, true));
    }

    #[test]
    fn a_small_bar_is_not_a_keyboard_and_scrolling_never_goes_negative() {
        assert!(!measure(844.0, Some((790.0, 0.0))).keyboard);
        assert_eq!(measure(844.0, Some((844.0, 30.0))).covered, 0);
    }
}
