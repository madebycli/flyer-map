//! What a device reads: the snapshot, pages of marks and notes, and the log from a position. Everything is cut to what the caller may see, by asking
//! `decide` for each Gebiet (never in a `WHERE`), and a Gebiet the caller may not know of is simply not there.
//!
//! A device that holds a snapshot and then reads the log from its `head` is complete: the pages may bring things beyond `head`, and applying an entry
//! of the log to a state that already has it changes nothing. One limit is the host's to handle: when the *rights* of a caller change (a grant ends, a
//! Gebiet is given to another Gruppe) the entries that took something from view are not shown to that caller, so the host takes a new snapshot of it then
//! (a revoked or changed grant closes its connections, Plan 061 §3).
use crate::{
    aktion::Aktion,
    audience::Audience,
    caller::Caller,
    queries::{self, areas, groups, log, marks, notes, runs},
    rights::Ctx,
    sql::{Sql, SqlError},
};
use flyermap_diag::{diag, Level};
use flyermap_identity::Action;
use flyermap_protocol::{
    limits::{MAX_PAGE_ENTRIES, MAX_PAGE_ROWS},
    Catchup, Change, Entry, GebietId, MarkCursor, MarksPage, NoteCursor, NotesPage, Reason, Snapshot, Why,
};
use std::collections::HashMap;

/// A storage failure of a read is told as such; what the engine said goes to the diagnostics, not to the caller.
fn storage(error: SqlError) -> Reason {
    diag!(Level::Error, "aktion", code "aktion.storage", "storage failed on a read", error = error.0);
    Reason::Storage
}

/// The Gebiete (not deleted) whose marks and notes the caller may read, by id.
fn readable<S: Sql>(sql: &mut S, cx: &Ctx) -> Result<Vec<GebietId>, Reason> {
    let facts = areas::live_facts(sql).map_err(storage)?;
    Ok(facts.into_iter().filter(|f| cx.decide(Action::Read, &cx.facts_resource(f)).is_allowed()).map(|f| f.id).collect())
}

impl<S: Sql> Aktion<S> {
    /// Gruppen, Gebiete and Läufe as the caller may see them, at the head of the log. Marks and notes follow in pages.
    pub fn snapshot(&mut self, caller: &Caller, now: u64) -> Result<Snapshot, Reason> {
        let Aktion { sql, org, aktion, limits, head, floor, .. } = self;
        if !caller.is_valid() {
            return Err(Reason::Forbidden { why: Why::NoGrant });
        }
        let cx = Ctx { org, aktion, caller, now, limits };
        cx.enter()?;
        let gruppen = groups::live(sql).map_err(storage)?;
        let gebiete = areas::live(sql).map_err(storage)?.into_iter().filter(|g| cx.may_outline(g)).collect();
        let recent = runs::recent(sql, now.saturating_sub(limits.recent_runs_ms)).map_err(storage)?;
        let mut ids: Vec<GebietId> = recent.iter().map(|l| l.gebiet.clone()).collect();
        ids.sort();
        ids.dedup();
        let facts: HashMap<GebietId, areas::Facts> = areas::facts(sql, &ids).map_err(storage)?.into_iter().map(|f| (f.id.clone(), f)).collect();
        let laeufe = recent
            .into_iter()
            .filter(|l| facts.get(&l.gebiet).is_some_and(|f| cx.decide(Action::Read, &cx.facts_resource(f)).is_allowed()))
            .collect();
        Ok(Snapshot { head: *head, floor: *floor, server_now: now, gruppen, gebiete, laeufe })
    }

