//! What a gesture on the sheet's handle means (pure, so it is tested natively): a tap toggles, a drag down past a threshold shrinks the sheet to
//! its header, a drag up brings it back; anything in between leaves it as it was. Same numbers as `SheetFrame` in `src/v5/app/sheet.tsx`.

/// Movement below this many px is a tap.
pub const TAP_PX: f64 = 8.0;
/// Movement beyond this many px is a deliberate drag.
pub const DRAG_PX: f64 = 40.0;

/// Whether the sheet is shrunk after a gesture of `dy` px (positive is down) that started with `small`.
pub fn after_gesture(small: bool, dy: f64) -> bool {
    if dy.abs() < TAP_PX {
        !small
    } else if dy > DRAG_PX {
        true
    } else if dy < -DRAG_PX {
        false
    } else {
        small
    }
}

/// How far the full sheet follows the finger while dragging: only downwards, and not at all while it is shrunk.
pub fn follow_offset(small: bool, dy: f64) -> Option<f64> {
    (!small).then_some(dy.max(0.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tap_toggles() {
        assert!(after_gesture(false, 3.0));
        assert!(!after_gesture(true, -5.0));
    }

    #[test]
    fn a_drag_down_shrinks_and_up_grows() {
        assert!(after_gesture(false, 120.0));
        assert!(after_gesture(true, 120.0));
        assert!(!after_gesture(true, -60.0));
    }

    #[test]
    fn a_hesitant_drag_changes_nothing() {
        assert!(!after_gesture(false, 20.0));
        assert!(after_gesture(true, -20.0));
    }

    #[test]
    fn only_the_full_sheet_follows_and_only_down() {
        assert_eq!(follow_offset(false, 50.0), Some(50.0));
        assert_eq!(follow_offset(false, -50.0), Some(0.0));
        assert_eq!(follow_offset(true, 50.0), None);
    }
}
