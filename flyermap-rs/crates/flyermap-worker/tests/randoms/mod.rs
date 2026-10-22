//! Ids and secrets are random on both sides, so the replay learns which Rust value stands for which recorded one (the first time it sees them in
//! the same place) and from then on rewrites requests and demands the same mapping everywhere.
use serde_json::Value;

#[derive(Default)]
pub struct Randoms {
    pairs: Vec<(String, String)>,
}

/// `room_…`, `grant_…`, `session_…` followed by a UUID, a server tombstone id (`<clock>-srv` and six hex digits), or anything under a key that
/// carries a secret.
fn is_random(key: Option<&str>, value: &str) -> bool {
    if key == Some("joinSecret") {
        return true;
    }
    if let Some(node) = value.get(17..).and_then(|n| n.strip_prefix("srv")) {
        if value.len() == 26 && node.bytes().all(|b| b.is_ascii_hexdigit()) && flyermap_core::clock::decode_clock(value).is_some() {
            return true;
        }
    }
    let Some((prefix, uuid)) = value.split_once('_') else { return false };
    matches!(prefix, "room" | "grant" | "session")
        && uuid.len() == 36
        && uuid.char_indices().all(|(i, c)| if [8, 13, 18, 23].contains(&i) { c == '-' } else { c.is_ascii_hexdigit() })
}

impl Randoms {
    /// The recorded text with every learned value replaced by its Rust twin.
    pub fn rewrite(&self, text: &str) -> String {
        self.pairs.iter().fold(text.to_string(), |t, (recorded, ours)| t.replace(recorded, ours))
    }

    /// Learns the pair, or checks it against the one learned before.
    fn pair(&mut self, recorded: &str, ours: &str) -> bool {
        match self.pairs.iter().find(|(r, _)| r == recorded) {
            Some((_, known)) => known == ours,
            None if self.pairs.iter().any(|(_, o)| o == ours) => false,
            None => {
                self.pairs.push((recorded.to_string(), ours.to_string()));
                true
            }
        }
    }

    pub fn same(&mut self, recorded: &Value, ours: &Value) -> bool {
        self.walk(None, recorded, ours)
    }

    fn walk(&mut self, key: Option<&str>, recorded: &Value, ours: &Value) -> bool {
        match (recorded, ours) {
            // the size of a gzip stream depends on the compressor, not on the content (the content is compared where the pack is read)
            (Value::Number(_), Value::Number(_)) if key == Some("bytes") => true,
            // a tombstone id: the clock part is deterministic, only the node is random
            (Value::String(r), Value::String(o)) if is_random(key, r) => (r.len() != 26 || r.get(..20) == o.get(..20)) && self.pair(r, o),
            (Value::Object(r), Value::Object(o)) => r.len() == o.len() && r.iter().all(|(k, rv)| o.get(k).is_some_and(|ov| self.walk(Some(k), rv, ov))),
            (Value::Array(r), Value::Array(o)) => r.len() == o.len() && r.iter().zip(o).all(|(rv, ov)| self.walk(key, rv, ov)),
            _ => recorded == ours,
        }
    }

    /// `vf_session=<secret>; …`: the secrets pair up, the rest must be identical.
    pub fn same_cookie(&mut self, recorded: Option<&str>, ours: Option<&str>) -> bool {
        let split = |c: &str| {
            c.split_once(';').and_then(|(head, rest)| head.split_once('=').map(|(name, value)| (name.to_string(), value.to_string(), rest.to_string())))
        };
        match (recorded.map(split), ours.map(split)) {
            (None, None) => true,
            (Some(Some((rn, rv, rr))), Some(Some((on, ov, or)))) => rn == on && rr == or && self.pair(&rv, &ov),
            _ => false,
        }
    }
}
