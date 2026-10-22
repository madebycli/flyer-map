//! Orphans and hand-overs. Deleting or reshaping a Gebiet never removes marks and notes by itself; two commands of their own do:
//! - `Cleanup` removes them for good (as tombstones). The person has seen the numbers and sends them back (`expect`); if the state has moved on, nothing happens.
//! - `Move` hands marks and notes on some keys from one Gebiet to another, so that a Gebiet that was drawn again, or whose piece went to a neighbour, keeps its progress.
use super::Done;
use crate::{
    fail::R,
    out::Out,
    queries::{marks, notes},
    rights::{visible_gebiet, Ctx},
    sql::Sql,
    stats,
};
use flyermap_core::note::is_note_key;
use flyermap_identity::Action;
use flyermap_protocol::{limits::MAX_KEYS, Change, Counts, GebietId, Key, NoteId, Notiz, Reason};
use std::collections::BTreeSet;

const PAGE: u32 = 1_000;

/// Every live mark key and note id of a Gebiet.
fn everything<S: Sql>(sql: &mut S, gebiet: &GebietId) -> R<(Vec<Key>, Vec<NoteId>)> {
    let (mut keys, mut ids) = (Vec::new(), Vec::new());
    loop {
        let page = marks::page(sql, gebiet, keys.last(), PAGE)?;
        let done = page.len() < PAGE as usize;
        keys.extend(page.into_iter().map(|m| m.key));
        if done {
            break;
        }
    }
    loop {
        let page = notes::page(sql, gebiet, ids.last(), PAGE)?;
        let done = page.len() < PAGE as usize;
        ids.extend(page.into_iter().map(|n| n.id));
        if done {
            break;
        }
    }
    Ok((keys, ids))
}

fn distinct(keys: &[Key], accepts: impl Fn(&Key) -> bool) -> R<Vec<Key>> {
    if keys.is_empty() {
        return Err(Reason::BadValue.into());
    }
    if keys.len() > MAX_KEYS {
        return Err(Reason::TooLarge { limit: MAX_KEYS as u32 }.into());
    }
    if !keys.iter().all(accepts) {
        return Err(Reason::BadKey.into());
    }
    Ok(keys.iter().cloned().collect::<BTreeSet<_>>().into_iter().collect())
}

pub(super) fn clean<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, gebiet: &GebietId, keys: Option<&[Key]>, expect: Counts) -> R<Done> {
    let row = visible_gebiet(sql, cx, gebiet)?;
    cx.require(Action::DrawArea, &cx.gebiet_resource(&row.gebiet))?;
    let (mark_keys, note_ids) = match keys {
        None => {
            if !row.deleted {
                return Err(Reason::NotDeleted.into());
            }
            everything(sql, gebiet)?
        }
        Some(list) => {
            let list = distinct(list, |k| k.is_wire_valid() || is_note_key(k.as_str()))?;
            let found = marks::owned(sql, gebiet, &list)?.into_iter().map(|r| r.mark.key).collect();
            (found, notes::on_keys(sql, gebiet, &list)?.into_iter().map(|n| n.id).collect())
        }
    };
    let would = Counts { marks: mark_keys.len() as u32, notes: note_ids.len() as u32 };
    if would != expect {
        return Err(Reason::ConfirmMismatch { marks: would.marks, notes: would.notes }.into());
    }
    if would == Counts::default() {
        return Ok(Done::unchanged());
    }
    let rev = out.stamp();
    for chunk in mark_keys.chunks(MAX_KEYS) {
        out.emit(sql, Change::MarksRemoved { gebiet: gebiet.clone(), keys: chunk.to_vec(), rev: rev.clone() })?;
    }
    for chunk in note_ids.chunks(MAX_KEYS) {
        out.emit(sql, Change::NotesRemoved { gebiet: gebiet.clone(), ids: chunk.to_vec(), rev: rev.clone() })?;
    }
    stats::recount_all(sql, out, gebiet)?;
    Ok(Done::applied(would.marks + would.notes))
}

pub(super) fn hand_over<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, from: &GebietId, to: &GebietId, keys: &[Key]) -> R<Done> {
    if from == to {
        return Err(Reason::BadValue.into());
    }
    let keys = distinct(keys, Key::is_wire_valid)?;
    let (source, target) = (visible_gebiet(sql, cx, from)?, visible_gebiet(sql, cx, to)?);
    cx.require(Action::DrawArea, &cx.gebiet_resource(&source.gebiet))?;
    cx.require(Action::DrawArea, &cx.gebiet_resource(&target.gebiet))?;
    if target.deleted {
        return Err(Reason::Deleted.into());
    }
    if source.gebiet.art != target.gebiet.art {
        return Err(Reason::WrongArt.into());
    }
    let (owned, written) = (marks::owned(sql, from, &keys)?, notes::on_keys(sql, from, &keys)?);
    if marks::count_rows(sql, to)?.saturating_add(owned.len() as u32) > cx.limits.max_marks_per_gebiet
        || notes::count_rows(sql, to)?.saturating_add(written.len() as u32) > cx.limits.max_notes_per_gebiet
    {
        return Err(Reason::LimitReached { limit: cx.limits.max_marks_per_gebiet }.into());
    }
    // the same stamps for the other Gebiet: an equal stamp is accepted, and moves the key
    for row in &owned {
        let m = &row.mark;
        out.emit(sql, Change::MarkSet { gebiet: to.clone(), key: m.key.clone(), status: m.status, op: m.op.clone() })?;
    }
    for note in &written {
        out.emit(sql, Change::NoteSet { note: Notiz { gebiet: to.clone(), ..note.clone() } })?;
    }
    stats::recount_all(sql, out, from)?;
    stats::recount_all(sql, out, to)?;
    let moved = owned.len() as u32;
    Ok(Done { applied: moved + written.len() as u32, stale: (keys.len() as u32).saturating_sub(moved), ..Done::default() })
}
