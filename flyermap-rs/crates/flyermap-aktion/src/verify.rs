//! Proof that the Akteur is what it says it is, usable by tests, tools and the host: the whole state as plain data (`dump`), the invariants every state
//! must satisfy (`check`), the raw log (`entries`), and the rebuilding of a state from a log (`replay`). `dump` of a replay equals `dump` of the
//! original: the tables are a function of the log and of nothing else.
use crate::{
    aktion::Aktion,
    apply::apply,
    queries::{self, areas, groups, log, marks, notes, runs},
    sql::{Sql, SqlError},
};
use flyermap_area::{check as shape, within};
use flyermap_core::clock::{decode_clock, encode_clock, receive};
use flyermap_protocol::{Art, Change, Entry, Gebiet, Gruppe, Lauf, LaufStatus, Mark, Notiz};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

/// Everything the tables hold, tombstones included (`true`: deleted or cleaned away), in a fixed order.
#[derive(Clone, Debug, PartialEq)]
pub struct Dump {
    pub gruppen: Vec<(Gruppe, bool)>,
    pub gebiete: Vec<(Gebiet, bool)>,
    pub marks: Vec<(Mark, bool)>,
    pub notes: Vec<Notiz>,
    pub laeufe: Vec<Lauf>,
}

#[derive(Debug, Error)]
pub enum ReplayError {
    #[error("{0}")]
    Storage(#[from] SqlError),
    /// The entries must go on where the log of this Aktion ends, without a gap.
    #[error("entry {found} does not follow {expected}")]
    Gap { expected: u64, found: u64 },
}

impl<S: Sql> Aktion<S> {
    pub fn dump(&mut self) -> Result<Dump, SqlError> {
        let sql = &mut self.sql;
        Ok(Dump {
            gruppen: groups::all(sql)?.into_iter().map(|r| (r.gruppe, r.deleted)).collect(),
            gebiete: areas::all(sql)?.into_iter().map(|r| (r.gebiet, r.deleted)).collect(),
            marks: marks::all(sql)?.into_iter().map(|r| (r.mark, r.removed)).collect(),
            notes: notes::all(sql)?,
            laeufe: runs::all(sql)?,
        })
    }

    /// How many answers to commands are kept for retries (they are forgotten after `Limits::done_ttl_ms`).
    pub fn answers_kept(&mut self) -> Result<u64, SqlError> {
        queries::done::count(&mut self.sql)
    }

    /// The raw log after `after`, oldest first, at most `limit` entries: for backups and tests; devices read through `catchup`, which cuts it to their rights.
    pub fn entries(&mut self, after: u64, limit: u32) -> Result<Vec<Entry>, SqlError> {
        log::range(&mut self.sql, after, limit)?
            .into_iter()
            .map(|r| Ok(Entry { seq: r.seq, at: r.at, by: r.who, change: queries::unjson::<Change>(&r.change)? }))
            .collect()
    }

    /// Put entries into this Aktion as if its Akteur had made them: each one is applied and logged under its own number. The entries must follow the
    /// head without a gap. The answers kept for retries are not part of the log and are not restored. All or nothing.
    pub fn replay(&mut self, entries: &[Entry], now: u64) -> Result<(), ReplayError> {
        let (mut next, mut clock) = (self.head + 1, self.clock.clone());
        let end = self.sql.atomically::<_, ReplayError>(|sql| {
            for entry in entries {
                if entry.seq != next {
                    return Err(ReplayError::Gap { expected: next, found: entry.seq });
                }
                apply(sql, entry)?;
                log::append(sql, entry.seq, entry.at, &entry.by, &queries::json(&entry.change))?;
                // the stamps the Akteur gave to what it cleaned away: its clock must not fall behind them
                if let Change::MarksRemoved { rev, .. } | Change::NotesRemoved { rev, .. } = &entry.change {
                    clock = receive(&clock, rev.as_str(), now);
                }
                next += 1;
            }
            queries::meta::set(sql, queries::meta::CLOCK, encode_clock(&clock).as_str())?;
            Ok(next - 1)
        })?;
        self.head = end.max(self.head);
        self.clock = clock;
        Ok(())
    }

