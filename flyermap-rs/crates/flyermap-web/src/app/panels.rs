//! The sheet zone: the one open sheet, wired to the state. A sheet is built when it opens and dropped when it closes.
use super::{
    fake::area_name,
    routes::action_for,
    shell::{Action, Panel},
    state::AppState,
};
use crate::{
    features::{
        help::{HelpRole, HelpSheet},
        menu::{menu_groups, MenuContext, MenuSheet},
        overview::OverviewSheet,
        palette::PaletteSheet,
        settings::SettingsSheet,
        templates::TemplatesSheet,
    },
    ui::status::Kind,
};
use leptos::prelude::*;

const VERSION: &str = concat!("Rust-Vorschau ", env!("CARGO_PKG_VERSION"));

fn menu(state: AppState) -> impl IntoView {
    let kind = state.kind();
    let groups = Signal::derive(move || {
        menu_groups(MenuContext {
            admin: true,
            collection: kind.get() == Kind::Collection,
            rooms_on: true,
            may_mark: true,
            can_edit_any: true,
            may_create_pickups: true,
            active_runs: 1,
            notes: 3,
        })
    });
    let on_row = move |target| {
        let label = groups.with_untracked(|gs| gs.iter().flat_map(|g| &g.rows).find(|r| r.target == target).map(|r| r.label).unwrap_or_default());
        state.dispatch(action_for(target, label));
    };
    view! {
        <MenuSheet
            groups=groups
            identity="Admin"
            kind=Some(Signal::from(kind))
            on_kind=move |k| state.dispatch(Action::SetKind(k))
            on_row=on_row
            on_close=state.on(Action::Close)
            version=VERSION
        />
    }
}

fn overview(state: AppState) -> impl IntoView {
    let data = Signal::derive(move || state.world.with_value(|w| w.overview.clone()));
    let on_area = move |id: String| {
        state.dispatch(Action::Close);
        if let Some(name) = area_name(&id) {
            state.dispatch(Action::Notify(format!("{name}: die Karte zeigt das Gebiet, sobald sie in der neuen Oberfläche ist.")));
        }
    };
    view! { <OverviewSheet data=data theme=state.prefs.theme kind=state.kind() on_area=on_area on_close=state.on(Action::Close) /> }
}

pub fn panel_view(state: AppState, panel: Panel) -> AnyView {
    let close = state.on(Action::Close);
    let back = state.on(Action::Back);
    let soon = move |text: &'static str| state.on(Action::Notify(format!("„{text}“ kommt in einem der nächsten Schritte in die neue Oberfläche.")));
    match panel {
        Panel::Menu => menu(state).into_any(),
        Panel::Overview => overview(state).into_any(),
        Panel::Settings => view! {
            <SettingsSheet
                prefs=state.prefs
                on_palette=state.on(Action::Open(Panel::Palette))
                on_diagnosis=soon("Diagnose")
                on_back=back
                on_close=close
            />
        }
        .into_any(),
        Panel::Palette => view! { <PaletteSheet seed=state.prefs.seed theme=state.prefs.theme on_back=back on_close=close /> }.into_any(),
        Panel::Templates => view! {
            <TemplatesSheet can_load=true can_save=true on_load=soon("Vorlage laden") on_save=soon("Als Vorlage speichern") on_back=back on_close=close />
        }
        .into_any(),
        Panel::Help => view! { <HelpSheet role=HelpRole::Admin on_close=close /> }.into_any(),
    }
}
