//! The sheet zone: the one open sheet, wired to the state. A sheet is built when it opens and dropped when it closes.
use super::{acts, state::AppState};
use crate::{
    features::{
        help::{help_role, HelpSheet},
        overview::{build::build, OverviewSheet},
        palette::PaletteSheet,
        settings::SettingsSheet,
        subject::{describe, GoneSheet, SubjectSheet},
    },
    model::Subject,
    platform::time::now_ms,
    shell::{Action, Panel},
    ui::{status::Kind, IconName, Sheet},
};
use flyermap_identity::Art;
use leptos::prelude::*;

fn subject_sheet(state: AppState, subject: Subject) -> AnyView {
    if matches!(subject, Subject::Haus(_) | Subject::Strasse(_)) {
        return super::object::sheet(state, subject);
    }
    let close = state.on(Action::Close);
    let s = state.session;
    let view = s.world.with_untracked(|w| s.rights.with_untracked(|r| describe(&subject, w, r, None, now_ms())));
    let art = s.world.with_untracked(|w| w.aktion.art);
    match view {
        Some(view) => {
            let on_act = Callback::new(move |act| acts::run(state, subject.clone(), act));
            view! { <SubjectSheet view=view art=art on_act=on_act on_close=close /> }.into_any()
        }
        None => view! { <GoneSheet on_close=close /> }.into_any(),
    }
}

fn overview(state: AppState) -> AnyView {
    let s = state.session;
    let data = Signal::derive(move || s.world.with(|w| s.progress.with(|p| build(w, p))));
    let kind = Signal::derive(move || if s.world.with(|w| w.aktion.art == Art::Abholen) { Kind::Collection } else { Kind::Distribution });
    let on_area = move |id: String| acts::open_subject(state, Subject::Gebiet(id));
    let on_sync = move |()| s.sync_now();
    view! { <OverviewSheet data=data theme=state.prefs.theme kind=kind on_area=on_area sync=s.sync on_sync=on_sync on_close=state.on(Action::Close) /> }
        .into_any()
}

pub fn panel_view(state: AppState, panel: Panel) -> AnyView {
    let close = state.on(Action::Close);
    let back = state.on(Action::Back);
    let soon = move |text: &'static str| state.on(Action::Notify(format!("„{text}“ kommt in einem der nächsten Schritte in die neue Oberfläche.")));
    match panel {
        Panel::Subject(subject) => subject_sheet(state, subject),
        Panel::Overview => overview(state),
        Panel::Settings => {
            view! { <SettingsSheet prefs=state.prefs on_palette=state.on(Action::Open(Panel::Palette)) on_diagnosis=soon("Diagnose") on_back=close on_close=close /> }
                .into_any()
        }
        Panel::Palette => view! { <PaletteSheet seed=state.prefs.seed theme=state.prefs.theme on_back=back on_close=close /> }.into_any(),
        Panel::Help => {
            let role = help_role(state.session.rights.with_untracked(|r| r.strongest()));
            view! { <HelpSheet role=role on_close=close /> }.into_any()
        }
        Panel::Studio => view! { <Sheet icon=IconName::Studio title="Studio" on_close=close>{super::studio::panel(state)}</Sheet> }.into_any(),
    }
}
