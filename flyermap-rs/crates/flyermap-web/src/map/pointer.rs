//! Feeds the browser's pointer events on the map to the finger rules (`gesture.rs`) and carries out what they decide: start or stop the hold timer, switch
//! the map's own pan off while a drawing tool owns the finger and on again after, and a short buzz when the tool takes the finger. The rules are pure; this is
//! the part that touches the browser. One driver per map; the active tool can change at any time.
use super::{
    field_map::FieldMap,
    gesture::{Effect, Gestures, Tool, HOLD_MS},
    hit::P2,
};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};
use wasm_bindgen::{closure::Closure, JsCast};

struct Inner {
    map: FieldMap,
    gestures: RefCell<Gestures>,
    tool: RefCell<Option<Box<dyn Tool>>>,
    hold: Cell<Option<i32>>,
    on_armed: Box<dyn Fn()>,
}

/// One registered browser listener: the event name and the closure that stays alive with it.
type Listener = (&'static str, Closure<dyn FnMut(web_sys::PointerEvent)>);

pub struct PointerDriver {
    inner: Rc<Inner>,
    listeners: Vec<Listener>,
    container: web_sys::HtmlElement,
}

fn position(container: &web_sys::HtmlElement, e: &web_sys::PointerEvent) -> P2 {
    let r = container.get_bounding_client_rect();
    [f64::from(e.client_x()) - r.left(), f64::from(e.client_y()) - r.top()]
}

impl Inner {
    fn stop_hold(&self) {
        if let (Some(id), Some(w)) = (self.hold.take(), web_sys::window()) {
            w.clear_timeout_with_handle(id);
        }
    }

    fn run(self: &Rc<Self>, effects: Vec<Effect>) {
        for effect in effects {
            match effect {
                Effect::StartHold => {
                    self.stop_hold();
                    let me = Rc::clone(self);
                    let tick = Closure::once_into_js(move || {
                        me.hold.set(None);
                        let effects = {
                            let mut tool = me.tool.borrow_mut();
                            me.gestures.borrow_mut().hold_elapsed(tool.as_deref_mut())
                        };
                        me.run(effects);
                    });
                    if let Some(w) = web_sys::window() {
                        self.hold.set(w.set_timeout_with_callback_and_timeout_and_arguments_0(tick.unchecked_ref(), HOLD_MS).ok());
                    }
                }
                Effect::StopHold => self.stop_hold(),
                Effect::PanOff => self.map.set_pan(false),
                Effect::PanOn => self.map.set_pan(true),
                Effect::Armed(_) => (self.on_armed)(),
            }
        }
    }
}

impl PointerDriver {
    /// `on_armed`: the tool took the finger (the app buzzes).
    pub fn attach(map: &FieldMap, on_armed: impl Fn() + 'static) -> PointerDriver {
        let container = map.container();
        let inner =
            Rc::new(Inner { map: map.clone(), gestures: RefCell::default(), tool: RefCell::new(None), hold: Cell::new(None), on_armed: Box::new(on_armed) });
        let mut listeners = Vec::new();
        let mut on = |name: &'static str, f: Box<dyn FnMut(web_sys::PointerEvent)>| {
            let closure = Closure::<dyn FnMut(web_sys::PointerEvent)>::new(f);
            let _ = container.add_event_listener_with_callback(name, closure.as_ref().unchecked_ref());
            listeners.push((name, closure));
        };
        let (i, c) = (Rc::clone(&inner), container.clone());
        on(
            "pointerdown",
            Box::new(move |e| {
                let p = position(&c, &e);
                let effects = {
                    let mut tool = i.tool.borrow_mut();
                    i.gestures.borrow_mut().down(tool.as_deref_mut(), e.pointer_id(), e.is_primary(), p)
                };
                i.run(effects);
            }),
        );
        let (i, c) = (Rc::clone(&inner), container.clone());
        on(
            "pointermove",
            Box::new(move |e| {
                let p = position(&c, &e);
                let effects = {
                    let mut tool = i.tool.borrow_mut();
                    i.gestures.borrow_mut().moved(tool.as_deref_mut(), e.pointer_id(), p)
                };
                i.run(effects);
            }),
        );
        let (i, c) = (Rc::clone(&inner), container.clone());
        on(
            "pointerup",
            Box::new(move |e| {
                let p = position(&c, &e);
                let effects = {
                    let mut tool = i.tool.borrow_mut();
                    i.gestures.borrow_mut().up(tool.as_deref_mut(), e.pointer_id(), p)
                };
                i.run(effects);
            }),
        );
        let i = Rc::clone(&inner);
        on(
            "pointercancel",
            Box::new(move |e| {
                let effects = {
                    let mut tool = i.tool.borrow_mut();
                    i.gestures.borrow_mut().cancelled(tool.as_deref_mut(), e.pointer_id())
                };
                i.run(effects);
            }),
        );
        PointerDriver { inner, listeners, container }
    }

    /// The tool that may take fingers (`None`: the map keeps every finger). Whatever the old tool was doing is cancelled.
    pub fn set_tool(&self, tool: Option<Box<dyn Tool>>) {
        let effects = {
            let mut current = self.inner.tool.borrow_mut();
            let effects = self.inner.gestures.borrow_mut().reset(current.as_deref_mut());
            *current = tool;
            effects
        };
        self.inner.run(effects);
    }

    /// The click the map sends after a stroke a tool handled must not count as a tap.
    pub fn swallows_click(&self) -> bool {
        self.inner.gestures.borrow().swallow_click
    }
}

impl Drop for PointerDriver {
    fn drop(&mut self) {
        for (name, closure) in &self.listeners {
            let _ = self.container.remove_event_listener_with_callback(name, closure.as_ref().unchecked_ref());
        }
        self.inner.stop_hold();
    }
}
