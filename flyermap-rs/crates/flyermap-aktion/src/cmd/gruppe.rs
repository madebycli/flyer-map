//! Gruppen. Creating and deleting one is a matter of the Aktion (an Admin); changing one is also the Leitung's of that Gruppe.
use super::Done;
use crate::{
    fail::R,
    out::Out,
    queries::{areas, groups},
    rights::Ctx,
    sql::Sql,
    validate,
};
use flyermap_identity::Action;
use flyermap_protocol::{limits::COLORS, Change, Gruppe, GruppeId, GruppeIn, Reason};

pub(super) fn upsert<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, input: &GruppeIn) -> R<Done> {
    validate::id(input.id.as_str())?;
    let name = validate::name(&input.name)?;
    if input.color >= COLORS {
        return Err(Reason::BadValue.into());
    }
    let stored = groups::get(sql, &input.id)?;
    if input.base_rev == 0 {
        cx.require(Action::ManageGroup, &cx.aktion_resource())?;
        if stored.is_some() {
            return Err(Reason::Exists.into());
        }
        if groups::count_live(sql)? >= cx.limits.max_gruppen {
            return Err(Reason::LimitReached { limit: cx.limits.max_gruppen }.into());
        }
        out.emit(sql, Change::GruppeSet { gruppe: Gruppe { id: input.id.clone(), name, color: input.color, rev: 1 } })?;
        return Ok(Done::applied(1));
    }
    cx.require(Action::ManageGroup, &cx.gruppe_resource(&input.id))?;
    let Some(row) = stored else { return Err(Reason::NotFound.into()) };
    if row.deleted {
        return Err(Reason::Deleted.into());
    }
    if row.gruppe.rev != input.base_rev {
        return Err(Reason::RevMismatch { current: row.gruppe.rev }.into());
    }
    if row.gruppe.name == name && row.gruppe.color == input.color {
        return Ok(Done::unchanged());
    }
    out.emit(sql, Change::GruppeSet { gruppe: Gruppe { id: input.id.clone(), name, color: input.color, rev: row.gruppe.rev + 1 } })?;
    Ok(Done::applied(1))
}

pub(super) fn remove<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, id: &GruppeId, base_rev: u64) -> R<Done> {
    validate::id(id.as_str())?;
    cx.require(Action::ManageGroup, &cx.aktion_resource())?;
    let Some(row) = groups::get(sql, id)? else { return Err(Reason::NotFound.into()) };
    if row.deleted {
        return Err(Reason::Deleted.into());
    }
    if row.gruppe.rev != base_rev {
        return Err(Reason::RevMismatch { current: row.gruppe.rev }.into());
    }
    if areas::count_live_in_gruppe(sql, id)? > 0 {
        return Err(Reason::HasChildren.into());
    }
    out.emit(sql, Change::GruppeRemoved { id: id.clone(), rev: row.gruppe.rev + 1 })?;
    Ok(Done::applied(1))
}
