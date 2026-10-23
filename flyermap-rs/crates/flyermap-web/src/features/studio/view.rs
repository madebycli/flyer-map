//! The Studio: a row of tabs and the list of the chosen tab. The same panel is the column next to the map (from 900 px) and, on a phone, the content of a sheet;
//! the rows open the sheet of the thing, so a row in the Studio and a tap on the map end up in the same place. Left and Right move between the tabs.
use super::model::{label, Row};
use crate::{
    shell::StudioTab,
    ui::{Icon, IconName},
};
use leptos::{ev, prelude::*};

fn row_view(row: Row, on_open: Callback<crate::model::Subject>) -> impl IntoView {
    let Row { subject, icon, title, detail, badge, color } = row;
    let label = title.clone();
    view! {
        <button type="button" class="fm-srow" aria-label=label data-subject=format!("{subject:?}") on:click=move |_| on_open.run(subject.clone())>
            <span class="fm-srow-ico" style:--c=color.unwrap_or_default()><Icon name=icon size=22 /></span>
            <span class="v5-row-text"><b>{title}</b><small>{detail}</small></span>
            {badge.map(|b| view! { <em class="v5-row-badge">{b}</em> })}
            <Icon name=IconName::Chevron size=20 class="v5-row-chev" />
        </button>
    }
}

#[component]
pub fn StudioPanel(
    #[prop(into)] tab: Signal<StudioTab>,
    #[prop(into)] tabs: Signal<Vec<StudioTab>>,
    /// How many rows each tab has (shown beside its name).
    #[prop(into)]
    counts: Signal<Vec<(StudioTab, usize)>>,
    #[prop(into)] rows: Signal<Vec<Row>>,
    #[prop(into)] empty: Signal<&'static str>,
    #[prop(into)] on_tab: Callback<StudioTab>,
    #[prop(into)] on_open: Callback<crate::model::Subject>,
    /// Whether the person may draw a Gebiet (then the Gebiete tab offers it).
    #[prop(into)]
    can_draw: Signal<bool>,
    #[prop(into)] on_draw: Callback<()>,
) -> impl IntoView {
    let on_key = move |e: ev::KeyboardEvent| {
        let step: isize = match e.key().as_str() {
            "ArrowRight" => 1,
            "ArrowLeft" => -1,
            _ => return,
        };
        let list = tabs.get_untracked();
        if let Some(at) = list.iter().position(|t| *t == tab.get_untracked()) {
            let next = (at as isize + step).rem_euclid(list.len() as isize) as usize;
            e.prevent_default();
            on_tab.run(list[next]);
        }
    };
    let count_of = move |t: StudioTab| counts.with(|c| c.iter().find(|(x, _)| *x == t).map(|(_, n)| *n));
    view! {
        <div class="fm-studio-body">
            <div class="fm-tabs" role="tablist" aria-label="Studio" on:keydown=on_key>
                <For each=move || tabs.get() key=|t| *t let:t>
                    <button
                        type="button"
                        role="tab"
                        class="fm-tab"
                        data-tab=t.as_str()
                        aria-selected=move || (tab.get() == t).to_string()
                        tabindex=move || if tab.get() == t { "0" } else { "-1" }
                        on:click=move |_| on_tab.run(t)
                    >
                        {label(t)}
                        {move || count_of(t).filter(|n| *n > 0).map(|n| view! { <em>{n}</em> })}
                    </button>
                </For>
            </div>
            <div class="fm-slist" role="tabpanel" aria-label=move || label(tab.get())>
                <Show when=move || can_draw.get() && tab.get() == StudioTab::Gebiete>
                    <button type="button" class="fm-snew" data-act="NewGebiet" on:click=move |_| on_draw.run(())>
                        <Icon name=IconName::Plus size=22 />
                        <span>"Neues Gebiet zeichnen"</span>
                    </button>
                </Show>
                {move || {
                    let list = rows.get();
                    if list.is_empty() {
                        view! { <p class="v5-hint"><Icon name=IconName::Info size=20 />{empty.get()}</p> }.into_any()
                    } else {
                        list.into_iter().map(|r| row_view(r, on_open)).collect_view().into_any()
                    }
                }}
            </div>
        </div>
    }
}
