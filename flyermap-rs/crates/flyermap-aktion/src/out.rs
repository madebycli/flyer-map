//! What one command produces: numbered entries, each applied to the tables and written to the log in the same step, so that the log and the state cannot
//! disagree. The numbers are taken from the head the Akteur had when the command started and only become the head if the command's transaction commits.
use crate::{
    apply::apply,
    queries::{self, log},
    sql::{Sql, SqlError},
};
use flyermap_core::clock::{encode_clock, tick, ClockState};
use flyermap_protocol::{Change, Entry, OpId};

pub(crate) struct Out {
    pub entries: Vec<Entry>,
    head: u64,
    /// The Akteur's own clock: it stamps what it removes (clean-ups), so that an old edit cannot bring the removed thing back.
    pub clock: ClockState,
    pub clock_used: bool,
    /// The command changed who may read a Gebiet (it was given to another Gruppe): devices that held it must take a new snapshot.
    pub rights_moved: bool,
    now: u64,
    who: String,
}

impl Out {
    pub fn new(head: u64, clock: ClockState, now: u64, who: &str) -> Out {
        Out { entries: Vec::new(), head, clock, clock_used: false, rights_moved: false, now, who: who.to_string() }
    }

    pub fn head(&self) -> u64 {
        self.head
    }

    /// Number the change, apply it, log it.
    pub fn emit<S: Sql>(&mut self, sql: &mut S, change: Change) -> Result<(), SqlError> {
        let entry = Entry { seq: self.head + 1, at: self.now, by: self.who.clone(), change };
        apply(sql, &entry)?;
        log::append(sql, entry.seq, entry.at, &entry.by, &queries::json(&entry.change))?;
        self.head = entry.seq;
        self.entries.push(entry);
        Ok(())
    }

    /// A stamp of the Akteur, later than any it gave before.
    pub fn stamp(&mut self) -> OpId {
        self.clock = tick(&self.clock, self.now);
        self.clock_used = true;
        encode_clock(&self.clock)
    }
}
