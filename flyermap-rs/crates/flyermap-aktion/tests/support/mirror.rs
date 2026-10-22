//! A device, as the protocol describes it: it holds what it was told and applies the entries it is shown, in log order, skipping what it has already
//! seen. Written from the documentation of the protocol and not from the Akteur's tables, so that it is a second opinion on them.
use flyermap_aktion::{Aktion, Caller, Dump, RusqliteSql};
use flyermap_identity::{decide, Action, Resource};
use flyermap_protocol::{
    Catchup, Change, Entry, Gebiet, GebietId, Gruppe, GruppeId, Key, Lauf, LaufId, Mark, NoteId, Notiz,
};
use std::collections::BTreeMap;

use super::who;

/// What a person sees when the data is at rest: live things only.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct View {
    pub gruppen: Vec<Gruppe>,
    pub gebiete: Vec<Gebiet>,
    pub marks: Vec<Mark>,
    pub notes: Vec<Notiz>,
    pub laeufe: Vec<Lauf>,
}

#[derive(Clone, Debug, Default)]
pub struct Mirror {
    pub applied: u64,
    gruppen: BTreeMap<GruppeId, (Gruppe, bool)>,
    gebiete: BTreeMap<GebietId, (Gebiet, bool)>,
    marks: BTreeMap<Key, (Mark, bool)>,
    notes: BTreeMap<NoteId, Notiz>,
    laeufe: BTreeMap<LaufId, Lauf>,
}

impl Mirror {
    /// Apply an entry the device is shown: the next ones in order; one it has seen is skipped.
    pub fn apply(&mut self, entry: &Entry) {
        if entry.seq <= self.applied {
            return;
        }
        self.applied = entry.seq;
        match &entry.change {
            Change::MarkSet { gebiet, key, status, op } => {
                self.put_mark(Mark { key: key.clone(), gebiet: gebiet.clone(), status: *status, op: op.clone(), by: entry.by.clone() }, false);
            }
            Change::MarksRemoved { gebiet, keys, rev } => {
                for key in keys {
                    if let Some((mark, removed)) = self.marks.get_mut(key) {
                        if mark.gebiet == *gebiet && mark.op < *rev {
                            mark.op = rev.clone();
                            *removed = true;
                        }
                    }
                }
            }
            Change::NoteSet { note } => self.put_note(note.clone()),
            Change::HandedOver { from, keys, notes, .. } => {
                // what left `from` and is still held as `from`'s; a device that reads both Gebiete already has it as the new one's
                self.marks.retain(|key, (mark, _)| mark.gebiet != *from || !keys.contains(key));
                self.notes.retain(|id, note| note.gebiet != *from || !notes.contains(id));
            }
            Change::NotesRemoved { gebiet, ids, rev } => {
                for id in ids {
                    if let Some(note) = self.notes.get_mut(id) {
                        if note.gebiet == *gebiet && note.rev < *rev {
                            note.rev = rev.clone();
                            note.deleted = true;
                            note.text.clear();
                            note.flag = None;
                        }
                    }
                }
            }
            Change::GruppeSet { gruppe } => {
                if self.gruppen.get(&gruppe.id).is_none_or(|(old, _)| old.rev <= gruppe.rev) {
                    self.gruppen.insert(gruppe.id.clone(), (gruppe.clone(), false));
                }
            }
            Change::GruppeRemoved { id, rev } => {
                if let Some((gruppe, deleted)) = self.gruppen.get_mut(id) {
                    if gruppe.rev <= *rev {
                        gruppe.rev = *rev;
                        *deleted = true;
                    }
                }
            }
            Change::GebietSet { gebiet } => self.put_gebiet(gebiet),
            Change::GebietRemoved { id, rev } => {
                if let Some((gebiet, deleted)) = self.gebiete.get_mut(id) {
                    if gebiet.rev <= *rev {
                        gebiet.rev = *rev;
                        *deleted = true;
                    }
                }
            }
            Change::Collected { gebiet, by, at } => {
                if let Some((g, _)) = self.gebiete.get_mut(gebiet) {
                    g.collected = Some(flyermap_protocol::Collected { by: by.clone(), at: *at });
                }
            }
            Change::Released { gebiet } => {
                if let Some((g, _)) = self.gebiete.get_mut(gebiet) {
                    g.collected = None;
                }
            }
            Change::LaufSet { lauf } | Change::LaufEnded { lauf } => {
                if self.laeufe.get(&lauf.id).is_none_or(|old| old.rev <= lauf.rev) {
                    self.laeufe.insert(lauf.id.clone(), lauf.clone());
                }
            }
        }
    }

    fn put_gebiet(&mut self, gebiet: &Gebiet) {
        // a Gebiet that is deleted stays deleted
        match self.gebiete.get(&gebiet.id) {
            Some((old, deleted)) if old.rev <= gebiet.rev => {
                let deleted = *deleted;
                self.gebiete.insert(gebiet.id.clone(), (gebiet.clone(), deleted));
            }
            Some(_) => {}
            None => {
                self.gebiete.insert(gebiet.id.clone(), (gebiet.clone(), false));
            }
        }
    }

    fn put_mark(&mut self, mark: Mark, removed: bool) {
        if self.marks.get(&mark.key).is_none_or(|(old, _)| old.op <= mark.op) {
            self.marks.insert(mark.key.clone(), (mark, removed));
        }
    }

