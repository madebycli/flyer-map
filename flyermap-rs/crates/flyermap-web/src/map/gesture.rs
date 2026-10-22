//! Who owns a finger (port of `wireGestures` in `src/v5/map/fieldMap.ts`). Drawing tools (Wischen, Lasso) take a finger only after it has
//! rested a moment; a finger that moves first pans the map, two fingers zoom it, and a second finger cancels a drawing so the map is never
//! trapped. The rules are pure; `pointer.rs` feeds them browser events and carries out the effects.
use super::hit::P2;

/// A finger that rests this long, within `HOLD_SLOP` px, starts a drawing tool.
pub const HOLD_MS: i32 = 170;
pub const HOLD_SLOP: f64 = 6.0;

/// The active drawing tool. `down` decides whether it takes the finger.
pub trait Tool {
    /// Takes a finger only after it rested (`HOLD_MS`); taps are still handed over as down + up.
    fn hold(&self) -> bool;
    fn down(&mut self, p: P2) -> bool;
    fn drag(&mut self, p: P2);
    fn up(&mut self, p: P2, moved: bool);
    fn cancel(&mut self);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Idle,
    /// A drawing tool waits to see what the finger does.
    Pending,
    /// The tool owns the finger.
    Active,
    /// The map's own pan or pinch.
    Other,
}

/// What the driver must do.
#[derive(Clone, Debug, PartialEq)]
pub enum Effect {
    StartHold,
    StopHold,
    PanOff,
    PanOn,
    /// Show the ring that says "the tool has the finger now" (and buzz).
    Armed(P2),
}

pub struct Gestures {
    pub phase: Phase,
    start: Option<P2>,
    moved: bool,
    active: bool,
    pointers: Vec<i32>,
    current: i32,
    /// The click that follows a gesture the tool handled must not be handled again.
    pub swallow_click: bool,
}

impl Default for Gestures {
    fn default() -> Gestures {
        Gestures { phase: Phase::Idle, start: None, moved: false, active: false, pointers: Vec::new(), current: -1, swallow_click: false }
    }
}

fn dist(a: P2, b: P2) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

impl Gestures {
    fn claim<T: Tool + ?Sized>(&mut self, tool: &mut T, p: P2, out: &mut Vec<Effect>) -> bool {
        if !tool.down(p) {
            return false;
        }
        self.active = true;
        self.swallow_click = true;
        self.moved = false;
        out.push(Effect::PanOff);
        true
    }

    fn cancel_gesture<T: Tool + ?Sized>(&mut self, tool: Option<&mut T>, out: &mut Vec<Effect>) {
        if !self.active {
            return;
        }
        self.active = false;
        if let Some(t) = tool {
            t.cancel();
        }
        out.push(Effect::PanOn);
    }

    pub fn reset<T: Tool + ?Sized>(&mut self, tool: Option<&mut T>) -> Vec<Effect> {
        let mut out = vec![Effect::StopHold];
        self.pointers.clear();
        self.cancel_gesture(tool, &mut out);
        out.push(Effect::PanOn);
        self.phase = Phase::Idle;
        self.start = None;
        out
    }

    pub fn down<T: Tool + ?Sized>(&mut self, mut tool: Option<&mut T>, id: i32, primary: bool, p: P2) -> Vec<Effect> {
        let mut out = Vec::new();
        self.swallow_click = false;
        // a primary pointer begins a new touch sequence: ids of fingers whose "up" never arrived must not count as a second finger
        if primary {
            out = self.reset(tool.as_deref_mut());
        }
        if !self.pointers.contains(&id) {
            self.pointers.push(id);
        }
        if self.pointers.len() > 1 {
            out.push(Effect::StopHold);
            self.cancel_gesture(tool, &mut out);
            self.phase = Phase::Other;
            return out;
        }
        let Some(tool) = tool else {
            self.phase = Phase::Other;
            return out;
        };
        self.start = Some(p);
        self.current = id;
        if !tool.hold() {
            self.phase = if self.claim(tool, p, &mut out) { Phase::Active } else { Phase::Other };
            return out;
        }
        self.phase = Phase::Pending;
        out.push(Effect::StartHold);
        out
    }

    pub fn hold_elapsed<T: Tool + ?Sized>(&mut self, tool: Option<&mut T>) -> Vec<Effect> {
        let mut out = Vec::new();
        let (Some(tool), Some(start)) = (tool, self.start) else { return out };
        if self.phase != Phase::Pending || self.pointers.len() != 1 {
            return out;
        }
        if self.claim(tool, start, &mut out) {
            self.phase = Phase::Active;
            out.push(Effect::Armed(start));
        } else {
            self.phase = Phase::Other;
        }
        out
    }

