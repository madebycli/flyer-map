//! The zones of the screen. Everything that floats over the map lives in exactly one of them, and the zones are the same on every screen, so
//! nothing ever lands on top of something else by accident. A zone only positions; what stands in it is the feature's business.
//!
//! ```text
//!   ┌───────────────────────────── stage ──────────────────────────────┐
//!   │  Top      command bar, live strip                                │
//!   │  Notice   one short note under the bar                           │
//!   │                                                                  │
//!   │  Sheet    one sheet at a time (from below; at the left on wide)  │
//!   │  Panel    the tool's panel (marking, drawing), above the Bottom  │
//!   │  Bottom   quick bar (one side) and mode button (the hand's side) │
//!   └──────────────────────────────────────────────────────────────────┘
//! ```
//! The Studio column sits next to the stage (not over it) from 900 px; the map fills the stage beneath all zones.
use leptos::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ZoneId {
    Top,
    Notice,
    Panel,
    Bottom,
    Sheet,
    Overlay,
}

impl ZoneId {
    pub const ALL: [ZoneId; 6] = [ZoneId::Top, ZoneId::Notice, ZoneId::Panel, ZoneId::Bottom, ZoneId::Sheet, ZoneId::Overlay];

    /// The `data-zone` of the element (the browser flows look zones up by it).
    pub fn name(self) -> &'static str {
        match self {
            ZoneId::Top => "top",
            ZoneId::Notice => "notice",
            ZoneId::Panel => "panel",
            ZoneId::Bottom => "bottom",
            ZoneId::Sheet => "sheet",
            ZoneId::Overlay => "overlay",
        }
    }
}

/// A positioned box that lets the map's gestures through everywhere except on what it holds.
#[component]
pub fn Zone(zone: ZoneId, #[prop(optional)] children: Option<Children>) -> impl IntoView {
    view! { <div class="fm-zone" data-zone=zone.name()>{children.map(|c| c())}</div> }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn every_zone_has_its_own_name() {
        let names: HashSet<_> = ZoneId::ALL.iter().map(|z| z.name()).collect();
        assert_eq!(names.len(), ZoneId::ALL.len());
    }
}
