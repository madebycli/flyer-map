//! The sheet of a thing: a Gebiet, a street, a person, a Lauf. A title with the thing's colour, a few facts, and *its* actions as big
//! buttons: no list of everything, only what the person may do with this. Content that belongs to the kind (a status choice for a house)
//! goes in as children between the facts and the actions.
use super::view::{act_label, SubjectView};
use crate::{
    model::Act,
    ui::{Icon, IconName, Sheet, SheetMeta},
};
use flyermap_identity::Art;
use leptos::prelude::*;

/// The actions that have a place of their own in the sheet instead of a button (the status choice).
fn is_button(act: Act) -> bool {
    !matches!(act, Act::SetStatus | Act::WholeStreet)
}

#[component]
pub fn SubjectSheet(
    view: SubjectView,
    art: Art,
    #[prop(into)] on_act: Callback<Act>,
    #[prop(into)] on_close: Callback<()>,
    #[prop(optional)] children: Option<Children>,
) -> impl IntoView {
    let SubjectView { icon, title, facts, acts, color } = view;
    let acts: Vec<Act> = acts.into_iter().filter(|a| is_button(*a)).collect();
    let buttons = (!acts.is_empty()).then(|| {
        let list = acts
            .into_iter()
            .map(|act| {
                let (label, icon) = act_label(act, art);
                view! {
                    <button type="button" class="fm-act" data-act=format!("{act:?}") on:click=move |_| on_act.run(act)>
                        <Icon name=icon size=24 />
                        <span>{label}</span>
                    </button>
                }
            })
            .collect_view();
        view! { <div class="fm-acts">{list}</div> }
    });
    let facts_view = facts.into_iter().map(|f| view! { <span>{f}</span> }).collect_view();
    view! {
        <Sheet icon=icon title=title on_close=on_close>
            <SheetMeta slot>{facts_view}</SheetMeta>
            {color.map(|c| view! { <i class="fm-subject-color" style:background=c aria-hidden="true"></i> })}
            {children.map(|c| c())}
            {buttons}
        </Sheet>
    }
}

/// What the sheet says of a thing that is gone (a Lauf that ended while the sheet was open).
#[component]
pub fn GoneSheet(#[prop(into)] on_close: Callback<()>) -> impl IntoView {
    view! {
        <Sheet icon=IconName::Info title="Gibt es nicht mehr" on_close=on_close>
            <p class="v5-hint"><Icon name=IconName::Info size=20 />"Das wurde inzwischen beendet oder entfernt."</p>
        </Sheet>
    }
}
