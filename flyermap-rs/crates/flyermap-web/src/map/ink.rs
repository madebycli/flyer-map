//! The ink of the finger tools (highlighter stroke, lasso outline) on a canvas of its own in screen pixels, over the map: one canvas path is one
//! shape, so a wide see-through stroke shows no seams (a map line layer would draw every joint as its own triangles).
use super::hit::P2;
use std::cell::Cell;
use wasm_bindgen::{closure::Closure, JsCast};

pub enum Ink<'a> {
    Stroke { points: &'a [P2], color: &'a str, width: f64 },
    Lasso { points: &'a [P2], closed: bool },
}

const LASSO: &str = "#7aa8ff";

pub struct InkCanvas {
    canvas: web_sys::HtmlCanvasElement,
    fading: Cell<Option<i32>>,
}

impl InkCanvas {
    pub fn new(container: &web_sys::HtmlElement) -> Option<InkCanvas> {
        let canvas: web_sys::HtmlCanvasElement = web_sys::window()?.document()?.create_element("canvas").ok()?.dyn_into().ok()?;
        canvas.set_class_name("v5-ink");
        let _ = canvas.set_attribute("aria-hidden", "true");
        let _ = canvas.set_attribute("style", "position:absolute;left:0;top:0;pointer-events:none;opacity:0");
        container.append_child(&canvas).ok()?;
        Some(InkCanvas { canvas, fading: Cell::new(None) })
    }

    fn stop_fade(&self) {
        if let (Some(id), Some(w)) = (self.fading.take(), web_sys::window()) {
            w.clear_timeout_with_handle(id);
        }
    }

    fn set_style(&self, opacity: &str, transition: &str) {
        let style = self.canvas.style();
        let _ = style.set_property("opacity", opacity);
        let _ = style.set_property("transition", transition);
    }

    pub fn draw(&self, ink: Option<Ink>) {
        self.stop_fade();
        let Some(parent) = self.canvas.parent_element() else { return };
        let (w, h) = (f64::from(parent.client_width()), f64::from(parent.client_height()));
        let dpr = web_sys::window().map(|w| w.device_pixel_ratio()).unwrap_or(1.0).min(3.0);
        let (pw, ph) = ((w * dpr).round() as u32, (h * dpr).round() as u32);
        if self.canvas.width() != pw || self.canvas.height() != ph {
            self.canvas.set_width(pw);
            self.canvas.set_height(ph);
            let _ = self.canvas.style().set_property("width", &format!("{w}px"));
            let _ = self.canvas.style().set_property("height", &format!("{h}px"));
        }
        let Some(g) = self.canvas.get_context("2d").ok().flatten().and_then(|c| c.dyn_into::<web_sys::CanvasRenderingContext2d>().ok()) else {
            return;
        };
        let _ = g.set_transform(dpr, 0.0, 0.0, dpr, 0.0, 0.0);
        g.clear_rect(0.0, 0.0, w, h);
        let path = |points: &[P2]| {
            g.begin_path();
            for (i, p) in points.iter().enumerate() {
                if i == 0 {
                    g.move_to(p[0], p[1]);
                } else {
                    g.line_to(p[0], p[1]);
                }
            }
        };
        g.set_line_join("round");
        g.set_line_cap("round");
        match ink {
            None => self.set_style("0", "none"),
            Some(Ink::Stroke { points, color, width }) if !points.is_empty() => {
                self.set_style("0.42", "none");
                g.set_stroke_style_str(color);
                g.set_line_width(width);
                path(points);
                if points.len() == 1 {
                    g.line_to(points[0][0] + 0.01, points[0][1]);
                }
                g.stroke();
            }
            Some(Ink::Lasso { points, closed }) if !points.is_empty() => {
                self.set_style("1", "none");
                if points.len() >= 3 {
                    path(points);
                    g.close_path();
                    g.set_global_alpha(0.2);
                    g.set_fill_style_str(LASSO);
                    // even-odd: the rule the engine selects by
                    g.fill_with_canvas_winding_rule(web_sys::CanvasWindingRule::Evenodd);
                    g.set_global_alpha(1.0);
                }
                g.set_stroke_style_str(LASSO);
                g.set_line_width(3.0);
                path(points);
                if closed {
                    g.close_path();
                }
                g.stroke();
            }
            Some(_) => self.set_style("0", "none"),
        }
    }

    /// Let the ink fade away (the marked colours take over), then clear it.
    pub fn fade(&self) {
        self.stop_fade();
        self.set_style("0", "opacity 420ms ease-out");
        let canvas = self.canvas.clone();
        let clear = Closure::once_into_js(move || {
            canvas.set_width(canvas.width());
        });
        self.fading.set(web_sys::window().and_then(|w| w.set_timeout_with_callback_and_timeout_and_arguments_0(clear.unchecked_ref(), 450).ok()));
    }
}
