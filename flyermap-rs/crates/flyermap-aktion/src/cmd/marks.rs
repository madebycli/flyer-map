//! Marks: edits of the status of houses and streets. The right to mark is asked once for the Gebiet; each edit is judged on its own (key, stamp, owner).
//! The newest stamp per key wins, whatever the order or the number of deliveries: an edit that is not newer is `stale`, and says so.
use super::Done;
use crate::{
    fail::R,
    out::Out,
    queries::marks as table,
    rights::{visible_gebiet, Ctx},
    sql::Sql,
    stats, validate,
};
use flyermap_identity::Action;
use flyermap_protocol::{limits::MAX_MARKS, Change, GebietId, Key, MarkIn, Reason, Refused};
use std::collections::{BTreeMap, HashMap};

pub(super) fn run<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, gebiet: &GebietId, marks: &[MarkIn]) -> R<Done> {
    if marks.is_empty() {
        return Err(Reason::BadValue.into());
    }
    if marks.len() > MAX_MARKS {
        return Err(Reason::TooLarge { limit: MAX_MARKS as u32 }.into());
    }
    let row = visible_gebiet(sql, cx, gebiet)?;
    if row.deleted {
        return Err(Reason::Deleted.into());
    }
    cx.require(Action::Mark, &cx.gebiet_resource(&row.gebiet))?;

    // judge each edit on its own; of several for one key in the batch only the newest is looked at
    let mut done = Done::default();
    let mut newest: BTreeMap<&Key, (usize, &MarkIn)> = BTreeMap::new();
    for (index, mark) in marks.iter().enumerate() {
        let refuse = |reason| Refused { index: index as u32, reason };
        if !mark.key.is_wire_valid() {
            done.refused.push(refuse(Reason::BadKey));
        } else if let Err(reason) = validate::stamp(&mark.op, cx.now, cx.limits) {
            done.refused.push(refuse(reason));
        } else if newest.get(&mark.key).is_some_and(|(_, prior)| prior.op >= mark.op) {
            done.stale += 1;
        } else {
            done.stale += u32::from(newest.insert(&mark.key, (index, mark)).is_some());
        }
    }

    // against what is stored
    let keys: Vec<Key> = newest.keys().map(|k| (*k).clone()).collect();
    let stored: HashMap<Key, table::MarkRow> = table::get_many(sql, &keys)?.into_iter().map(|r| (r.mark.key.clone(), r)).collect();
    let mut winners: Vec<&MarkIn> = Vec::new();
    let mut new_rows = 0u32;
    let mut walls: Vec<u64> = Vec::new();
    for (index, mark) in newest.values() {
        let current = stored.get(&mark.key);
        match current {
            Some(row) if !row.removed && row.mark.gebiet != *gebiet => {
                done.refused.push(Refused { index: *index as u32, reason: Reason::KeyOwnedElsewhere });
                continue;
            }
            Some(row) if row.mark.op >= mark.op => {
                done.stale += 1;
                continue;
            }
            Some(row) => walls.extend(row.mark.op.decode().map(|c| c.wall)),
            None => {}
        }
        new_rows += u32::from(current.is_none_or(|r| r.mark.gebiet != *gebiet));
        walls.extend(mark.op.decode().map(|c| c.wall));
        winners.push(mark);
    }
    if new_rows > 0 && table::count_rows(sql, gebiet)?.saturating_add(new_rows) > cx.limits.max_marks_per_gebiet {
        return Err(Reason::LimitReached { limit: cx.limits.max_marks_per_gebiet }.into());
    }

    // oldest stamp first: the order in the log is the order of the race
    winners.sort_by(|a, b| a.op.cmp(&b.op));
    for mark in &winners {
        out.emit(sql, Change::MarkSet { gebiet: gebiet.clone(), key: mark.key.clone(), status: mark.status, op: mark.op.clone() })?;
    }
    done.applied = winners.len() as u32;
    done.refused.sort_by_key(|r| r.index);
    if let (Some(lo), Some(hi)) = (walls.iter().min(), walls.iter().max()) {
        stats::recount(sql, out, gebiet, *lo, *hi)?;
    }
    Ok(done)
}
