//! The quick bar: the few switches a person wants *while working*: where am I, which map, which hand, buzz and tone, is everything saved.
//! One row of 44 px buttons on the side away from the thumb; each one flips or cycles at a tap and says what it did in a short note.
//! Everything else about the app is at the thing it concerns, not here.
use crate::{
    features::settings::Prefs,
    platform::Hand,
    sync::SyncView,
    ui::{Icon, IconName, SyncDot},
};
use leptos::prelude::*;

/// One round button of the bar.
#[component]
fn QuickButton(
    /// The accessible name (also the tooltip): says what the button is *now*.
    #[prop(into)]
    label: Signal<String>,
    #[prop(into)] icon: Signal<IconName>,
    /// Pressed or active look.
    #[prop(optional, into)]
    on: Signal<bool>,
    #[prop(optional, into)] extra_class: Signal<&'static str>,
    #[prop(optional, into)] badge: Signal<u32>,
    #[prop(into)] on_click: Callback<()>,
    /// The id the browser flows look the button up by.
    id: &'static str,
) -> impl IntoView {
    view! {
        <button
            type="button"
            class=move || format!("fm-qbtn {}", extra_class.get())
            data-quick=id
            aria-label=move || label.get()
            title=move || label.get()
            aria-pressed=move || on.get().to_string()
            on:click=move |_| on_click.run(())
        >
            <Icon name=icon size=22 />
            <Show when=move || badge.get() > 0>
                <em class="fm-qbadge" aria-hidden="true">{move || badge.get().min(99)}</em>
            </Show>
        </button>
    }
}

fn hand_word(hand: Hand) -> &'static str {
    match hand {
        Hand::Right => "rechts",
        Hand::Left => "links",
    }
}

#[component]
pub fn QuickBar(
    prefs: Prefs,
    #[prop(into)] sync: Signal<SyncView>,
    #[prop(into)] on_locate: Callback<()>,
    #[prop(into)] on_sync: Callback<()>,
    /// A short note after a switch ("Bedienhand: links").
    #[prop(into)]
    on_note: Callback<String>,
) -> impl IntoView {
    let dot = Memo::new(move |_| sync.with(SyncView::dot));
    let sync_label = Memo::new(move |_| sync.with(SyncView::headline));
    let feedback_icon = move || if prefs.sound.get() && !prefs.haptics.get() { IconName::Speaker } else { IconName::Vibrate };
    let feedback_label = move || format!("Rückmeldung: {}", prefs.feedback().label());
    view! {
        <div class="fm-quick" role="toolbar" aria-label="Schnellleiste">
            <QuickButton id="locate" label="Standort" icon=IconName::Locate on_click=on_locate />
            <QuickButton
                id="base"
                label=Signal::derive(move || if prefs.base_on.get() { "Karte: Straßenkarte".to_string() } else { "Karte: nur Gebiete".to_string() })
                icon=IconName::Layers
                on=prefs.base_on
                on_click=move |()| {
                    let on = !prefs.base_on.get_untracked();
                    prefs.base_on.set(on);
                    on_note.run(if on { "Karte: Straßenkarte".into() } else { "Karte: nur Gebiete".into() });
                }
            />
            <QuickButton
                id="hand"
                label=Signal::derive(move || format!("Bedienhand: {}", hand_word(prefs.hand.get())))
                icon=IconName::Hand
                extra_class=Signal::derive(move || if prefs.hand.get() == Hand::Left { "mirror" } else { "" })
                on_click=move |()| {
                    let next = if prefs.hand.get_untracked() == Hand::Right { Hand::Left } else { Hand::Right };
                    prefs.hand.set(next);
                    on_note.run(format!("Bedienhand: {}", hand_word(next)));
                }
            />
            <QuickButton
                id="feedback"
                label=Signal::derive(feedback_label)
                icon=Signal::derive(feedback_icon)
                on=Signal::derive(move || prefs.feedback() != crate::platform::Feedback::Off)
                on_click=move |()| {
                    let next = prefs.feedback().next();
                    prefs.set_feedback(next);
                    on_note.run(format!("Rückmeldung: {}", next.label()));
                    // the first tone must happen inside this tap: browsers allow audio only after a gesture
                    prefs.confirm();
                }
            />
            <QuickButton
                id="sync"
                label=Signal::derive(move || sync_label.get())
                icon=Signal::derive(move || dot.get().icon())
                extra_class=Signal::derive(move || match dot.get() {
                    SyncDot::Ok => "sync ok",
                    SyncDot::Busy => "sync busy",
                    SyncDot::Offline => "sync offline",
                })
                badge=Signal::derive(move || sync.with(|s| u32::try_from(s.pending).unwrap_or(u32::MAX)))
                on_click=on_sync
            />
        </div>
    }
}