    pub fn moved<T: Tool + ?Sized>(&mut self, tool: Option<&mut T>, id: i32, p: P2) -> Vec<Effect> {
        if id != self.current {
            return Vec::new();
        }
        if self.phase == Phase::Pending {
            // moved before the hold ran out: the finger wants the map, whose pan was never switched off
            if self.start.is_some_and(|s| dist(s, p) > HOLD_SLOP) {
                self.phase = Phase::Other;
                return vec![Effect::StopHold];
            }
            return Vec::new();
        }
        if self.phase != Phase::Active || self.pointers.len() > 1 {
            return Vec::new();
        }
        if self.start.is_some_and(|s| dist(s, p) > 4.0) {
            self.moved = true;
        }
        if let Some(t) = tool {
            t.drag(p);
        }
        Vec::new()
    }

    pub fn up<T: Tool + ?Sized>(&mut self, tool: Option<&mut T>, id: i32, p: P2) -> Vec<Effect> {
        let mut out = Vec::new();
        self.pointers.retain(|x| *x != id);
        if id == self.current {
            if let Some(tool) = tool {
                if self.phase == Phase::Pending {
                    // lifted before the hold ran out, without moving: a tap, handled like a one-point gesture
                    out.push(Effect::StopHold);
                    if self.claim(tool, p, &mut out) {
                        out.push(Effect::PanOn);
                        self.active = false;
                        tool.up(p, false);
                    }
                } else if self.phase == Phase::Active && self.active {
                    self.active = false;
                    out.push(Effect::PanOn);
                    tool.up(p, self.moved);
                }
            }
        }
        if self.pointers.is_empty() {
            self.phase = Phase::Idle;
            self.start = None;
        }
        out
    }

    pub fn cancelled<T: Tool + ?Sized>(&mut self, tool: Option<&mut T>, id: i32) -> Vec<Effect> {
        let mut out = vec![Effect::StopHold];
        self.pointers.retain(|x| *x != id);
        self.cancel_gesture(tool, &mut out);
        if self.pointers.is_empty() {
            self.phase = Phase::Idle;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Pen {
        log: Vec<String>,
    }
    impl Tool for Pen {
        fn hold(&self) -> bool {
            true
        }
        fn down(&mut self, _p: P2) -> bool {
            self.log.push("down".into());
            true
        }
        fn drag(&mut self, _p: P2) {
            self.log.push("drag".into());
        }
        fn up(&mut self, _p: P2, moved: bool) {
            self.log.push(format!("up {moved}"));
        }
        fn cancel(&mut self) {
            self.log.push("cancel".into());
        }
    }

    #[test]
    fn a_resting_finger_draws() {
        let (mut g, mut pen) = (Gestures::default(), Pen::default());
        assert!(g.down(Some(&mut pen), 1, true, [10.0, 10.0]).contains(&Effect::StartHold));
        let fx = g.hold_elapsed(Some(&mut pen));
        assert!(fx.contains(&Effect::PanOff) && fx.contains(&Effect::Armed([10.0, 10.0])));
        g.moved(Some(&mut pen), 1, [40.0, 10.0]);
        assert!(g.up(Some(&mut pen), 1, [40.0, 10.0]).contains(&Effect::PanOn));
        assert_eq!(pen.log, ["down", "drag", "up true"]);
        assert!(g.swallow_click && g.phase == Phase::Idle);
    }

    #[test]
    fn a_finger_that_moves_first_pans_the_map() {
        let (mut g, mut pen) = (Gestures::default(), Pen::default());
        g.down(Some(&mut pen), 1, true, [10.0, 10.0]);
        assert_eq!(g.moved(Some(&mut pen), 1, [30.0, 10.0]), [Effect::StopHold]);
        assert!(g.hold_elapsed(Some(&mut pen)).is_empty());
        g.up(Some(&mut pen), 1, [30.0, 10.0]);
        assert!(pen.log.is_empty(), "the tool never saw it");
    }

    #[test]
    fn a_quick_tap_is_a_one_point_gesture_and_a_second_finger_cancels() {
        let (mut g, mut pen) = (Gestures::default(), Pen::default());
        g.down(Some(&mut pen), 1, true, [5.0, 5.0]);
        g.up(Some(&mut pen), 1, [5.0, 5.0]);
        assert_eq!(pen.log, ["down", "up false"]);
        pen.log.clear();
        g.down(Some(&mut pen), 2, true, [5.0, 5.0]);
        g.hold_elapsed(Some(&mut pen));
        let fx = g.down(Some(&mut pen), 3, false, [50.0, 5.0]);
        assert!(fx.contains(&Effect::PanOn));
        assert_eq!(pen.log, ["down", "cancel"]);
        assert_eq!(g.phase, Phase::Other);
    }

    #[test]
    fn without_a_tool_the_map_keeps_the_finger() {
        let mut g = Gestures::default();
        g.down::<Pen>(None, 1, true, [0.0, 0.0]);
        assert_eq!(g.phase, Phase::Other);
    }
}
