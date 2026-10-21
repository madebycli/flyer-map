//! What makes a batch of edits acceptable. Two pure steps around the one database lookup the Worker has to make:
//! [`screen_ops`] judges every edit on its own (shape, clock, status, Gebiet), [`Screened::enforce_key_owners`] then protects other Gruppen's progress.
use flyermap_core::{clock::decode_clock, Key, Status};
use std::collections::{BTreeMap, HashMap};

/// At most this many edits in one request.
pub const MAX_OPS: usize = 200;
/// An edit stamped further than this ahead of the server clock is refused (a device with a broken clock must not win every race for a day).
pub const FUTURE_SKEW_MS: u64 = 24 * 60 * 60 * 1000;
const MAX_AREA_ID: usize = 160;

/// One element of the request's `ops` array as it arrived. Fields that are missing or not text are `None`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RawOp {
    NotAnObject,
    Fields {
        id: Option<String>,
        key: Option<String>,
        status: Option<String>,
        area: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Reason {
    BadId,
    ClockFuture,
    BadKey,
    BadStatus,
    BadArea,
    AreaForbidden,
    KeyOwnedElsewhere,
}

impl Reason {
    /// The wire code: stable, the client rolls back on it and the diagnostics group by it.
    pub fn as_str(self) -> &'static str {
        match self {
            Reason::BadId => "bad_id",
            Reason::ClockFuture => "clock_future",
            Reason::BadKey => "bad_key",
            Reason::BadStatus => "bad_status",
            Reason::BadArea => "bad_area",
            Reason::AreaForbidden => "area_forbidden",
            Reason::KeyOwnedElsewhere => "key_owned_elsewhere",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rejection {
    pub id: String,
    pub reason: Reason,
}

/// An edit that is to be written: the newest per key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Write {
    pub id: String,
    pub key: Key,
    pub status: Status,
    pub area: String,
}

#[derive(Debug, Default)]
pub struct Screened {
    /// Ids the server confirms (also older edits of a key that a newer one in the same batch replaced: they are accepted but not written).
    pub accepted: Vec<String>,
    pub rejected: Vec<Rejection>,
    pub latest: BTreeMap<Key, Write>,
}

fn area_id_valid(id: &str) -> bool {
    (1..=MAX_AREA_ID).contains(&id.chars().count())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c))
}

/// Judge each edit on its own. `area_writable` is asked once per Gebiet (the answer is remembered).
pub fn screen_ops(
    ops: &[RawOp],
    now: u64,
    mut area_writable: impl FnMut(&str) -> bool,
) -> Screened {
    let mut out = Screened::default();
    let mut area_ok: HashMap<String, bool> = HashMap::new();
    for op in ops {
        let RawOp::Fields {
            id,
            key,
            status,
            area,
        } = op
        else {
            out.rejected.push(Rejection {
                id: String::new(),
                reason: Reason::BadId,
            });
            continue;
        };
        let id = id.clone().unwrap_or_default();
        let mut reject = |reason| {
            out.rejected.push(Rejection {
                id: id.clone(),
                reason,
            })
        };
        let Some(clock) = decode_clock(&id) else {
            reject(Reason::BadId);
            continue;
        };
        if clock.wall > now.saturating_add(FUTURE_SKEW_MS) {
            reject(Reason::ClockFuture);
            continue;
        }
        let Some(key) = key.as_deref().map(Key::new).filter(Key::is_wire_valid) else {
            reject(Reason::BadKey);
            continue;
        };
        let Some(status) = status.as_deref().and_then(Status::parse) else {
            reject(Reason::BadStatus);
            continue;
        };
        let Some(area) = area.as_deref().filter(|a| area_id_valid(a)) else {
            reject(Reason::BadArea);
            continue;
        };
        let writable = *area_ok
            .entry(area.to_string())
            .or_insert_with(|| area_writable(area));
        if !writable {
            reject(Reason::AreaForbidden);
            continue;
        }
        out.accepted.push(id.clone());
        let newer = out.latest.get(&key).is_none_or(|prior| prior.id < id);
        if newer {
            out.latest.insert(
                key.clone(),
                Write {
                    id,
                    key,
                    status,
                    area: area.to_string(),
                },
            );
        }
    }
    out
}

impl Screened {
    /// A scoped editor may only write keys that are new or already belong to the Gebiet they claim; otherwise claiming one of their own Gebiete would let
    /// them overwrite another Gruppe's progress. `owners` maps keys that exist on the server to the Gebiet they are in.
    pub fn enforce_key_owners(&mut self, owners: &HashMap<Key, String>) {
        let foreign: Vec<Key> = self
            .latest
            .iter()
            .filter(|(key, w)| owners.get(*key).is_some_and(|owner| owner != &w.area))
            .map(|(key, _)| key.clone())
            .collect();
        for key in foreign {
            let Some(write) = self.latest.remove(&key) else {
                continue;
            };
            if let Some(i) = self.accepted.iter().position(|id| id == &write.id) {
                self.accepted.remove(i);
            }
            self.rejected.push(Rejection {
                id: write.id,
                reason: Reason::KeyOwnedElsewhere,
            });
        }
    }

