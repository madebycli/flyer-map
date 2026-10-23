//! The shape of what a device says: ids, names, stamps, rings. Pure; nothing here looks at the state of the Aktion or at rights.
use crate::config::Limits;
use flyermap_protocol::{limits, OpId, Reason, Ring, RingFault};

/// 1 to 64 characters of `A-Za-z0-9._:~@-`.
pub(crate) fn is_id(text: &str) -> bool {
    (1..=limits::MAX_ID).contains(&text.chars().count()) && text.chars().all(|c| c.is_ascii_alphanumeric() || "._:~@-".contains(c))
}

pub(crate) fn id(text: &str) -> Result<(), Reason> {
    if is_id(text) {
        Ok(())
    } else {
        Err(Reason::BadId)
    }
}

/// A name for a Gruppe or Gebiet: trimmed, 1 to 80 characters, no control characters.
pub(crate) fn name(text: &str) -> Result<String, Reason> {
    let trimmed = text.trim();
    let n = trimmed.chars().count();
    if n == 0 || n > limits::MAX_NAME || trimmed.chars().any(char::is_control) {
        return Err(Reason::BadName);
    }
    Ok(trimmed.to_string())
}

/// A stamp of a device: one of ours (a timestamp, at most 64 characters), neither far ahead of the server's clock nor older than the Aktion remembers.
/// Returns its wall-clock part.
pub(crate) fn stamp(op: &OpId, now: u64, limits: &Limits) -> Result<u64, Reason> {
    if op.as_str().len() > flyermap_protocol::limits::MAX_ID {
        return Err(Reason::BadClock);
    }
    let clock = op.decode().ok_or(Reason::BadClock)?;
    if clock.wall > now.saturating_add(limits.future_skew_ms) || clock.wall.saturating_add(limits.past_skew_ms) < now {
        return Err(Reason::ClockSkew);
    }
    Ok(clock.wall)
}

fn coordinate(p: &[f64; 2]) -> bool {
    p[0].is_finite() && p[1].is_finite() && (-180.0..=180.0).contains(&p[0]) && (-90.0..=90.0).contains(&p[1])
}

/// A ring the geometry can judge: not too long, real coordinates on the earth, closed (the first point is repeated if the device left it out).
pub(crate) fn ring(ring: &Ring) -> Result<Ring, Reason> {
    if ring.len() > limits::MAX_RING_POINTS {
        return Err(Reason::BadRing { fault: RingFault::TooManyPoints });
    }
    if !ring.iter().all(coordinate) {
        return Err(Reason::BadRing { fault: RingFault::BadCoordinate });
    }
    let closed = flyermap_area::close(ring);
    if closed.len() < 4 {
        return Err(Reason::BadRing { fault: RingFault::TooFewPoints });
    }
    Ok(closed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flyermap_core::clock::{encode_clock, ClockState};

    fn op(wall: u64) -> OpId {
        encode_clock(&ClockState { wall, counter: 0, node: "d".into() })
    }

    #[test]
    fn ids_names_and_rings() {
        assert!(is_id("g-1.a:b~c@d_e") && !is_id("") && !is_id("a b") && !is_id(&"x".repeat(65)) && !is_id("ä"));
        assert_eq!(name("  Nord  ").as_deref(), Ok("Nord"));
        assert_eq!(name("   "), Err(Reason::BadName));
        assert_eq!(name("a\u{7}b"), Err(Reason::BadName));
        assert_eq!(name(&"x".repeat(81)), Err(Reason::BadName));
        let open: Ring = vec![[1.0, 1.0], [1.1, 1.0], [1.1, 1.1]];
        assert_eq!(ring(&open).map(|r| r.len()), Ok(4), "closed for the device");
        assert_eq!(ring(&vec![[1.0, 1.0], [1.0, 1.0]]), Err(Reason::BadRing { fault: RingFault::TooFewPoints }));
        assert_eq!(ring(&vec![[f64::NAN, 1.0]; 4]), Err(Reason::BadRing { fault: RingFault::BadCoordinate }));
        assert_eq!(ring(&vec![[181.0, 1.0]; 4]), Err(Reason::BadRing { fault: RingFault::BadCoordinate }));
        assert_eq!(ring(&vec![[1.0, 1.0]; 1001]), Err(Reason::BadRing { fault: RingFault::TooManyPoints }));
    }

    #[test]
    fn stamps_must_be_ours_and_near_the_servers_time() {
        let limits = Limits::default();
        let now = 1_800_000_000_000;
        assert_eq!(stamp(&op(now), now, &limits), Ok(now));
        assert_eq!(stamp(&op(now + limits.future_skew_ms), now, &limits), Ok(now + limits.future_skew_ms));
        assert_eq!(stamp(&op(now + limits.future_skew_ms + 1), now, &limits), Err(Reason::ClockSkew));
        assert_eq!(stamp(&op(now - limits.past_skew_ms - 1), now, &limits), Err(Reason::ClockSkew));
        assert_eq!(stamp(&OpId::new("junk"), now, &limits), Err(Reason::BadClock));
        assert_eq!(stamp(&OpId::new(format!("{}-{}", op(now), "x".repeat(80))), now, &limits), Err(Reason::BadClock));
    }
}
