//! The frame of the ready app: the map and the zones over it. This file only arranges; every anchor is a feature that gets its data from the state.
use super::{
    acts::{self, open_subject},
    panels::panel_view,
    state::AppState,
    zones::{Zone, ZoneId},
};
use crate::{
    features::{
        live::{chips, LiveStrip},
        map_stub::MapStub,
        mode::ModeButton,
        overview::build::pill,
        quick::QuickBar,
        search::{command, find, CommandId},
    },
    model::Subject,
    shell::{nav::ui_state, Action, Layout, Panel, Tool},
    ui::{CommandBar, Hit, HitKind, IconName, StatusPill, Toast},
};
use leptos::prelude::*;
use std::time::Duration;

/// A note stays this long unless dismissed.
const NOTICE_FOR: Duration = Duration::from_secs(9);

fn subject_of(hit: &Hit) -> Option<Subject> {
    match hit.kind {
        HitKind::Gebiet => Some(Subject::Gebiet(hit.id.clone())),
        HitKind::Gruppe => Some(Subject::Gruppe(hit.id.clone())),
        HitKind::Lauf => Some(Subject::Lauf(hit.id.clone())),
        HitKind::Person => Some(Subject::Person(hit.id.clone())),
        HitKind::Street | HitKind::House | HitKind::Command => None,
    }
}

#[component]
pub fn Frame(state: AppState) -> impl IntoView {
    let s = state.session;
    let panel = state.panel();
    let tool = state.tool();
    let notice = Memo::new(move |_| state.shell.with(|sh| sh.notice.clone()));
    // every new note gets its own timer; an older timer cannot remove a newer note (see `Shell::reduce`)
    Effect::new(move |_| {
        if let Some(id) = notice.with(|n| n.as_ref().map(|n| n.id)) {
            set_timeout(move || state.dispatch(Action::Dismiss(id)), NOTICE_FOR);
        }
    });

    let live = Memo::new(move |_| s.world.with(chips));
    let gebiete = Signal::derive(move || s.world.with(|w| w.gebiete.clone()));
    let aktion_name = Signal::derive(move || s.world.with(|w| w.aktion.name.clone()));
    let pill_state = Signal::derive(move || {
        let view_only = s.world.with(|w| s.rights.with(|r| !r.may_mark_somewhere(&w.gebiete)));
        s.progress.with(|p| s.world.with(|w| pill(&crate::features::overview::build::build(w, p).overall, view_only)))
    });
    let may_mark = Signal::derive(move || s.world.with(|w| s.rights.with(|r| r.may_mark_somewhere(&w.gebiete))));
    let search = Callback::new(move |query: String| {
        let wide = state.layout.get_untracked() == Layout::Wide;
        s.world.with(|w| find(w, &query, wide))
    });
    let on_pick = move |hit: Hit| {
        if hit.kind == HitKind::Command {
            match command(&hit.id).map(|c| c.id) {
                Some(CommandId::Overview) => state.open(Panel::Overview),
                Some(CommandId::Settings) => state.open(Panel::Settings),
                Some(CommandId::Help) => state.open(Panel::Help),
                Some(CommandId::Studio) => state.open(Panel::Studio),
                None => {}
            }
        } else if let Some(subject) = subject_of(&hit) {
            open_subject(state, subject);
        }
    };
    let close_sheet_on_focus = move |()| {
        if panel.get_untracked().is_some() {
            state.dispatch(Action::Close);
        }
    };
    let on_follow = move |id: String| {
        let now = state.following.get_untracked();
        if now.as_deref() == Some(id.as_str()) {
            state.following.set(None);
        } else {
            state.following.set(Some(id.clone()));
            open_subject(state, Subject::Lauf(id));
        }
    };
    let mode_label = Signal::derive(move || if tool.get() == Tool::Mark { "Markieren beenden".to_string() } else { "Markieren".to_string() });
    let on_mode = move |()| {
        let next = if tool.get_untracked() == Tool::Mark { Tool::Idle } else { Tool::Mark };
        state.dispatch(Action::SetTool(next));
    };

    view! {
        <div
            class="v5-root fm-app"
            data-ui=move || ui_state(true, panel.get().as_ref(), tool.get())
            data-layout=move || state.layout.get().as_str()
            data-hand=move || state.prefs.hand.get().as_str()
        >
            <Show when=move || state.layout.get() == Layout::Wide>
                <aside class="fm-studio" aria-label="Studio">
                    <header><h2>"Studio"</h2></header>
                </aside>
            </Show>
            <div class="fm-stage">
                <MapStub gebiete=gebiete on_pick=move |id| acts::open_subject(state, Subject::Gebiet(id)) />
                <Zone zone=ZoneId::Top>
                    <CommandBar search=search on_pick=on_pick on_focus=close_sheet_on_focus>
                        <StatusPill campaign=aktion_name state=pill_state on_click=state.on(Action::Open(Panel::Overview)) />
                    </CommandBar>
                    <LiveStrip chips=live following=state.following on_pick=on_follow />
                </Zone>
                <Zone zone=ZoneId::Notice>
                    {move || notice.get().map(|n| view! { <Toast text=n.text on_dismiss=state.on(Action::Dismiss(n.id)) icon=IconName::Info /> })}
                </Zone>
                <Zone zone=ZoneId::Panel>
                    <Show when=move || tool.get() == Tool::Mark>
                        <section class="fm-panel" aria-label="Markieren">
                            <p class="v5-hint">"Das Markier-Panel kommt im nächsten Schritt."</p>
                        </section>
                    </Show>
                </Zone>
                <Zone zone=ZoneId::Bottom>
                    <QuickBar
                        prefs=state.prefs
                        sync=s.sync
                        on_locate=move |()| state.notify("Der Standort kommt mit der Karte.")
                        on_sync=move |()| state.notify(s.sync.with(|v| v.headline()))
                        on_note=move |text| state.notify(text)
                    />
                    <ModeButton icon=IconName::Route active=Signal::derive(move || tool.get() == Tool::Mark) label=mode_label available=may_mark on_click=on_mode />
                </Zone>
                <Zone zone=ZoneId::Sheet>{move || panel.get().map(|p| panel_view(state, p))}</Zone>
                <Zone zone=ZoneId::Overlay />
            </div>
        </div>
    }
}
