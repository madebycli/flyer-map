//! The frame of the ready app: the map and the zones over it. This file only arranges; every anchor is a feature that gets its data from the state.
use super::{
    acts::{locate, open_subject},
    marking,
    panels::panel_view,
    search, shortcuts,
    state::AppState,
    studio,
    zones::{Zone, ZoneId},
};
use crate::{
    features::{
        live::{chips, LiveStrip},
        map::{FieldStatus, MapView},
        mode::{icon_of, MarkPanel, ModeButton},
        overview::build::pill,
        quick::QuickBar,
    },
    marking::MarkAction,
    model::Subject,
    shell::{nav::ui_state, Action, Layout, Panel, Tool},
    ui::{status::Kind, CommandBar, IconName, StatusPill, Toast},
};
use leptos::prelude::*;
use std::time::Duration;

/// A note stays this long unless dismissed.
const NOTICE_FOR: Duration = Duration::from_secs(9);

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
    let on_locate = move |()| locate(state);
    let aktion_name = Signal::derive(move || s.world.with(|w| w.aktion.name.clone()));
    let pill_state = Signal::derive(move || {
        let view_only = s.world.with(|w| s.rights.with(|r| !r.may_mark_somewhere(&w.gebiete)));
        s.progress.with(|p| s.world.with(|w| pill(&crate::features::overview::build::build(w, p).overall, view_only)))
    });
    let may_mark = Signal::derive(move || s.world.with(|w| s.rights.with(|r| r.may_mark_somewhere(&w.gebiete))));
    let find = search::install(state);
    shortcuts::install(state, find);
    studio::watch(state);
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
    marking::install(state);
    let mark_model = marking::panel_model(state);
    let kind = Signal::derive(move || if s.world.with(|w| w.aktion.art == flyermap_identity::Art::Abholen) { Kind::Collection } else { Kind::Distribution });
    let mode_icon = Signal::derive(move || icon_of(state.mark.with(|m| m.mode)));
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
                    {studio::panel(state)}
                </aside>
            </Show>
            <div class="fm-stage">
                <MapView state=state />
                <Zone zone=ZoneId::Top>
                    <CommandBar query=find.query groups=find.groups on_pick=find.on_pick on_focus=close_sheet_on_focus input=find.input>
                        <StatusPill campaign=aktion_name state=pill_state on_click=state.on(Action::Open(Panel::Overview)) />
                    </CommandBar>
                    <LiveStrip chips=live following=state.following on_pick=on_follow />
                    <FieldStatus state=s.field_state on_retry=move |()| s.load_field() />
                </Zone>
                <Zone zone=ZoneId::Notice>
                    {move || notice.get().map(|n| view! { <Toast text=n.text on_dismiss=state.on(Action::Dismiss(n.id)) icon=IconName::Info /> })}
                </Zone>
                <Zone zone=ZoneId::Panel>
                    <Show when=move || tool.get() == Tool::Mark>
                        <MarkPanel
                            model=mark_model
                            kind=kind
                            theme=state.prefs.theme
                            on_mode=move |m| state.mark.update(|x| x.reduce(MarkAction::SetMode(m)))
                            on_status=move |st| state.mark.update(|x| x.reduce(MarkAction::SetStatus(st)))
                            on_size=move |z| state.mark.update(|x| x.reduce(MarkAction::SetSize(z)))
                            on_houses=move |()| state.mark.update(|x| x.reduce(MarkAction::ToggleHouses))
                            on_houses_only=move |()| state.mark.update(|x| x.reduce(MarkAction::ToggleHousesOnly))
                            on_undo=move |()| marking::undo(state)
                            on_confirm=move |()| marking::confirm(state)
                        />
                    </Show>
                </Zone>
                <Zone zone=ZoneId::Bottom>
                    <QuickBar
                        prefs=state.prefs
                        sync=s.sync
                        on_locate=on_locate
                        on_sync=move |()| {
                            s.sync_now();
                            state.notify(s.sync.with(|v| v.headline()));
                        }
                        on_note=move |text| state.notify(text)
                    />
                    <ModeButton icon=mode_icon active=Signal::derive(move || tool.get() == Tool::Mark) label=mode_label available=may_mark on_click=on_mode />
                </Zone>
                <Zone zone=ZoneId::Sheet>{move || panel.get().map(|p| panel_view(state, p))}</Zone>
                <Zone zone=ZoneId::Overlay />
            </div>
        </div>
    }
}
