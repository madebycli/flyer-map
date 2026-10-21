//! Einstellungen (port of `SettingsSheet` in `src/v5/app/panels.tsx`): look and feel on one page. Nothing here changes data.
use super::prefs::Prefs;
use crate::{
    platform::{Hand, Theme},
    ui::{IconName, ListGroup, ListRow, SegOption, Segmented, Sheet, SwitchRow},
};
use leptos::prelude::*;

#[component]
pub fn SettingsSheet(
    prefs: Prefs,
    #[prop(into)] on_palette: Callback<()>,
    /// The rows under "Mehr" (diagnosis), each with its own action.
    #[prop(into)]
    on_diagnosis: Callback<()>,
    #[prop(into)] on_back: Callback<()>,
    #[prop(into)] on_close: Callback<()>,
) -> impl IntoView {
    let themes = vec![
        SegOption::new(Theme::Dark, "Dunkel", IconName::Moon),
        SegOption::new(Theme::Light, "Hell", IconName::Sun),
    ];
    let hands = vec![
        SegOption::new(Hand::Right, "Rechtshand", IconName::Hand),
        SegOption::new(Hand::Left, "Linkshand", IconName::Hand),
    ];
    view! {
        <Sheet icon=IconName::Settings title="Einstellungen" on_back=on_back on_close=on_close>
            <ListGroup title="Darstellung">
                <Segmented label="Hell oder dunkel" value=prefs.theme options=themes on_change=move |t| prefs.theme.set(t) />
                <ListRow icon=IconName::Palette label="Farbe" hint="Akzentfarbe der App" on_click=on_palette />
            </ListGroup>
            <ListGroup title="Bedienung">
                <Segmented label="Bedienhand" value=prefs.hand options=hands on_change=move |h| prefs.hand.set(h) />
            </ListGroup>
            <ListGroup title="Unterwegs">
                <SwitchRow
                    icon=IconName::Sun
                    label="Bildschirm anlassen"
                    hint="Das Display dimmt nicht, solange die App offen ist"
                    checked=prefs.awake
                    on_change=move |on| prefs.awake.set(on)
                />
                <SwitchRow
                    icon=IconName::Check
                    label="Kurz vibrieren beim Markieren"
                    hint="Nur auf Geräten, die das können (nicht iPhone)"
                    checked=prefs.haptics
                    on_change=move |on| prefs.haptics.set(on)
                />
            </ListGroup>
            <ListGroup title="Karte">
                <SwitchRow
                    icon=IconName::Layers
                    label="Straßenkarte darunter"
                    hint="Aus: nur Straßen, Häuser und Gebiete"
                    checked=prefs.base_on
                    on_change=move |on| prefs.base_on.set(on)
                />
            </ListGroup>
            <ListGroup title="Mehr">
                <ListRow icon=IconName::Chart label="Diagnose" hint="Messwerte und Bericht für den Support" on_click=on_diagnosis />
            </ListGroup>
        </Sheet>
    }
}
