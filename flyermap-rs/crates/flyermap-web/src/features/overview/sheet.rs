//! Übersicht (port of `OverviewSheet` in `src/v5/app/panels.tsx`): progress by houses overall, per status, per Gebiet and per Gruppe.
//! The sync box of the React sheet follows with the real sync (M5, store); the fake data is always saved.
use super::model::{de_number, deliverable, percent_of, OverviewData};
use crate::{
    platform::Theme,
    ui::{
        status::{self, Kind, ORDER},
        Hint, Icon, IconName, Progress, Sheet, SheetMeta,
    },
};
use leptos::prelude::*;

#[component]
pub fn OverviewSheet(
    #[prop(into)] data: Signal<OverviewData>,
    #[prop(into)] theme: Signal<Theme>,
    #[prop(into)] kind: Signal<Kind>,
    /// A tap on a Gebiet shows it on the map.
    #[prop(into)]
    on_area: Callback<String>,
    #[prop(into)] on_close: Callback<()>,
) -> impl IntoView {
    let percent = Memo::new(move |_| data.with(|d| percent_of(&d.overall)));
    let total = move || data.with(|d| de_number(d.overall.total_houses));
    let stats = move || {
        let (theme, kind) = (theme.get(), kind.get());
        data.with(|d| {
            ORDER
                .iter()
                .map(|s| {
                    let count = de_number(d.overall.houses_with(*s));
                    view! {
                        <div class="v5-stat" style:--c=status::color(theme, *s)>
                            <b>{count}</b>
                            <small>{status::label(kind, *s)}</small>
                        </div>
                    }
                })
                .collect_view()
        })
    };
    let wording = move || {
        format!("Der Fortschritt zählt Häuser. „{}“ wird von der Gesamtzahl abgezogen.", status::label(kind.get(), flyermap_core::Status::NotDeliverable))
    };
    let areas = move || {
        data.get()
            .areas
            .into_iter()
            .map(|a| {
                let p = percent_of(&a.snapshot);
                let counts =
                    format!("{} / {} · {p} %", de_number(a.snapshot.houses_with(flyermap_core::Status::Completed)), de_number(deliverable(&a.snapshot)));
                let label = format!("{}: {p} Prozent, zeigen", a.name);
                let id = a.id.clone();
                view! {
                    <button type="button" class="v5-areabar" aria-label=label on:click=move |_| on_area.run(id.clone())>
                        <div><b>{a.name}</b><span>{counts}</span></div>
                        <div class="v5-bar" style:--p=(p as f64 / 100.0).to_string()><i></i></div>
                    </button>
                }
            })
            .collect_view()
    };
    let teams = move || {
        data.get()
            .teams
            .into_iter()
            .map(|t| {
                let p = percent_of(&t.snapshot);
                view! {
                    <div class="v5-areabar" style="cursor: default">
                        <div><b><span class="v5-dotc" style:background=t.color></span>{t.name}</b><span>{format!("{p} %")}</span></div>
                        <div class="v5-bar" style:--p=(p as f64 / 100.0).to_string()><i></i></div>
                    </div>
                }
            })
            .collect_view()
    };
    let several_areas = move || data.with(|d| d.areas.len() > 1);
    let several_teams = move || data.with(|d| d.teams.len() > 1);
    view! {
        <Sheet icon=IconName::Chart title="Übersicht" on_close=on_close>
            <SheetMeta slot>
                <span><Icon name=IconName::House size=16 />{total}" Häuser"</span>
            </SheetMeta>
            <div class="v5-bignum" aria-label=move || format!("{} Prozent der Häuser", percent.get())>
                {move || percent.get()}<small>"%"</small>
            </div>
            <Progress value=Signal::derive(move || percent.get() as f64 / 100.0) label="Fortschritt nach Häusern" />
            <div class="v5-stats">{stats}</div>
            {move || view! { <Hint text=wording() /> }}
            <Show when=several_areas>
                <h3>"Gebiete"</h3>
                <div class="v5-list">{areas}</div>
            </Show>
            <Show when=several_teams>
                <h3>"Gruppen"</h3>
                <div class="v5-list">{teams}</div>
            </Show>
        </Sheet>
    }
}
