//! The first screen of a device without access: app-first, one thing to do. An invitation code (typed, pasted, or already filled in by the link a QR code opens) makes
//! the device a guest without an account; whoever has an account signs in with a passkey or with name and password and, if the account asks for it, six digits.
//! Enter sends; every field is at least 44 px; nothing moves when an error appears (it has its place under the fields).
use super::flow::{Join, JoinAction, Step, Way};
use crate::ui::{Icon, IconName, SegOption, Segmented};
use leptos::{ev, prelude::*};

#[component]
pub fn JoinScreen(
    #[prop(into)] state: Signal<Join>,
    #[prop(into)] on_action: Callback<JoinAction>,
    /// The main button of the form that is up (or Enter).
    #[prop(into)]
    on_send: Callback<()>,
    #[prop(into)] on_passkey: Callback<()>,
    #[prop(into)] on_paste: Callback<()>,
) -> impl IntoView {
    let way = Signal::derive(move || state.with(|s| s.way));
    let step = Signal::derive(move || state.with(|s| s.step));
    let submit = move |e: ev::SubmitEvent| {
        e.prevent_default();
        if state.with_untracked(Join::can_send) {
            on_send.run(());
        }
    };
    let send_label = move || {
        if state.with(|s| s.busy) {
            "Einen Moment …"
        } else {
            match (way.get(), step.get()) {
                (Way::Invitation, _) => "Beitreten",
                (Way::Account, Step::First) => "Anmelden",
                (Way::Account, Step::SecondFactor) => "Bestätigen",
            }
        }
    };
    let invitation = move || {
        view! {
            <label class="fm-field">
                <span>"Einladungscode"</span>
                <input
                    class="v5-input fm-code"
                    data-field="code"
                    type="text"
                    inputmode="text"
                    autocomplete="off"
                    autocapitalize="characters"
                    spellcheck="false"
                    maxlength="14"
                    placeholder="7K2QX-9M4TB"
                    aria-describedby="join-code-hint"
                    prop:value=move || state.with(Join::shown_code)
                    on:input=move |e| on_action.run(JoinAction::Code(event_target_value(&e)))
                />
            </label>
            <button type="button" class="v5-btn quiet fm-paste" on:click=move |_| on_paste.run(())>
                <Icon name=IconName::Clipboard size=20 />
                "Code oder Link einfügen"
            </button>
            <p class="v5-hint" id="join-code-hint">
                <Icon name=IconName::Info size=20 />
                "Mit dem Code bist du als Gast dabei, ohne Konto. Einen QR-Code scannst du mit der Kamera deines Handys: Er öffnet diese Seite mit dem Code."
            </p>
        }
        .into_any()
    };
    let account = move || {
        match step.get() {
        Step::First => view! {
            <button type="button" class="v5-btn primary fm-passkey" data-act="passkey" disabled=move || state.with(|s| s.busy) on:click=move |_| on_passkey.run(())>
                <Icon name=IconName::Lock size=20 />
                "Mit Passkey anmelden"
            </button>
            <p class="fm-or" aria-hidden="true"><span>"oder mit Passwort"</span></p>
            <label class="fm-field">
                <span>"Name"</span>
                <input
                    class="v5-input"
                    data-field="name"
                    type="text"
                    autocomplete="username"
                    autocapitalize="none"
                    spellcheck="false"
                    prop:value=move || state.with(|s| s.name.clone())
                    on:input=move |e| on_action.run(JoinAction::Name(event_target_value(&e)))
                />
            </label>
            <label class="fm-field">
                <span>"Passwort"</span>
                <input
                    class="v5-input"
                    data-field="password"
                    type="password"
                    autocomplete="current-password"
                    prop:value=move || state.with(|s| s.password.clone())
                    on:input=move |e| on_action.run(JoinAction::Password(event_target_value(&e)))
                />
            </label>
        }
        .into_any(),
        Step::SecondFactor => view! {
            <label class="fm-field">
                <span>"Code aus der Authenticator-App"</span>
                <input
                    class="v5-input fm-code"
                    data-field="digits"
                    type="text"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength="6"
                    placeholder="000000"
                    prop:value=move || state.with(|s| s.digits.clone())
                    on:input=move |e| on_action.run(JoinAction::Digits(event_target_value(&e)))
                />
            </label>
        }
        .into_any(),
    }
    };
    view! {
        <main class="fm-join" aria-label="Beitreten">
            <header>
                <img src="logo.svg" alt="" width="72" height="72" />
                <h1>"Verteil-Flyer"</h1>
                <p>"Gemeinsam Flyer verteilen. Zum Mitmachen brauchst du eine Einladung."</p>
            </header>
            <Show when=move || step.get() == Step::First>
                <Segmented
                    label="Wie möchtest du rein?"
                    value=way
                    options=vec![SegOption::new(Way::Invitation, "Einladung", IconName::Send), SegOption::new(Way::Account, "Konto", IconName::Lock)]
                    on_change=move |w| on_action.run(JoinAction::SetWay(w))
                />
            </Show>
            <form class="fm-joinform" on:submit=submit>
                {move || if way.get() == Way::Invitation { invitation() } else { account() }}
                {move || state.with(|s| s.error.clone()).map(|text| view! { <p class="v5-hint warn" role="alert" data-role="join-error"><Icon name=IconName::Warning size=20 />{text}</p> })}
                <button type="submit" class="v5-btn primary fm-send" disabled=move || !state.with(Join::can_send)>
                    {send_label}
                </button>
                <Show when=move || step.get() == Step::SecondFactor>
                    <button type="button" class="v5-btn quiet" on:click=move |_| on_action.run(JoinAction::Back)>"Zurück"</button>
                </Show>
            </form>
        </main>
    }
}
