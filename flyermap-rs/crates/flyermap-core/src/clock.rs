//! Hybrid logical clock. Timestamps are fixed-width strings, so plain string comparison is a total order that survives device clock skew
//! (it never goes backwards) and ties are broken deterministically by the node id.
use serde::{Deserialize, Serialize};
use std::fmt;

/// The encoded timestamp of one operation. It is the operation's id and, at once, its position in the global order.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct OpId(String);

impl OpId {
    pub fn new(text: impl Into<String>) -> OpId {
        OpId(text.into())
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
    /// The clock inside, or `None` when the text is not a timestamp of ours.
    pub fn decode(&self) -> Option<ClockState> {
        decode_clock(&self.0)
    }
}

impl fmt::Display for OpId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClockState {
    /// Milliseconds since the epoch, never less than any wall time seen so far.
    pub wall: u64,
    pub counter: u32,
    pub node: String,
}

const WALL_DIGITS: usize = 11;
const COUNTER_DIGITS: usize = 4;

fn base36(mut value: u64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while value > 0 {
        out.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

fn padded(value: u64, width: usize) -> String {
    format!("{:0>width$}", base36(value))
}

pub fn encode_clock(clock: &ClockState) -> OpId {
    OpId(format!(
        "{}-{}-{}",
        padded(clock.wall, WALL_DIGITS),
        padded(u64::from(clock.counter), COUNTER_DIGITS),
        clock.node
    ))
}

fn parse_base36(text: &str) -> Option<u64> {
    text.bytes().try_fold(0u64, |acc, b| {
        let digit = match b {
            b'0'..=b'9' => b - b'0',
            b'a'..=b'z' => b - b'a' + 10,
            _ => return None,
        };
        acc.checked_mul(36)?.checked_add(u64::from(digit))
    })
}

/// `<11 base-36 digits>-<4 base-36 digits>-<node>`; the node is anything non-empty.
pub fn decode_clock(text: &str) -> Option<ClockState> {
    let wall = text.get(..WALL_DIGITS)?;
    let rest = text.get(WALL_DIGITS..)?.strip_prefix('-')?;
    let counter = rest.get(..COUNTER_DIGITS)?;
    let node = rest.get(COUNTER_DIGITS..)?.strip_prefix('-')?;
    if node.is_empty() {
        return None;
    }
    Some(ClockState {
        wall: parse_base36(wall)?,
        counter: u32::try_from(parse_base36(counter)?).ok()?,
        node: node.to_string(),
    })
}

/// The next local timestamp: never earlier than the last one, counting up while the wall time stands still.
pub fn tick(state: &ClockState, now: u64) -> ClockState {
    let wall = state.wall.max(now);
    ClockState {
        node: state.node.clone(),
        wall,
        counter: if wall == state.wall {
            state.counter + 1
        } else {
            0
        },
    }
}

/// Merge a remote timestamp so that every later local tick sorts after it. Text that is not a timestamp leaves the clock as it is.
pub fn receive(state: &ClockState, remote: &str, now: u64) -> ClockState {
    let Some(r) = decode_clock(remote) else {
        return state.clone();
    };
    let wall = state.wall.max(r.wall).max(now);
    let counter = if wall == state.wall && wall == r.wall {
        state.counter.max(r.counter) + 1
    } else if wall == state.wall {
        state.counter + 1
    } else if wall == r.wall {
        r.counter + 1
    } else {
        0
    };
    ClockState {
        node: state.node.clone(),
        wall,
        counter,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clock(wall: u64, counter: u32) -> ClockState {
        ClockState {
            wall,
            counter,
            node: "n".into(),
        }
    }

    #[test]
    fn encoding_is_fixed_width_and_sorts_like_time() {
        let a = encode_clock(&clock(1_700_000_000_000, 0));
        let b = encode_clock(&clock(1_700_000_000_000, 1));
        let c = encode_clock(&clock(1_700_000_000_001, 0));
        assert_eq!(a.as_str().len(), "00000000000-0000-n".len());
        assert!(a < b && b < c);
        assert_eq!(decode_clock(a.as_str()), Some(clock(1_700_000_000_000, 0)));
    }

    #[test]
    fn decoding_refuses_what_is_not_a_timestamp() {
        for text in [
            "",
            "x",
            "0000000000-0000-n",
            "00000000000-0000-",
            "00000000000_0000-n",
            "0000000000A-0000-n",
            "00000000000-000g!-n",
        ] {
            assert_eq!(decode_clock(text), None, "{text}");
        }
        assert!(decode_clock("00000000000-0000-node-with-dashes").is_some());
    }

    #[test]
    fn a_tick_never_goes_back() {
        let t = tick(&clock(100, 5), 50);
        assert_eq!((t.wall, t.counter), (100, 6));
        let t = tick(&t, 200);
        assert_eq!((t.wall, t.counter), (200, 0));
    }

    #[test]
    fn receiving_orders_later_ticks_after_the_remote() {
        let remote = encode_clock(&clock(500, 7));
        let r = receive(&clock(100, 0), remote.as_str(), 50);
        assert_eq!((r.wall, r.counter), (500, 8));
        let r = receive(&clock(500, 9), remote.as_str(), 50);
        assert_eq!((r.wall, r.counter), (500, 10));
        let r = receive(&clock(500, 2), encode_clock(&clock(100, 0)).as_str(), 50);
        assert_eq!((r.wall, r.counter), (500, 3));
        let r = receive(&clock(500, 2), remote.as_str(), 900);
        assert_eq!((r.wall, r.counter), (900, 0));
        assert_eq!(receive(&clock(1, 1), "junk", 0), clock(1, 1));
    }
}
