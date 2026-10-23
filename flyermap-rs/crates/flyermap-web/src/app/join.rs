//! The way in, wired to the app: the screen for a device without access sends the invitation code or the sign-in to the backend, and on success the session
//! starts again (now with the access). A refusal stays on the screen in words. Nothing about the account is kept here; the server owns it.
use super::state::AppState;
use crate::{
    backend::{BackendError, Joined, SignIn},
    features::join::{code_from_text, Join, JoinAction, JoinScreen, Step, Way},
    platform::{clipboard, events::query_param},
};
use leptos::{prelude::*, task::spawn_local};

/// A code the address brings: `?code=…`, or a link that ends in `/beitreten/<code>` (what a QR code opens).
pub fn code_from_address() -> Option<String> {
    let location = web_sys::window()?.location();
    query_param("code").and_then(|c| code_from_text(&c)).or_else(|| location.pathname().ok().and_then(|p| code_from_text(&p)))
}

pub fn screen(state: AppState) -> AnyView {
    let join = RwSignal::new(code_from_address().map_or_else(Join::default, |c| Join::with_code(&c)));
    let act = move |a: JoinAction| join.update(|j| j.reduce(a));
    let welcome = move |joined: Joined| {
        state.session.start();
        state.notify(format!("Willkommen, {}!", joined.label));
    };
    // what a refusal means for the form: the second factor is asked for, or the words are shown
    let failed = move |e: BackendError| match &e {
        BackendError::Invalid { code, message } if code == "totp_required" => act(JoinAction::NeedsSecondFactor(message.clone())),
        _ => act(JoinAction::Refused(e.message())),
    };
    let on_send = move |()| {
        let now = join.get_untracked();
        act(JoinAction::Sent);
        let backend = state.session.backend();
        spawn_local(async move {
            let result = match (now.way, now.step) {
                (Way::Invitation, _) => backend.redeem(&now.code).await,
                (Way::Account, Step::First) => backend.sign_in(SignIn::Password { name: now.name.trim().to_string(), password: now.password.clone() }).await,
                (Way::Account, Step::SecondFactor) => backend.sign_in(SignIn::Totp { code: now.digits.clone() }).await,
            };
            match result {
                Ok(joined) => welcome(joined),
                Err(e) => failed(e),
            }
        });
    };
    let on_passkey = move |()| {
        act(JoinAction::Sent);
        let backend = state.session.backend();
        spawn_local(async move {
            match backend.sign_in(SignIn::Passkey).await {
                Ok(joined) => welcome(joined),
                Err(e) => failed(e),
            }
        });
    };
    let on_paste = move |()| {
        spawn_local(async move {
            match clipboard::read_text().await {
                Some(text) => act(JoinAction::Code(text)),
                None => act(JoinAction::Refused("Die Zwischenablage lässt sich hier nicht lesen. Tippe den Code ein.".into())),
            }
        });
    };
    view! { <JoinScreen state=join on_action=act on_send=on_send on_passkey=on_passkey on_paste=on_paste /> }.into_any()
}