    fn put_note(&mut self, note: Notiz) {
        if self.notes.get(&note.id).is_none_or(|old| old.rev <= note.rev) {
            self.notes.insert(note.id.clone(), note);
        }
    }

    /// The live feed says where the log stands: a device that has been shown everything it may see is there.
    pub fn advance(&mut self, head: u64) {
        self.applied = self.applied.max(head);
    }

    /// Entries shown to a device in one go.
    pub fn apply_all(&mut self, entries: &[Entry]) {
        for entry in entries {
            self.apply(entry);
        }
    }

    pub fn view(&self) -> View {
        let live = |id: &GebietId| self.gebiete.get(id).is_some_and(|(_, deleted)| !deleted);
        View {
            gruppen: self.gruppen.values().filter(|(_, deleted)| !deleted).map(|(g, _)| g.clone()).collect(),
            gebiete: self.gebiete.values().filter(|(_, deleted)| !deleted).map(|(g, _)| g.clone()).collect(),
            marks: self.marks.values().filter(|(m, removed)| !removed && live(&m.gebiet)).map(|(m, _)| m.clone()).collect(),
            notes: self.notes.values().filter(|n| !n.deleted && live(&n.gebiet)).cloned().collect(),
            laeufe: self.laeufe.values().cloned().collect(),
        }
    }

    /// A device that starts from nothing: snapshot, then the pages, then the log from the snapshot's head until it is reached.
    pub fn from_scratch(aktion: &mut Aktion<RusqliteSql>, caller: &Caller, now: u64, page: u32) -> Mirror {
        let snapshot = aktion.snapshot(caller, now).expect("snapshot");
        let mut m = Mirror { applied: snapshot.head, ..Mirror::default() };
        for g in snapshot.gruppen {
            m.gruppen.insert(g.id.clone(), (g, false));
        }
        for g in snapshot.gebiete {
            m.gebiete.insert(g.id.clone(), (g, false));
        }
        for l in snapshot.laeufe {
            m.laeufe.insert(l.id.clone(), l);
        }
        let mut after = None;
        loop {
            let got = aktion.marks_page(caller, now, after.as_ref(), page).expect("marks page");
            // a mark carries who made it; the page says so
            for mark in got.marks {
                m.put_mark(mark, false);
            }
            match got.next {
                Some(next) => after = Some(next),
                None => break,
            }
        }
        let mut after = None;
        loop {
            let got = aktion.notes_page(caller, now, after.as_ref(), page).expect("notes page");
            for note in got.notes {
                m.put_note(note);
            }
            match got.next {
                Some(next) => after = Some(next),
                None => break,
            }
        }
        m.catch_up(aktion, caller, now, page);
        m
    }

    /// Read the log from where the device stands until its end. `false`: the device is too far behind and needs a snapshot.
    pub fn catch_up(&mut self, aktion: &mut Aktion<RusqliteSql>, caller: &Caller, now: u64, page: u32) -> bool {
        loop {
            match aktion.catchup(caller, now, self.applied, page).expect("catch up") {
                Catchup::Resync { .. } => return false,
                Catchup::Entries { entries, next, more, .. } => {
                    self.apply_all(&entries);
                    self.applied = self.applied.max(next);
                    if !more {
                        return true;
                    }
                }
            }
        }
    }
}

/// What `caller` may see of the state in `dump`, worked out from `decide` directly: the second opinion on what the Akteur lets through.
pub fn oracle(dump: &Dump, caller: &Caller, now: u64) -> View {
    let resource = |g: &Gebiet| Resource::gebiet(&who::org(), &who::aktion(), &g.id, g.art, g.gruppe.as_ref());
    let allowed = |action, g: &Gebiet| decide(&caller.access, now, action, &resource(g)).is_allowed();
    let live: BTreeMap<&GebietId, &Gebiet> = dump.gebiete.iter().filter(|(_, deleted)| !deleted).map(|(g, _)| (&g.id, g)).collect();
    let any: BTreeMap<&GebietId, &Gebiet> = dump.gebiete.iter().map(|(g, _)| (&g.id, g)).collect();
    let enter = decide(&caller.access, now, Action::Enter, &Resource::aktion(&who::org(), &who::aktion())).is_allowed();
    if !enter {
        return View::default();
    }
    let mut view = View {
        gruppen: dump.gruppen.iter().filter(|(_, deleted)| !deleted).map(|(g, _)| g.clone()).collect(),
        gebiete: live.values().filter(|g| allowed(Action::Outline, g)).map(|g| (*g).clone()).collect(),
        marks: dump.marks.iter().filter(|(m, removed)| !removed && live.get(&m.gebiet).is_some_and(|g| allowed(Action::Read, g))).map(|(m, _)| m.clone()).collect(),
        notes: dump.notes.iter().filter(|n| !n.deleted && live.get(&n.gebiet).is_some_and(|g| allowed(Action::Read, g))).cloned().collect(),
        laeufe: dump.laeufe.iter().filter(|l| any.get(&l.gebiet).is_some_and(|g| allowed(Action::Read, g))).cloned().collect(),
    };
    view.gebiete.sort_by(|a, b| a.id.cmp(&b.id));
    view.gruppen.sort_by(|a, b| a.id.cmp(&b.id));
    view.laeufe.sort_by(|a, b| a.id.cmp(&b.id));
    view.marks.sort_by(|a, b| a.key.cmp(&b.key));
    view.notes.sort_by(|a, b| a.id.cmp(&b.id));
    view
}
