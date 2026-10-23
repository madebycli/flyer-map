//! The bar's search wired to the app: the index (`flyermap-search`) is kept in step with the world, the rights and the loaded map data; every keystroke asks it
//! in the situation of the person (where the map is, which Gebiet is under its middle, what was used lately); a picked result opens its sheet at the thing and
//! flies the map there, a picked command does its thing. Recents are kept per Aktion on this device.
use super::{acts, draw, state::AppState};
use crate::{
    drawing::Kind,
    features::search::{
        ask,
        commands::{entries as command_entries, spec_of_key},
        entries::{field_entries, nearest_piece, world_entries},
        recents, target, Avail, CommandId, Recents, SearchStore, Situation, Target,
    },
    model::Subject,
    platform::{storage::KeyValue, time::now_ms, LocalStore},
    shell::{Action, Layout, Panel, Tool},
    ui::{Hit, ResultGroup},
};
use flyermap_identity::Action as Right;
use leptos::{html, prelude::*};

/// What the bar needs from the app.
#[derive(Clone, Copy)]
pub struct SearchHost {
    pub query: RwSignal<String>,
    pub groups: Signal<Vec<ResultGroup>>,
    pub input: NodeRef<html::Input>,
    pub on_pick: Callback<Hit>,
}

impl SearchHost {
    /// Put the cursor in the field (the shortcut `/`).
    pub fn focus(&self) {
        if let Some(el) = self.input.get_untracked() {
            let _ = el.focus();
        }
    }
}

fn centre_of(state: AppState) -> Option<[f64; 2]> {
    state.session.map.get_untracked().and_then(|m| m.view().get(..2).map(|v| [v[0], v[1]]))
}

fn run_command(state: AppState, id: CommandId) {
    match id {
        CommandId::Mark => state.dispatch(Action::SetTool(Tool::Mark)),
        CommandId::NewGebiet => draw::start(state, Kind::Free, None, None),
        CommandId::Overview => state.open(Panel::Overview),
        CommandId::Studio => state.open(Panel::Studio),
        CommandId::Settings => state.open(Panel::Settings),
        CommandId::Help => state.open(Panel::Help),
        CommandId::Locate => acts::locate(state),
    }
}

/// Open what a picked result names and bring the map to it.
fn go(state: AppState, store: &SearchStore, target: Target) {
    let s = state.session;
    let loaded = s.loaded.get_untracked();
    match target {
        Target::Street { name } => {
            let Some(loaded) = loaded else { return };
            if let Some(piece) = nearest_piece(&store.street_pieces(&name), &loaded.field.index, centre_of(state)) {
                let subject = Subject::Strasse(piece);
                acts::fly_to(state, &subject);
                acts::open_subject(state, subject);
            }
        }
        Target::Subject(subject) => {
            acts::fly_to(state, &subject);
            acts::open_subject(state, subject);
        }
    }
}

pub fn install(state: AppState) -> SearchHost {
    let s = state.session;
    let query = RwSignal::new(String::new());
    let input = NodeRef::<html::Input>::new();
    let store: StoredValue<SearchStore, LocalStorage> = StoredValue::new_local(SearchStore::default());
    // bumped whenever the index changed, so the groups are asked again
    let version = RwSignal::new(0u64);
    let recent = RwSignal::new(Recents::default());

    // what the person looks for follows what they may see; commands follow what they may do
    Effect::new(move |_| {
        let layout = state.layout.get();
        let entries = s.world.with(|w| {
            s.rights.with(|r| {
                let avail = Avail { wide: layout == Layout::Wide, may_mark: r.may_mark_somewhere(&w.gebiete), may_draw: r.may_draw_somewhere(&w.gebiete) };
                let mut all = world_entries(w, r.can_aktion(Right::ManagePeople));
                all.extend(command_entries(avail));
                all
            })
        });
        if store.try_update_value(|st| st.set_world(entries)).unwrap_or(false) {
            version.update(|v| *v += 1);
        }
    });
    // streets and houses arrive with the map data
    Effect::new(move |_| {
        let Some(loaded) = s.loaded.get() else { return };
        store.update_value(|st| st.set_field(field_entries(&loaded.field.index, &loaded.field.area_of)));
        version.update(|v| *v += 1);
    });
    // recents of this Aktion: read once the Aktion is known, written when they change
    let aktion = Memo::new(move |_| s.world.with(|w| w.aktion.id.clone()));
    Effect::new(move |_| {
        let id = aktion.get();
        if !id.is_empty() {
            recent.set(Recents::from_text(LocalStore.read(&recents::key(&id)).as_deref()));
        }
    });

    let groups = Memo::new(move |_| {
        version.track();
        let text = query.get();
        let center = centre_of(state);
        let area = center.and_then(|c| s.world.with_untracked(|w| w.gebiet_at(c).map(|g| g.id.clone())));
        let with_people = s.rights.with_untracked(|r| r.can_aktion(Right::ManagePeople));
        let situation = Situation { center, area, recents: recent.get(), with_people };
        store.with_value(|st| ask(st.index(), &text, &situation))
    });

    let on_pick = Callback::new(move |hit: Hit| {
        if let Some(spec) = spec_of_key(&hit.id) {
            run_command(state, spec.id);
            return;
        }
        let Some(t) = target(&hit.id) else { return };
        recent.update(|r| r.push(&hit.id, now_ms()));
        let id = aktion.get_untracked();
        let _ = LocalStore.write(&recents::key(&id), &recent.with_untracked(Recents::to_text));
        store.with_value(|st| go(state, st, t));
    });
    SearchHost { query, groups: groups.into(), input, on_pick }
}