    /// A page of the marks of the Gebiete the caller may read, in the order (Gebiet, key), after `after`. `limit` is cut to the protocol's.
    pub fn marks_page(&mut self, caller: &Caller, now: u64, after: Option<&MarkCursor>, limit: u32) -> Result<MarksPage, Reason> {
        let Aktion { sql, org, aktion, limits, .. } = self;
        if !caller.is_valid() {
            return Err(Reason::Forbidden { why: Why::NoGrant });
        }
        let cx = Ctx { org, aktion, caller, now, limits };
        cx.enter()?;
        let limit = limit.clamp(1, MAX_PAGE_ROWS) as usize;
        let mut rows = Vec::new();
        for id in readable(sql, &cx)?.iter().filter(|id| after.is_none_or(|a| **id >= a.gebiet)) {
            let from = after.filter(|a| a.gebiet == *id).map(|a| &a.key);
            // one more than the page: if it comes, there is a next page
            let want = (limit + 1 - rows.len()) as u32;
            rows.extend(marks::page(sql, id, from, want).map_err(storage)?);
            if rows.len() > limit {
                break;
            }
        }
        let next = if rows.len() > limit {
            rows.truncate(limit);
            rows.last().map(|m| MarkCursor { gebiet: m.gebiet.clone(), key: m.key.clone() })
        } else {
            None
        };
        Ok(MarksPage { marks: rows, next })
    }

    /// A page of the notes (not deleted) of the Gebiete the caller may read, in the order (Gebiet, id), after `after`.
    pub fn notes_page(&mut self, caller: &Caller, now: u64, after: Option<&NoteCursor>, limit: u32) -> Result<NotesPage, Reason> {
        let Aktion { sql, org, aktion, limits, .. } = self;
        if !caller.is_valid() {
            return Err(Reason::Forbidden { why: Why::NoGrant });
        }
        let cx = Ctx { org, aktion, caller, now, limits };
        cx.enter()?;
        let limit = limit.clamp(1, MAX_PAGE_ROWS) as usize;
        let mut rows = Vec::new();
        for id in readable(sql, &cx)?.iter().filter(|id| after.is_none_or(|a| **id >= a.gebiet)) {
            let from = after.filter(|a| a.gebiet == *id).map(|a| &a.id);
            let want = (limit + 1 - rows.len()) as u32;
            rows.extend(notes::page(sql, id, from, want).map_err(storage)?);
            if rows.len() > limit {
                break;
            }
        }
        let next = if rows.len() > limit {
            rows.truncate(limit);
            rows.last().map(|n| NoteCursor { gebiet: n.gebiet.clone(), id: n.id.clone() })
        } else {
            None
        };
        Ok(NotesPage { notes: rows, next })
    }

    /// What happened after position `since`, as far as the caller may see it. A caller that is behind the floor of the log, or ahead of its head (the
    /// Aktion was reset), is told to take a snapshot.
    pub fn catchup(&mut self, caller: &Caller, now: u64, since: u64, limit: u32) -> Result<Catchup, Reason> {
        let Aktion { sql, org, aktion, limits, head, floor, .. } = self;
        if !caller.is_valid() {
            return Err(Reason::Forbidden { why: Why::NoGrant });
        }
        let cx = Ctx { org, aktion, caller, now, limits };
        cx.enter()?;
        let (head, floor) = (*head, *floor);
        if since > head || since < floor {
            return Ok(Catchup::Resync { head, floor });
        }
        let rows = log::range(sql, since, limit.clamp(1, MAX_PAGE_ENTRIES)).map_err(storage)?;
        let next = rows.last().map_or(since, |r| r.seq);
        let entries = rows
            .into_iter()
            .map(|r| Ok(Entry { seq: r.seq, at: r.at, by: r.who, change: queries::unjson::<Change>(&r.change)? }))
            .collect::<Result<Vec<_>, SqlError>>()
            .map_err(storage)?;
        let mut ids: Vec<GebietId> = entries.iter().filter_map(|e| e.change.gebiet().cloned()).collect();
        ids.sort();
        ids.dedup();
        let audience = Audience::new(org, aktion, areas::facts(sql, &ids).map_err(storage)?);
        Ok(Catchup::Entries { entries: audience.filter(caller, now, &entries), next, head, more: next < head })
    }
}
