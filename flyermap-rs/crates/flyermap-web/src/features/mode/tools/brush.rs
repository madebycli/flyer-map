//! Wischen: a highlighter. A thick see-through stroke follows the finger; everything it touches on the screen is previewed, and on lifting it is marked.
use super::ctx::ToolCtx;
use crate::{
    map::{gesture::Tool, hit::P2, ink::Ink, query::Touched},
    ui::status,
};
use std::rc::Rc;

pub struct Brush {
    ctx: Rc<ToolCtx>,
    points: Vec<P2>,
    last: Option<P2>,
    touched: Touched,
}

impl Brush {
    pub fn new(ctx: Rc<ToolCtx>) -> Brush {
        Brush { ctx, points: Vec::new(), last: None, touched: Touched::default() }
    }

    fn touch(&mut self, a: P2, b: P2) {
        let view = (self.ctx.view)();
        self.ctx.map.brush_touch(a, b, view.state.size.px() / 2.0, &mut self.touched);
    }

    fn keys(&self) -> Vec<flyermap_core::Key> {
        let v = (self.ctx.view)().state;
        self.ctx.field.index.keys_for_touched(
            self.touched.houses.iter().map(String::as_str),
            self.touched.segments.iter().map(String::as_str),
            v.with_houses,
            v.houses_only,
        )
    }

    fn redraw(&self) {
        let view = (self.ctx.view)();
        self.ctx.ink.draw(Some(Ink::Stroke { points: &self.points, color: status::color(view.theme, view.state.status), width: view.state.size.px() }));
        self.ctx.map.set_preview(&self.keys());
    }
}

impl Tool for Brush {
    fn hold(&self) -> bool {
        true
    }

    fn down(&mut self, p: P2) -> bool {
        self.touched = Touched::default();
        self.points = vec![p];
        self.last = Some(p);
        self.touch(p, p);
        self.redraw();
        true
    }

    fn drag(&mut self, p: P2) {
        let from = self.last.unwrap_or(p);
        // a fast finger skips pixels: the whole line from the last point is tested, not just the new one
        self.touch(from, p);
        if (p[0] - from[0]).hypot(p[1] - from[1]) >= 3.0 {
            self.points.push(p);
            self.last = Some(p);
        }
        self.redraw();
    }

    fn up(&mut self, _p: P2, _moved: bool) {
        let keys = self.keys();
        self.ctx.map.set_preview(&[]);
        if !keys.is_empty() {
            (self.ctx.apply)(keys, (self.ctx.view)().state.status);
        }
        // the stroke stays a moment, then fades away: the marked colours take over
        self.ctx.ink.fade();
        self.points.clear();
    }

    fn cancel(&mut self) {
        self.ctx.map.set_preview(&[]);
        self.ctx.ink.draw(None);
        self.points.clear();
    }
}
