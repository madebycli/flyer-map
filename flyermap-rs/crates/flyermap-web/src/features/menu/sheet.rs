//! Menü (port of `HomeSheet` in `src/v5/app/panels.tsx`): a few titled groups of rows; admins switch between handing out and collecting here.
use super::rows::{MenuGroup, MenuTarget};
use crate::ui::{status::Kind, Icon, IconName, ListGroup, ListRow, SegOption, Segmented, Sheet, SheetMeta};
use leptos::prelude::*;

#[component]
pub fn MenuSheet(
    #[prop(into)] groups: Signal<Vec<MenuGroup>>,
    /// Who is here ("Admin", a Gruppe).
    #[prop(into)]
    identity: String,
    /// Admins only: the mode switch.
    #[prop(into)]
    kind: Option<Signal<Kind>>,
    #[prop(into)] on_kind: Callback<Kind>,
    #[prop(into)] on_row: Callback<MenuTarget>,
    #[prop(into)] on_close: Callback<()>,
    /// The version line at the end.
    version: &'static str,
) -> impl IntoView {
    let mode = kind.map(|value| {
        let options = vec![SegOption::new(Kind::Distribution, "Austeilen", IconName::Mailbox), SegOption::new(Kind::Collection, "Abholen", IconName::Paw)];
        view! { <Segmented label="Modus" value=value options=options on_change=on_kind /> }
    });
    let groups = move || {
        groups
            .get()
            .into_iter()
            .map(|g| {
                let rows = g
                    .rows
                    .into_iter()
                    .map(|r| {
                        let target = r.target;
                        let badge = r.badge.map(|b| b.to_string());
                        view! { <ListRow icon=r.icon label=r.label hint=r.hint badge=badge on_click=move |_| on_row.run(target) /> }
                    })
                    .collect_view();
                view! { <ListGroup title=g.title>{rows}</ListGroup> }
            })
            .collect_view()
    };
    view! {
        <Sheet icon=IconName::Menu title="Menü" on_close=on_close>
            <SheetMeta slot>
                <span><Icon name=IconName::Users size=16 />{identity}</span>
            </SheetMeta>
            {mode}
            {groups}
            <p class="v5-hint">"Kartendaten © OpenStreetMap-Mitwirkende · OpenMapTiles · OpenFreeMap"</p>
            <p class="v5-hint v5-version" aria-label=format!("App-Version {version}")>{version}</p>
        </Sheet>
    }
}

/// The note for a row whose screen is not in the Rust app yet.
pub fn not_yet_text(label: &str) -> String {
    format!("„{label}“ kommt in einem der nächsten Schritte in die neue Oberfläche.")
}