    /// The invariants of a state, as a list of what is wrong (empty: all well). They hold after every command, accepted or refused, and after a replay.
    pub fn check(&mut self) -> Result<Vec<String>, SqlError> {
        let mut faults = Vec::new();
        let (count, lowest, highest) = log::shape(&mut self.sql)?;
        if self.head > 0 && (highest != self.head || lowest != self.floor + 1 || highest - lowest + 1 != count) {
            faults.push(format!("log: {count} rows from {lowest} to {highest}, head {}, floor {}", self.head, self.floor));
        }
        if self.head == 0 && count != 0 {
            faults.push("log: rows with head 0".to_string());
        }
        if decode_clock(encode_clock(&self.clock).as_str()).is_none() {
            faults.push("clock: not a stamp".to_string());
        }
        let dump = self.dump()?;
        let gruppen: BTreeMap<_, _> = dump.gruppen.iter().map(|(g, deleted)| (&g.id, *deleted)).collect();
        let gebiete: BTreeMap<_, _> = dump.gebiete.iter().map(|(g, deleted)| (&g.id, (g, *deleted))).collect();
        let live: Vec<&Gebiet> = dump.gebiete.iter().filter(|(_, deleted)| !deleted).map(|(g, _)| g).collect();

        for g in &live {
            let id = &g.id;
            match g.art {
                Art::Austeilen => {
                    if g.parent.is_some() || g.collected.is_some() {
                        faults.push(format!("gebiet {id:?}: Austeilen with a main area or a taker"));
                    }
                    if let Some(gruppe) = &g.gruppe {
                        if gruppen.get(gruppe) != Some(&false) {
                            faults.push(format!("gebiet {id:?}: Gruppe {gruppe:?} is not there"));
                        }
                    }
                }
                Art::Abholen => {
                    if g.gruppe.is_some() {
                        faults.push(format!("gebiet {id:?}: Abholen with a Gruppe"));
                    }
                    if let Some(parent) = &g.parent {
                        match gebiete.get(parent) {
                            Some((main, false)) if main.art == Art::Abholen && main.parent.is_none() => {
                                if !within(&g.ring, &main.ring) {
                                    faults.push(format!("gebiet {id:?}: outside its main area"));
                                }
                                if main.collected.is_some() {
                                    faults.push(format!("gebiet {id:?}: its main area is taken over"));
                                }
                            }
                            _ => faults.push(format!("gebiet {id:?}: main area {parent:?} is not there")),
                        }
                    }
                    if g.collected.is_some() && live.iter().any(|c| c.parent.as_ref() == Some(id)) {
                        faults.push(format!("gebiet {id:?}: taken over and has sub-areas"));
                    }
                }
            }
            let sisters: Vec<_> = live.iter().filter(|o| o.id != g.id && o.art == g.art && o.parent == g.parent).map(|o| o.ring.clone()).collect();
            if shape(&g.ring, &sisters).is_err() {
                faults.push(format!("gebiet {id:?}: not a valid outline, or over a sister"));
            }
        }
        for (g, deleted) in &dump.gebiete {
            if *deleted && g.collected.is_some() {
                faults.push(format!("gebiet {:?}: deleted while taken over", g.id));
            }
        }
        for (m, _) in &dump.marks {
            if !gebiete.contains_key(&m.gebiet) {
                faults.push(format!("mark {:?}: no Gebiet {:?}", m.key, m.gebiet));
            }
            if m.op.decode().is_none() {
                faults.push(format!("mark {:?}: stamp is not a stamp", m.key));
            }
        }
        for n in &dump.notes {
            if !gebiete.contains_key(&n.gebiet) {
                faults.push(format!("note {:?}: no Gebiet {:?}", n.id, n.gebiet));
            }
            if n.deleted && (!n.text.is_empty() || n.flag.is_some()) {
                faults.push(format!("note {:?}: deleted but has content", n.id));
            }
            if let Some(area) = n.key.as_str().strip_prefix("a:") {
                if area != n.gebiet.as_str() {
                    faults.push(format!("note {:?}: a note on a Gebiet names another", n.id));
                }
            }
        }
        let mut running = BTreeSet::new();
        for lauf in &dump.laeufe {
            let id = &lauf.id;
            if !gebiete.contains_key(&lauf.gebiet) {
                faults.push(format!("lauf {id:?}: no Gebiet"));
            }
            match (lauf.status, lauf.ended_at) {
                (LaufStatus::Active, None) => {
                    if !running.insert(&lauf.gebiet) {
                        faults.push(format!("lauf {id:?}: a second Lauf runs in the Gebiet"));
                    }
                    if gebiete.get(&lauf.gebiet).is_none_or(|(_, deleted)| *deleted) {
                        faults.push(format!("lauf {id:?}: runs in a Gebiet that is gone"));
                    }
                }
                (LaufStatus::Ended, Some(end)) if end >= lauf.started_at => {}
                _ => faults.push(format!("lauf {id:?}: status and end do not fit")),
            }
            let counted = marks::done_between(&mut self.sql, &lauf.gebiet, lauf.started_at, lauf.ended_at)?;
            if counted != lauf.houses {
                faults.push(format!("lauf {id:?}: says {} houses, the marks say {counted}", lauf.houses));
            }
        }
        Ok(faults)
    }
}
