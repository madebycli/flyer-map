//! Läufe: a shared outing in one Gebiet. One Lauf at a time per Gebiet. People are counted by hand; the houses done are counted from the marks (`stats`).
//! Ending writes `LaufEnded`: whoever owns the grants ends the access of the Lauf's guests on that entry.
use super::Done;
use crate::{
    fail::R,
    out::Out,
    queries::{marks, runs},
    rights::{visible_gebiet, Ctx},
    sql::Sql,
    validate,
};
use flyermap_identity::Action;
use flyermap_protocol::{limits::MAX_PERSONS, Change, Join, Lauf, LaufId, LaufIn, LaufStatus, Reason};

/// The Lauf, if its Gebiet is one the caller may know of; the Gebiet's row comes with it for the rights.
fn find<S: Sql>(sql: &mut S, cx: &Ctx, id: &LaufId) -> R<(Lauf, flyermap_identity::Resource)> {
    validate::id(id.as_str())?;
    let lauf = runs::get(sql, id)?.ok_or(Reason::NotFound)?;
    let row = visible_gebiet(sql, cx, &lauf.gebiet)?;
    let resource = cx.gebiet_resource(&row.gebiet);
    Ok((lauf, resource))
}

pub(super) fn start<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, input: &LaufIn) -> R<Done> {
    validate::id(input.id.as_str())?;
    if input.persons > MAX_PERSONS {
        return Err(Reason::BadValue.into());
    }
    let row = visible_gebiet(sql, cx, &input.gebiet)?;
    cx.require(Action::StartRun, &cx.gebiet_resource(&row.gebiet))?;
    if row.deleted {
        return Err(Reason::Deleted.into());
    }
    if runs::get(sql, &input.id)?.is_some() {
        return Err(Reason::Exists.into());
    }
    if runs::active_of(sql, &input.gebiet)?.is_some() {
        return Err(Reason::RunActive.into());
    }
    if runs::count_active(sql)? >= cx.limits.max_active_runs {
        return Err(Reason::LimitReached { limit: cx.limits.max_active_runs }.into());
    }
    // edits stamped from now on count; a phone that was offline and is slightly ahead of the server may already have some
    let houses = marks::done_between(sql, &input.gebiet, cx.now, None)?;
    let lauf = Lauf {
        id: input.id.clone(),
        gebiet: input.gebiet.clone(),
        persons: input.persons,
        join: input.join,
        status: LaufStatus::Active,
        started_at: cx.now,
        ended_at: None,
        houses,
        by: cx.caller.principal.clone(),
        rev: 1,
    };
    out.emit(sql, Change::LaufSet { lauf })?;
    Ok(Done::applied(1))
}

pub(super) fn update<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, id: &LaufId, persons: Option<u16>, join: Option<Join>) -> R<Done> {
    let (lauf, resource) = find(sql, cx, id)?;
    cx.require(Action::StartRun, &resource)?;
    if persons.is_some_and(|n| n > MAX_PERSONS) {
        return Err(Reason::BadValue.into());
    }
    if lauf.status == LaufStatus::Ended {
        return Err(Reason::RunEnded.into());
    }
    let (persons, join) = (persons.unwrap_or(lauf.persons), join.unwrap_or(lauf.join));
    if persons == lauf.persons && join == lauf.join {
        return Ok(Done::unchanged());
    }
    out.emit(sql, Change::LaufSet { lauf: Lauf { persons, join, rev: lauf.rev + 1, ..lauf } })?;
    Ok(Done::applied(1))
}

pub(super) fn end<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, id: &LaufId) -> R<Done> {
    let (lauf, resource) = find(sql, cx, id)?;
    cx.require(Action::StartRun, &resource)?;
    if lauf.status == LaufStatus::Ended {
        return Err(Reason::RunEnded.into());
    }
    // the window closes now; count what was done within it
    let ended_at = cx.now.max(lauf.started_at);
    let houses = marks::done_between(sql, &lauf.gebiet, lauf.started_at, Some(ended_at))?;
    out.emit(sql, Change::LaufEnded { lauf: Lauf { status: LaufStatus::Ended, ended_at: Some(ended_at), houses, rev: lauf.rev + 1, ..lauf } })?;
    Ok(Done::applied(1))
}
