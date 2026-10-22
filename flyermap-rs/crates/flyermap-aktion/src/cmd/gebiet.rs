//! Gebiete: drawing, changing, deleting. The world (Austeilen or Abholen) and a sub-area's main area never change after creation. Deleting keeps the
//! Gebiet as a tombstone and its marks and notes as orphans, which the answer counts; removing them is a command of its own (`Cleanup`).
use super::Done;
use crate::{
    fail::R,
    geometry,
    out::Out,
    queries::{areas, groups, marks, notes, runs},
    rights::{visible_gebiet, Ctx},
    sql::Sql,
    validate,
};
use flyermap_identity::Action;
use flyermap_protocol::{Art, Change, Counts, Gebiet, GebietId, GebietIn, GruppeId, Reason};

/// The Gruppe a Gebiet is given must be there; only Austeilen has one, only Abholen has a main area.
fn check_shape<S: Sql>(sql: &mut S, art: Art, gruppe: Option<&GruppeId>, parent: Option<&GebietId>) -> R<Option<Gebiet>> {
    if let Some(id) = gruppe {
        validate::id(id.as_str())?;
        if art != Art::Austeilen {
            return Err(Reason::WrongArt.into());
        }
        if !groups::get(sql, id)?.is_some_and(|g| !g.deleted) {
            return Err(Reason::BadParent.into());
        }
    }
    let Some(id) = parent else { return Ok(None) };
    validate::id(id.as_str())?;
    if art != Art::Abholen {
        return Err(Reason::WrongArt.into());
    }
    // a main area that is there, not itself a sub-area, and not taken over (adding parts to it would change what the Helper took)
    match areas::get(sql, id)? {
        Some(row) if !row.deleted && row.gebiet.art == Art::Abholen && row.gebiet.parent.is_none() => {
            if row.gebiet.collected.is_some() {
                return Err(Reason::InUse.into());
            }
            Ok(Some(row.gebiet))
        }
        _ => Err(Reason::BadParent.into()),
    }
}

pub(super) fn upsert<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, input: &GebietIn) -> R<Done> {
    validate::id(input.id.as_str())?;
    let name = validate::name(&input.name)?;
    let ring = validate::ring(&input.ring)?;
    let wanted = cx.area_resource(&input.id, input.art, input.gruppe.as_ref());
    if input.base_rev == 0 {
        return create(sql, cx, out, input, name, ring, &wanted);
    }
    let row = visible_gebiet(sql, cx, &input.id)?;
    let old = row.gebiet;
    cx.require(Action::DrawArea, &cx.gebiet_resource(&old))?;
    if row.deleted {
        return Err(Reason::Deleted.into());
    }
    if input.art != old.art {
        return Err(Reason::WrongArt.into());
    }
    if input.parent != old.parent {
        return Err(Reason::BadParent.into());
    }
    if input.gruppe != old.gruppe {
        // handing a Gebiet to another Gruppe takes the right to draw in both
        cx.require(Action::DrawArea, &wanted)?;
        check_shape(sql, input.art, input.gruppe.as_ref(), None)?;
    }
    if old.rev != input.base_rev {
        return Err(Reason::RevMismatch { current: old.rev }.into());
    }
    if old.name == name && old.ring == ring && old.gruppe == input.gruppe {
        return Ok(Done::unchanged());
    }
    if old.ring != ring {
        let main = old.parent.as_ref().map(|p| areas::get(sql, p)).transpose()?.flatten().map(|r| r.gebiet);
        geometry::judge(sql, cx, &ring, old.art, main.as_ref(), &old.id)?;
        geometry::children_stay(sql, &old.id, &ring)?;
    }
    out.emit(sql, Change::GebietSet { gebiet: Gebiet { name, ring, gruppe: input.gruppe.clone(), rev: old.rev + 1, ..old } })?;
    Ok(Done::applied(1))
}

fn create<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, input: &GebietIn, name: String, ring: flyermap_protocol::Ring, wanted: &flyermap_identity::Resource) -> R<Done> {
    cx.require(Action::DrawArea, wanted)?;
    let main = check_shape(sql, input.art, input.gruppe.as_ref(), input.parent.as_ref())?;
    if areas::get(sql, &input.id)?.is_some() {
        return Err(Reason::Exists.into());
    }
    if areas::count_live(sql)? >= cx.limits.max_gebiete {
        return Err(Reason::LimitReached { limit: cx.limits.max_gebiete }.into());
    }
    geometry::judge(sql, cx, &ring, input.art, main.as_ref(), &input.id)?;
    let gebiet = Gebiet { id: input.id.clone(), art: input.art, gruppe: input.gruppe.clone(), parent: input.parent.clone(), name, ring, rev: 1, collected: None };
    out.emit(sql, Change::GebietSet { gebiet })?;
    Ok(Done::applied(1))
}

pub(super) fn remove<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, id: &GebietId, base_rev: u64) -> R<Done> {
    let row = visible_gebiet(sql, cx, id)?;
    cx.require(Action::DrawArea, &cx.gebiet_resource(&row.gebiet))?;
    if row.deleted {
        return Err(Reason::Deleted.into());
    }
    if row.gebiet.rev != base_rev {
        return Err(Reason::RevMismatch { current: row.gebiet.rev }.into());
    }
    if !areas::live_children(sql, id)?.is_empty() {
        return Err(Reason::HasChildren.into());
    }
    if row.gebiet.collected.is_some() || runs::active_of(sql, id)?.is_some() {
        return Err(Reason::InUse.into());
    }
    let orphans = Counts { marks: marks::count_live(sql, id)?, notes: notes::count_live(sql, id)? };
    out.emit(sql, Change::GebietRemoved { id: id.clone(), rev: row.gebiet.rev + 1 })?;
    Ok(Done { applied: 1, orphans: Some(orphans), ..Done::default() })
}
