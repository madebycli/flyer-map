//! The store of this device and its sync, wired to the loaded field: what was saved on the device is restored (queued edits survive a restart), edits
//! of keys that no longer exist are dropped, the engine's tiles are cut with the known statuses, changes (from this device or from the server) move the
//! progress counters and are painted on the map at once, and a round of sync is asked for. Marking goes through [`Session::mark`].
use super::{core::Session, field::Loaded, progress::Tracker};
use crate::{
    field::Field,
    platform::{settings::actor_id, time::now_ms, LocalStore},
    sync::{persist, triggers, SyncHost},
};
use flyermap_core::{Changes, Key, Op, Status, Store};
use flyermap_identity::Action;
use leptos::{prelude::*, task::spawn_local};
use std::{cell::RefCell, rc::Rc};

/// What a marking did: how many keys changed, and what they were before (for the undo).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Applied {
    pub ops: Vec<Op>,
    pub before: Vec<(Key, Status)>,
}

impl Applied {
    pub fn count(&self) -> usize {
        self.ops.len()
    }
}

/// The keys of `wanted` that are in a Gebiet the person may mark in (the server judges again; the screen never offers what it would refuse).
pub fn markable(keys: &[Key], area_of: &dyn Fn(&Key) -> Option<String>, may: &dyn Fn(&str) -> bool) -> Vec<Key> {
    keys.iter().filter(|k| area_of(k).is_some_and(|g| may(&g))).cloned().collect()
}

impl Session {
    /// Open the store of the Aktion for the loaded field and start syncing. Returns what the screens need.
    pub(super) async fn open_store(&self, field: Field) -> Loaded {
        let me = *self;
        let campaign = me.world.with_untracked(|w| w.aktion.id.clone());
        let actor = actor_id(&LocalStore);
        let mut store = match persist::load(&campaign).await {
            Some(saved) => Store::restore(actor, &saved),
            None => Store::new(actor),
        };
        let known = |key: &Key| match key.kind() {
            Some(flyermap_core::EntityKind::House) => field.index.houses.contains_key(key.id()),
            Some(flyermap_core::EntityKind::Segment) => field.index.segments.contains_key(key.id()),
            None => false,
        };
        let dropped = store.reconcile_pending(&known, &|k| field.area_of.get(k).cloned());
        if dropped > 0 {
            flyermap_diag::breadcrumb("store.dropped", Some(dropped as i64));
        }
        let statuses: Vec<(Key, Status)> = store.entries().filter(|(k, _)| known(k)).map(|(k, e)| (k.clone(), e.status)).collect();
        let tracker = Rc::new(RefCell::new(Tracker::new(&field.houses, &field.segments, &field.area_of, statuses.iter().cloned())));
        me.progress.set(tracker.borrow().snapshots());
        // the tiles the engine cuts from now on carry what is known
        let engine = Rc::clone(&field.engine);
        let _ = engine.set_status(&statuses).await;

        let store = Rc::new(RefCell::new(store));
        let on_changes = {
            let (tracker, engine) = (Rc::clone(&tracker), Rc::clone(&engine));
            move |changes: Changes| {
                let list: Vec<(Key, Status)> = changes.iter().map(|(k, s)| (k.clone(), *s)).collect();
                tracker.borrow_mut().apply(&changes);
                me.progress.set(tracker.borrow().snapshots());
                me.changed.update(|n| *n += 1);
                if let Some(map) = me.map.get_untracked() {
                    map.paint(&list);
                }
                let engine = Rc::clone(&engine);
                spawn_local(async move {
                    let _ = engine.set_status(&list).await;
                });
            }
        };
        let host = SyncHost::new(&campaign, me.backend(), store, move |view| me.sync.set(view), on_changes);
        let triggers = triggers::install(&host);
        host.kick();
        Loaded { field: Rc::new(field), tracker, host, _triggers: triggers }
    }

    /// Set `status` on `keys` (those the person may mark): the store takes it, the map paints it, the queue and the sync follow. Zero changes: nothing happened.
    pub fn mark(&self, keys: &[Key], status: Status) -> Applied {
        let Some(loaded) = self.loaded.get_untracked() else { return Applied::default() };
        let allowed = self.world.with_untracked(|w| {
            self.rights.with_untracked(|r| {
                let may = |gebiet: &str| w.gebiet(gebiet).is_some_and(|g| r.can_gebiet(Action::Mark, g));
                markable(keys, &|k| loaded.field.area_of.get(k).cloned(), &may)
            })
        });
        if allowed.is_empty() {
            return Applied::default();
        }
        let store = loaded.host.store();
        let before: Vec<(Key, Status)> = allowed.iter().map(|k| (k.clone(), store.borrow().status_of(k))).collect();
        let ops = store.borrow_mut().set(&allowed, status, now_ms(), &|k| loaded.field.area_of.get(k).cloned());
        let changed: std::collections::HashSet<&Key> = ops.iter().map(|o| &o.key).collect();
        let before = before.into_iter().filter(|(k, _)| changed.contains(k)).collect();
        loaded.host.local_edit();
        Applied { ops, before }
    }

    /// Put back what a marking replaced.
    pub fn undo(&self, applied: &Applied) {
        for status in Status::ALL {
            let keys: Vec<Key> = applied.before.iter().filter(|(_, s)| *s == status).map(|(k, _)| k.clone()).collect();
            if !keys.is_empty() {
                self.mark(&keys, status);
            }
        }
    }

    /// Ask for a round of sync now (the quick bar's button).
    pub fn sync_now(&self) {
        if let Some(loaded) = self.loaded.get_untracked() {
            loaded.host.kick();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn only_keys_in_writable_gebiete_are_marked() {
        let area_of: HashMap<Key, String> = HashMap::from([(Key::house("1"), "mine".into()), (Key::house("2"), "other".into())]);
        let keys = [Key::house("1"), Key::house("2"), Key::house("3")];
        let got = markable(&keys, &|k| area_of.get(k).cloned(), &|g| g == "mine");
        assert_eq!(got, [Key::house("1")], "a key of another Gebiet and a key without a Gebiet are left out");
    }
}
