//! Abholen: taking a Gebiet over and giving it back. Taking over needs the Gebiet to be free and a leaf (a main area is collected in its parts); the access
//! to mark there is a grant at the Gebiet that whoever owns the grants makes when the `Collected` entry arrives, and ends it on `Released`.
use super::Done;
use crate::{
    fail::R,
    out::Out,
    queries::areas,
    rights::{visible_gebiet, Ctx},
    sql::Sql,
};
use flyermap_identity::Action;
use flyermap_protocol::{Art, Change, GebietId, Reason};

pub(super) fn take<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, id: &GebietId) -> R<Done> {
    let row = visible_gebiet(sql, cx, id)?;
    cx.require(Action::Collect, &cx.gebiet_resource(&row.gebiet))?;
    if row.deleted {
        return Err(Reason::Deleted.into());
    }
    if row.gebiet.art != Art::Abholen {
        return Err(Reason::WrongArt.into());
    }
    if row.gebiet.collected.is_some() {
        return Err(Reason::NotFree.into());
    }
    if !areas::live_children(sql, id)?.is_empty() {
        return Err(Reason::NotLeaf.into());
    }
    out.emit(sql, Change::Collected { gebiet: id.clone(), by: cx.caller.principal.clone(), at: cx.now })?;
    Ok(Done::applied(1))
}

/// The one who took it gives it back; so may whoever runs the Aktion (a Helper who has gone home).
pub(super) fn give_back<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, id: &GebietId) -> R<Done> {
    let row = visible_gebiet(sql, cx, id)?;
    let Some(collected) = row.gebiet.collected.as_ref().filter(|_| !row.deleted) else {
        // nobody has it: the rights are asked all the same, so that this is no way to find out
        cx.require(Action::Collect, &cx.gebiet_resource(&row.gebiet))?;
        return Err(Reason::NotCollected.into());
    };
    if collected.by == cx.caller.principal {
        cx.require(Action::Collect, &cx.gebiet_resource(&row.gebiet))?;
    } else {
        cx.require(Action::ManageAktion, &cx.aktion_resource())?;
    }
    out.emit(sql, Change::Released { gebiet: id.clone() })?;
    Ok(Done::applied(1))
}
