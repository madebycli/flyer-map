//! Does a Gebiet lie inside another one (a sub-area in its main area)? Sharing a border or a corner is fine: the pieces of a split lie inside the whole.
use crate::{
    frame::Frame,
    ring::{contains, crosses_properly, dedupe, edges, open, strictly_inside, to_segment},
    LngLat, Ring,
};

/// A point this close to a border (a centimetre) is on it, as in [`strictly_inside`].
const ON_BORDER_M: f64 = 0.01;

/// Is every part of `inner` inside `outer` or on its border? Rings may be open or closed.
pub fn within(inner: &Ring, outer: &Ring) -> bool {
    let (inner, outer) = (dedupe(open(inner)), dedupe(open(outer)));
    if inner.len() < 3 || outer.len() < 3 {
        return false;
    }
    let frame = Frame::around(outer.iter().chain(inner.iter()));
    let allowed = |p: LngLat| contains(&frame, &outer, p) || edges(&outer).any(|(a, b)| to_segment(&frame, p, a, b).0 <= ON_BORDER_M);
    let midpoint = |(p, q): (LngLat, LngLat)| [(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0];
    let corners_in = inner.iter().all(|p| allowed(*p));
    let sides_in = edges(&inner).all(|side| allowed(midpoint(side)));
    let no_crossing = !edges(&inner).any(|(a, b)| edges(&outer).any(|(c, d)| crosses_properly(&frame, a, b, c, d)));
    // the border of the outer ring must not run through the inside of the inner one (a notch in the outer ring that the inner one covers)
    let no_notch = !outer.iter().any(|p| strictly_inside(&frame, &inner, *p));
    corners_in && sides_in && no_crossing && no_notch
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x: f64, y: f64, size: f64) -> Ring {
        vec![[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]
    }

    #[test]
    fn a_smaller_square_inside_is_within() {
        assert!(within(&square(13.001, 51.001, 0.001), &square(13.0, 51.0, 0.01)));
    }

    #[test]
    fn sharing_a_side_or_a_corner_is_within_and_so_is_the_whole() {
        let outer = square(13.0, 51.0, 0.01);
        assert!(within(&square(13.0, 51.0, 0.005), &outer), "corner and two sides shared");
        assert!(within(&vec![[13.0, 51.0], [13.005, 51.0], [13.005, 51.01], [13.0, 51.01], [13.0, 51.0]], &outer), "a whole side shared");
        assert!(within(&outer, &outer), "the Gebiet itself");
    }

    #[test]
    fn sticking_out_or_lying_beside_is_not_within() {
        let outer = square(13.0, 51.0, 0.01);
        assert!(!within(&square(13.008, 51.008, 0.005), &outer), "one corner out");
        assert!(!within(&square(13.02, 51.02, 0.001), &outer), "beside");
        assert!(!within(&square(12.99, 50.99, 0.03), &outer), "around it");
        assert!(!within(&vec![[13.0, 51.0]], &outer), "no ring");
    }

    #[test]
    fn a_notch_in_the_outer_ring_is_not_covered() {
        // a "C": the notch lies between the arms; an inner square that bridges it has all its corners inside the arms but covers the notch
        let outer: Ring = vec![[0.0, 0.0], [0.01, 0.0], [0.01, 0.003], [0.004, 0.003], [0.004, 0.007], [0.01, 0.007], [0.01, 0.01], [0.0, 0.01], [0.0, 0.0]];
        assert!(within(&square(0.0005, 0.0005, 0.002), &outer), "inside one arm");
        let bridge = vec![[0.001, 0.001], [0.009, 0.001], [0.009, 0.009], [0.001, 0.009], [0.001, 0.001]];
        assert!(!within(&bridge, &outer), "bridges the notch");
    }
}
