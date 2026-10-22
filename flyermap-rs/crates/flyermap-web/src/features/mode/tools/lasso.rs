//! Lasso: circle an area with a finger; the engine, which knows where every house and street piece lies, says what is inside.
use super::ctx::ToolCtx;
use crate::map::{gesture::Tool, hit::P2, ink::Ink};
use flyermap_core::Key;
use leptos::task::spawn_local;
use std::rc::Rc;

/// Points closer than this to the last one are not added: the outline stays light.
const STEP_PX: f64 = 4.0;

pub struct Lasso {
    ctx: Rc<ToolCtx>,
    points: Vec<P2>,
}

impl Lasso {
    pub fn new(ctx: Rc<ToolCtx>) -> Lasso {
        Lasso { ctx, points: Vec::new() }
    }

    fn draw(&self) {
        self.ctx.ink.draw(Some(Ink::Lasso { points: &self.points, closed: false }));
    }
}

impl Tool for Lasso {
    fn hold(&self) -> bool {
        true
    }

    fn down(&mut self, p: P2) -> bool {
        self.points = vec![p];
        true
    }

    fn drag(&mut self, p: P2) {
        let last = self.points.last().copied().unwrap_or(p);
        if (p[0] - last[0]).hypot(p[1] - last[1]) >= STEP_PX {
            self.points.push(p);
            self.draw();
        }
    }

    fn up(&mut self, _p: P2, moved: bool) {
        self.ctx.ink.draw(None);
        let points = std::mem::take(&mut self.points);
        if !moved || points.len() < 3 {
            return;
        }
        let mut ring: Vec<[f64; 2]> = points.iter().map(|p| self.ctx.map.unproject(*p)).collect();
        ring.push(ring[0]);
        let ctx = Rc::clone(&self.ctx);
        spawn_local(async move {
            let view = (ctx.view)();
            let Ok(picked) = ctx.field.engine.lasso(&ring, view.state.houses_only).await else { return };
            let keys: Vec<Key> = picked.houses.iter().map(|id| Key::house(id)).chain(picked.segments.iter().map(|id| Key::segment(id))).collect();
            if !keys.is_empty() {
                (ctx.apply)(keys, view.state.status);
            }
        });
    }

    fn cancel(&mut self) {
        self.ctx.ink.draw(None);
        self.points.clear();
    }
}
