//! The status at the right end of the bar: the cloud (is everything saved?) and the progress in percent. It opens the overview. `data-done` and
//! `data-total` carry the house counts for the browser flows (`scripts/v5-e2e`).
use crate::ui::icon::{Icon, IconName};
use leptos::prelude::*;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SyncDot {
    #[default]
    Ok,
    Busy,
    Offline,
}

impl SyncDot {
    pub fn class(self) -> &'static str {
        match self {
            SyncDot::Ok => "v5-dot ok",
            SyncDot::Busy => "v5-dot busy",
            SyncDot::Offline => "v5-dot offline",
        }
    }

    pub fn icon(self) -> IconName {
        match self {
            SyncDot::Ok => IconName::CloudOk,
            SyncDot::Busy => IconName::Sync,
            SyncDot::Offline => IconName::CloudOff,
        }
    }

    /// The sentence of the tooltip and of the dot's name (as in `App.tsx`).
    pub fn title(self, pending: u32) -> String {
        match self {
            SyncDot::Ok => "Alles gespeichert".into(),
            SyncDot::Busy => format!("{pending} Änderungen werden gesendet"),
            SyncDot::Offline => format!("Offline – {pending} Änderungen warten"),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PillState {
    pub done: i64,
    pub total: i64,
    pub percent: i64,
    pub sync: SyncDot,
    pub pending: u32,
    /// Only looking, no marking: an eye after the number.
    pub view_only: bool,
}

#[component]
pub fn StatusPill(
    /// The name of the Aktion, read before the percentage.
    campaign: &'static str,
    #[prop(into)] state: Signal<PillState>,
    #[prop(into)] on_click: Callback<()>,
) -> impl IntoView {
    let title = Memo::new(move |_| state.with(|s| s.sync.title(s.pending)));
    view! {
        <button
            type="button"
            class="v5-pill"
            role="status"
            aria-label=move || format!("{campaign}: {} Prozent – Übersicht öffnen", state.with(|s| s.percent))
            data-done=move || state.with(|s| s.done)
            data-total=move || state.with(|s| s.total)
            title=move || title.get()
            on:click=move |_| on_click.run(())
        >
            <span class=move || state.with(|s| s.sync.class()) aria-label=move || title.get()>
                <Icon name=Signal::derive(move || state.with(|s| s.sync.icon())) size=20 />
            </span>
            <strong class="v5-percent">{move || state.with(|s| s.percent)}<small>"%"</small></strong>
            <Show when=move || state.with(|s| s.view_only)>
                <Icon name=IconName::Eye size=18 class="v5-viewonly" />
            </Show>
        </button>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_dot_says_what_the_react_pill_says() {
        assert_eq!(SyncDot::Ok.title(0), "Alles gespeichert");
        assert_eq!(SyncDot::Busy.title(3), "3 Änderungen werden gesendet");
        assert_eq!(SyncDot::Offline.title(2), "Offline – 2 Änderungen warten");
        assert_eq!(SyncDot::Offline.icon(), IconName::CloudOff);
    }
}
