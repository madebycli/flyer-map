//! The marking panel: one layout for every mode. Six places that never move: *mode* (four tiles), *status* (four tiles, the brush), *context* (the one line or
//! control of the mode), *options* (houses along, only streets with houses), *undo* (bottom left), *confirm* (bottom right). The model decides what stands in
//! them; this file only draws it, so a mode cannot move another mode's control.
use crate::{
    marking::{BrushSize, ConfirmKind, Context, Mode, PanelModel},
    platform::Theme,
    ui::{
        status::{self, Kind, ORDER},
        Icon, IconName,
    },
};
use flyermap_core::Status;
use leptos::prelude::*;

fn mode_icon(mode: Mode) -> IconName {
    match mode {
        Mode::Route => IconName::Route,
        Mode::Stamp => IconName::Tap,
        Mode::Brush => IconName::Brush,
        Mode::Lasso => IconName::Lasso,
    }
}

/// The icon the mode button shows while that mode is in use.
pub fn icon_of(mode: Mode) -> IconName {
    mode_icon(mode)
}

#[component]
pub fn MarkPanel(
    #[prop(into)] model: Signal<PanelModel>,
    #[prop(into)] kind: Signal<Kind>,
    #[prop(into)] theme: Signal<Theme>,
    #[prop(into)] on_mode: Callback<Mode>,
    #[prop(into)] on_status: Callback<Status>,
    #[prop(into)] on_size: Callback<BrushSize>,
    #[prop(into)] on_houses: Callback<()>,
    #[prop(into)] on_houses_only: Callback<()>,
    #[prop(into)] on_undo: Callback<()>,
    #[prop(into)] on_confirm: Callback<()>,
) -> impl IntoView {
    let modes = Mode::ALL
        .into_iter()
        .map(|m| {
            view! {
                <button
                    type="button"
                    class="fm-tile"
                    data-mode=m.key()
                    aria-label=m.label()
                    aria-pressed=move || (model.with(|x| x.mode) == m).to_string()
                    on:click=move |_| on_mode.run(m)
                >
                    <Icon name=mode_icon(m) size=22 />
                    <span>{m.label()}</span>
                </button>
            }
        })
        .collect_view();
    let statuses = ORDER
        .into_iter()
        .map(|s| {
            view! {
                <button
                    type="button"
                    class="fm-tile status"
                    data-status=s.as_str()
                    style:--c=move || status::color(theme.get(), s)
                    style:--ink=move || crate::ui::palette::color::ink_on(status::color(theme.get(), s))
                    aria-label=move || status::label(kind.get(), s)
                    aria-pressed=move || (model.with(|x| x.status) == s).to_string()
                    on:click=move |_| on_status.run(s)
                >
                    <Icon name=status::icon(s) size=22 />
                    <span>{move || status::label(kind.get(), s)}</span>
                </button>
            }
        })
        .collect_view();
    let context = move || match model.with(|m| m.context.clone()) {
        Context::Line { text, warn } => view! {
            <p class="fm-ctx-line" class:warn=warn>
                <Icon name=if warn { IconName::Warning } else { IconName::Tap } size=18 />
                <span>{text}</span>
            </p>
        }
        .into_any(),
        Context::Points { count, text, warn } => view! {
            <p class="fm-ctx-line" class:warn=warn>
                <b class="fm-ctx-count" aria-label=format!("{count} Punkte")>{count}</b>
                <span>{text}</span>
            </p>
        }
        .into_any(),
        Context::Size(current) => view! {
            <div class="fm-ctx-size" role="group" aria-label="Strichbreite">
                {BrushSize::ALL
                    .into_iter()
                    .map(|size| {
                        view! {
                            <button type="button" data-size=size.label() aria-pressed=(size == current).to_string() on:click=move |_| on_size.run(size)>
                                {size.label()}
                            </button>
                        }
                    })
                    .collect_view()}
            </div>
        }
        .into_any(),
    };
    view! {
        <section class="fm-panel fm-markpanel" aria-label="Markieren" data-panel-mode=move || model.with(|m| m.mode.key())>
            <div class="fm-slot" data-slot="mode" role="group" aria-label="Modus">{modes}</div>
            <div class="fm-slot" data-slot="status" role="group" aria-label="Status">{statuses}</div>
            <div class="fm-slot" data-slot="context" role="status">{context}</div>
            <div class="fm-slot" data-slot="options" role="group" aria-label="Optionen">
                <button
                    type="button"
                    class="fm-chipbtn"
                    data-option="houses"
                    aria-label="Häuser an der Straße mitmarkieren"
                    title="Häuser an der Straße mitmarkieren"
                    aria-pressed=move || model.with(|m| m.houses_on).to_string()
                    disabled=move || !model.with(|m| m.houses_enabled)
                    on:click=move |_| on_houses.run(())
                >
                    <Icon name=IconName::House size=20 />
                </button>
                <button
                    type="button"
                    class="fm-chipbtn"
                    data-option="only"
                    aria-label="Nur Straßen mit Häusern"
                    title="Straßen ohne Häuser auslassen und ausblenden"
                    aria-pressed=move || model.with(|m| m.houses_only_on).to_string()
                    on:click=move |_| on_houses_only.run(())
                >
                    <Icon name=IconName::Road size=20 />
                </button>
            </div>
            <button type="button" class="fm-slot fm-undo" data-slot="undo" disabled=move || !model.with(|m| m.undo_enabled) on:click=move |_| on_undo.run(())>
                <Icon name=IconName::Undo size=22 />
                <span>{move || model.with(|m| m.undo_label)}</span>
            </button>
            <button
                type="button"
                class="fm-slot fm-confirm"
                data-slot="confirm"
                data-kind=move || if model.with(|m| m.confirm_kind) == ConfirmKind::Apply { "apply" } else { "finish" }
                disabled=move || !model.with(|m| m.confirm_enabled)
                on:click=move |_| on_confirm.run(())
            >
                <Icon name=IconName::Check size=22 />
                <span>{move || model.with(|m| m.confirm_label.clone())}</span>
            </button>
        </section>
    }
}