    /// Oldest first: the order in which they are written (the sequence numbers follow it).
    pub fn writes_in_order(&self) -> Vec<&Write> {
        let mut rows: Vec<&Write> = self.latest.values().collect();
        rows.sort_by(|a, b| a.id.cmp(&b.id));
        rows
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flyermap_core::{encode_clock, ClockState};

    const NOW: u64 = 1_800_000_000_000;
    fn stamp(wall: u64) -> String {
        encode_clock(&ClockState {
            wall,
            counter: 0,
            node: "n".into(),
        })
        .to_string()
    }
    fn op(id: &str, key: &str, status: &str, area: &str) -> RawOp {
        RawOp::Fields {
            id: Some(id.into()),
            key: Some(key.into()),
            status: Some(status.into()),
            area: Some(area.into()),
        }
    }
    fn reasons(s: &Screened) -> Vec<&'static str> {
        s.rejected.iter().map(|r| r.reason.as_str()).collect()
    }

    #[test]
    fn every_single_fault_has_its_own_reason() {
        let good = stamp(NOW - 1000);
        let ops = vec![
            RawOp::NotAnObject,
            op("junk", "h:a", "completed", "area_n"),
            op(
                &stamp(NOW + FUTURE_SKEW_MS + 1),
                "h:a",
                "completed",
                "area_n",
            ),
            op(&good, "x:a", "completed", "area_n"),
            op(&good, "h:a", "done", "area_n"),
            op(&good, "h:a", "completed", "bad area"),
            RawOp::Fields {
                id: Some(good.clone()),
                key: Some("h:a".into()),
                status: Some("completed".into()),
                area: None,
            },
            op(&good, "h:a", "completed", "area_other"),
            op(&good, "h:a", "completed", "area_n"),
        ];
        let s = screen_ops(&ops, NOW, |a| a == "area_n");
        assert_eq!(
            reasons(&s),
            [
                "bad_id",
                "bad_id",
                "clock_future",
                "bad_key",
                "bad_status",
                "bad_area",
                "bad_area",
                "area_forbidden"
            ]
        );
        assert_eq!(s.accepted, [good]);
    }

    #[test]
    fn the_newest_edit_per_key_is_written_and_older_ones_are_accepted_all_the_same() {
        let (a, b) = (stamp(NOW - 3000), stamp(NOW - 2000));
        let s = screen_ops(
            &[
                op(&b, "h:a", "later", "area_n"),
                op(&a, "h:a", "completed", "area_n"),
            ],
            NOW,
            |_| true,
        );
        assert_eq!(s.accepted, [b.clone(), a]);
        assert_eq!(s.latest[&Key::house("a")].status, Status::Later);
        assert_eq!(s.writes_in_order().len(), 1);
    }

    #[test]
    fn the_gebiet_is_asked_once() {
        let mut asked = 0;
        let ops: Vec<RawOp> = (0..5)
            .map(|i| {
                op(
                    &stamp(NOW - 1000 + i),
                    &format!("h:{i}"),
                    "completed",
                    "area_n",
                )
            })
            .collect();
        let s = screen_ops(&ops, NOW, |_| {
            asked += 1;
            true
        });
        assert_eq!((asked, s.accepted.len()), (1, 5));
    }

    #[test]
    fn a_scoped_editor_cannot_take_over_a_key_of_another_gebiet() {
        let (a, b) = (stamp(NOW - 2000), stamp(NOW - 1000));
        let mut s = screen_ops(
            &[
                op(&a, "h:mine", "completed", "area_n"),
                op(&b, "h:theirs", "completed", "area_n"),
            ],
            NOW,
            |_| true,
        );
        let owners = HashMap::from([
            (Key::house("theirs"), "area_o".to_string()),
            (Key::house("mine"), "area_n".to_string()),
        ]);
        s.enforce_key_owners(&owners);
        assert_eq!(s.accepted, [a]);
        assert_eq!(reasons(&s), ["key_owned_elsewhere"]);
        assert_eq!(s.latest.len(), 1);
    }

    #[test]
    fn sixty_four_hundred_checks_are_cheap_enough_to_run_on_every_push() {
        let ops: Vec<RawOp> = (0..MAX_OPS as u64)
            .map(|i| op(&stamp(NOW - 5000 + i), &format!("h:{i}"), "later", "area_n"))
            .collect();
        assert_eq!(screen_ops(&ops, NOW, |_| true).accepted.len(), MAX_OPS);
    }
}
