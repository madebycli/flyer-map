//! Who may be told about an entry. The log holds everything; each device is shown only what its caller may see, decided by `decide` and by nothing
//! else: marks, notes and Läufe of a Gebiet need the right to read it, the outline of a Gebiet and who took it over need the right to see its outline,
//! Gruppen need the right to be in the Aktion.
//!
//! An [`Audience`] carries the world and Gruppe of the Gebiete an entry list is about, taken from the store once, so that the host can ask for any number
//! of subscribers without touching the store again.
use crate::{caller::Caller, queries::areas::Facts};
use flyermap_identity::{decide, Action, AktionId, OrgId, Resource};
use flyermap_protocol::{Change, Entry, GebietId};
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct Audience {
    org: OrgId,
    aktion: AktionId,
    facts: HashMap<GebietId, Facts>,
}

impl Audience {
    pub(crate) fn new(org: &OrgId, aktion: &AktionId, facts: Vec<Facts>) -> Audience {
        Audience { org: org.clone(), aktion: aktion.clone(), facts: facts.into_iter().map(|f| (f.id.clone(), f)).collect() }
    }

    /// May this caller be shown this entry, at time `now` (ms)?
    pub fn sees(&self, caller: &Caller, now: u64, entry: &Entry) -> bool {
        let (action, resource) = match &entry.change {
            Change::GruppeSet { .. } | Change::GruppeRemoved { .. } => (Action::Enter, Resource::aktion(&self.org, &self.aktion)),
            change => {
                let Some(facts) = change.gebiet().and_then(|id| self.facts.get(id)) else { return false };
                let resource = Resource::gebiet(&self.org, &self.aktion, &facts.id, facts.art, facts.gruppe.as_ref());
                let action = match change {
                    Change::GebietSet { .. } | Change::GebietRemoved { .. } | Change::Collected { .. } | Change::Released { .. } => Action::Outline,
                    _ => Action::Read,
                };
                (action, resource)
            }
        };
        decide(&caller.access, now, action, &resource).is_allowed()
    }

    /// The entries of `entries` this caller may see.
    pub fn filter(&self, caller: &Caller, now: u64, entries: &[Entry]) -> Vec<Entry> {
        entries.iter().filter(|e| self.sees(caller, now, e)).cloned().collect()
    }
}
