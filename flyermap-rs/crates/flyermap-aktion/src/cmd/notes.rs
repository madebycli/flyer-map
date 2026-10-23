//! Notes: a flag and/or a short text on a house, a street piece or a whole Gebiet. Last writer wins by the stamp of the edit; a deleted note stays as an empty
//! tombstone. Anybody who may annotate in the Gebiet may change or delete its notes.
use super::Done;
use crate::{
    fail::R,
    out::Out,
    queries::notes as table,
    rights::{visible_gebiet, Ctx},
    sql::Sql,
    validate,
};
use flyermap_core::note::{clean_text, is_note_key};
use flyermap_identity::Action;
use flyermap_protocol::{Change, NoteIn, Notiz, Reason};

pub(super) fn run<S: Sql>(sql: &mut S, cx: &Ctx, out: &mut Out, input: &NoteIn) -> R<Done> {
    validate::id(input.id.as_str())?;
    if !is_note_key(input.key.as_str()) {
        return Err(Reason::BadKey.into());
    }
    // a note on a whole Gebiet names that Gebiet
    if let Some(area) = input.key.as_str().strip_prefix("a:") {
        if area != input.gebiet.as_str() {
            return Err(Reason::BadKey.into());
        }
    }
    validate::stamp(&input.rev, cx.now, cx.limits)?;
    let text = clean_text(&input.text);
    if !input.deleted && input.flag.is_none() && text.is_empty() {
        return Err(Reason::BadText.into());
    }

    let row = visible_gebiet(sql, cx, &input.gebiet)?;
    if row.deleted {
        return Err(Reason::Deleted.into());
    }
    cx.require(Action::Annotate, &cx.gebiet_resource(&row.gebiet))?;

    let stored = table::get(sql, &input.id)?;
    match &stored {
        Some(note) if note.gebiet != input.gebiet || note.key != input.key => return Err(Reason::KeyOwnedElsewhere.into()),
        Some(note) if note.rev >= input.rev => return Ok(Done::unchanged()),
        Some(_) => {}
        None => {
            if table::count_rows(sql, &input.gebiet)? >= cx.limits.max_notes_per_gebiet {
                return Err(Reason::LimitReached { limit: cx.limits.max_notes_per_gebiet }.into());
            }
        }
    }
    // a deleted note keeps no content
    let (flag, text) = if input.deleted { (None, String::new()) } else { (input.flag, text) };
    let note = Notiz {
        id: input.id.clone(),
        key: input.key.clone(),
        gebiet: input.gebiet.clone(),
        flag,
        text,
        rev: input.rev.clone(),
        deleted: input.deleted,
        by: cx.caller.principal.clone(),
    };
    out.emit(sql, Change::NoteSet { note })?;
    Ok(Done::applied(1))
}
