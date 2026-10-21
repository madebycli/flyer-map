//! A server in memory with the rules of the real one (flyermap-rights screens the edits, last writer wins per key, sequence numbers for the cursor),
//! and ways to make the network misbehave.
use flyermap_core::{Key, Status};
use flyermap_rights::{screen_ops, RawOp};
use flyermap_wire::{state::StateOp, PushRejected, PushRequest, PushResponse, StatePage};
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
struct Row {
    id: String,
    status: Status,
    area: String,
    by: String,
    seq: u64,
}

pub struct Server {
    rows: BTreeMap<Key, Row>,
    seq: u64,
    pub now: u64,
    pub page: usize,
    /// Areas nobody may write in (to provoke refusals).
    pub forbidden: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fate {
    Deliver,
    /// The request never arrives.
    Lost,
    /// The server applies it, but the answer never arrives (the classic cause of duplicates).
    LoseAnswer,
}

impl Server {
    pub fn new(now: u64) -> Server {
        Server {
            rows: BTreeMap::new(),
            seq: 0,
            now,
            page: 1000,
            forbidden: Vec::new(),
        }
    }

    pub fn push(&mut self, request: &PushRequest, by: &str) -> PushResponse {
        let raw: Vec<RawOp> = request
            .ops
            .iter()
            .map(|o| RawOp::Fields {
                id: Some(o.id.to_string()),
                key: Some(o.key.to_string()),
                status: Some(o.status.as_str().into()),
                area: Some(o.area.clone()),
            })
            .collect();
        let forbidden = self.forbidden.clone();
        let screened = screen_ops(&raw, self.now, |area| !forbidden.iter().any(|f| f == area));
        for write in screened.writes_in_order() {
            let newer = self
                .rows
                .get(&write.key)
                .is_none_or(|row| row.id < write.id);
            if newer {
                self.seq += 1;
                self.rows.insert(
                    write.key.clone(),
                    Row {
                        id: write.id.clone(),
                        status: write.status,
                        area: write.area.clone(),
                        by: by.to_string(),
                        seq: self.seq,
                    },
                );
            }
        }
        PushResponse {
            accepted: screened.accepted,
            rejected: screened
                .rejected
                .iter()
                .map(|r| PushRejected {
                    id: r.id.clone(),
                    reason: r.reason.as_str().into(),
                })
                .collect(),
        }
    }

    pub fn pull(&self, since: u64) -> StatePage {
        let mut rows: Vec<(&Key, &Row)> = self.rows.iter().filter(|(_, r)| r.seq > since).collect();
        rows.sort_by_key(|(_, r)| r.seq);
        let more = rows.len() > self.page;
        rows.truncate(self.page);
        let cursor = rows.last().map_or(since, |(_, r)| r.seq);
        StatePage {
            ops: rows
                .iter()
                .map(|(k, r)| StateOp {
                    id: flyermap_core::OpId::new(r.id.as_str()),
                    key: (*k).clone(),
                    status: r.status,
                    by: r.by.clone(),
                    area: r.area.clone(),
                })
                .collect(),
            cursor,
            more,
            server_now: self.now,
        }
    }

    /// What the server believes: key to status.
    pub fn truth(&self) -> BTreeMap<String, Status> {
        self.rows
            .iter()
            .map(|(k, r)| (k.to_string(), r.status))
            .collect()
    }
}
