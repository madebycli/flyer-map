//! Farbe (port of `src/v5/app/paletteSheet.tsx`): the colour of the app (Material You from a seed): eight colours or any colour; kept on this
//! device. Each swatch shows its own container colours, the dot is its accent.
use crate::{
    platform::Theme,
    ui::{
        palette::{color::parse_hex, is_offered, scheme_for, DEFAULT_SEED, SEEDS},
        Hint, Icon, IconName, Sheet,
    },
};
use leptos::prelude::*;

/// Background, text colour and dot of a swatch for this seed in this theme.
pub fn swatch_colors(seed: &str, theme: Theme) -> (String, String, String) {
    let s = scheme_for(seed, theme);
    let role = |name: &str| s.get(name).unwrap_or_default().to_string();
    (role("primary-container"), role("on-primary-container"), role("primary"))
}

/// The value of the colour input: the seed if it is a colour, else the default.
pub fn picker_value(seed: &str) -> String {
    if parse_hex(seed).is_some() && seed.starts_with('#') {
        seed.to_lowercase()
    } else {
        DEFAULT_SEED.to_string()
    }
}

#[component]
pub fn PaletteSheet(
    seed: RwSignal<String>,
    #[prop(into)] theme: Signal<Theme>,
    #[prop(into)] on_back: Callback<()>,
    #[prop(into)] on_close: Callback<()>,
) -> impl IntoView {
    let swatches = SEEDS
        .iter()
        .map(|s| {
            let on = Memo::new(move |_| seed.with(|v| v.eq_ignore_ascii_case(s.hex)));
            let colors = Memo::new(move |_| swatch_colors(s.hex, theme.get()));
            view! {
                <button
                    type="button"
                    class="v5-swatch"
                    class:on=move || on.get()
                    style:background=move || colors.get().0
                    style:color=move || colors.get().1
                    style:--dot=move || colors.get().2
                    aria-pressed=move || on.get().to_string()
                    aria-label=s.name
                    on:click=move |_| seed.set(s.hex.to_string())
                >
                    <i aria-hidden="true">
                        <Show when=move || on.get()>
                            <Icon name=IconName::Check size=20 />
                        </Show>
                    </i>
                    <span>{s.name}</span>
                </button>
            }
        })
        .collect_view();
    let custom = Memo::new(move |_| seed.with(|v| !is_offered(v)));
    let own = Memo::new(move |_| swatch_colors(&seed.get(), theme.get()));
    view! {
        <Sheet icon=IconName::Palette title="Farbe" on_back=on_back on_close=on_close>
            <Hint text="Alle Farben der App werden aus einer Grundfarbe gebildet, hell und dunkel. Das gilt nur für dieses Gerät." />
            <div class="v5-swatches" role="group" aria-label="Grundfarbe">
                {swatches}
                <label
                    class="v5-swatch"
                    class:on=move || custom.get()
                    style:background=move || own.get().0
                    style:color=move || own.get().1
                    style:--dot=move || own.get().2
                >
                    <i aria-hidden="true">
                        <Icon name=Signal::derive(move || if custom.get() { IconName::Check } else { IconName::Palette }) size=20 />
                    </i>
                    <span>"Eigene"</span>
                    <input
                        type="color"
                        aria-label="Eigene Grundfarbe"
                        prop:value=move || picker_value(&seed.get())
                        on:input=move |e| seed.set(event_target_value(&e))
                    />
                </label>
            </div>
            <div class="v5-preview" aria-hidden="true">
                <b>"Vorschau"</b>
                <span class="p">"Primär"</span>
                <span class="s">"Sekundär"</span>
                <span class="t">"Akzent"</span>
            </div>
        </Sheet>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_picker_always_gets_a_colour() {
        assert_eq!(picker_value("#2F6BD8"), "#2f6bd8");
        assert_eq!(picker_value("2f6bd8"), DEFAULT_SEED);
        assert_eq!(picker_value("nonsense"), DEFAULT_SEED);
    }

    #[test]
    fn swatches_use_the_container_of_their_seed() {
        let (bg, fg, dot) = swatch_colors("#2f6bd8", Theme::Dark);
        let s = scheme_for("#2f6bd8", Theme::Dark);
        assert_eq!((bg.as_str(), fg.as_str(), dot.as_str()), (s.get("primary-container").unwrap(), s.get("on-primary-container").unwrap(), s.get("primary").unwrap()));
    }
}
