//! The paths of `/v6`.

/// What a device asks of the Akteur of an Aktion: the paths below `/v6/aktionen/:id/`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Part {
    Push,
    Snapshot,
    Marks,
    Notes,
    Catchup,
    Live,
}

impl Part {
    /// The path the Akteur itself serves it under (`akteur::serve`; the live channel is the Durable Object's own).
    pub fn internal_path(self) -> &'static str {
        match self {
            Part::Push => "/push",
            Part::Snapshot => "/snapshot",
            Part::Marks => "/marks",
            Part::Notes => "/notes",
            Part::Catchup => "/catchup",
            Part::Live => "/live",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route {
    Organisations,
    SignInPassword,
    SignInPasskeyOptions,
    SignInPasskey,
    SignInRecovery,
    Logout,
    Me,
    Password,
    Devices,
    Device(String),
    PasskeyRegisterOptions,
    PasskeyRegister,
    Passkey(String),
    TotpEnroll,
    TotpConfirm,
    Totp,
    RecoveryCodes,
    Aktionen,
    People(String),
    Akteur(String, Part),
    Invites,
    Invite(String),
    InviteRedeem,
    Grant(String),
    Audit,
}

fn is_id(text: &str) -> bool {
    (1..=80).contains(&text.len()) && text.chars().all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c))
}

pub fn route(path: &str) -> Option<Route> {
    let rest = path.strip_prefix("/v6/")?.trim_end_matches('/');
    let parts: Vec<&str> = rest.split('/').collect();
    let id = |s: &str| is_id(s).then(|| s.to_string());
    Some(match parts.as_slice() {
        ["organisations"] => Route::Organisations,
        ["session", "password"] => Route::SignInPassword,
        ["session", "passkey-options"] => Route::SignInPasskeyOptions,
        ["session", "passkey"] => Route::SignInPasskey,
        ["session", "recovery"] => Route::SignInRecovery,
        ["session", "logout"] => Route::Logout,
        ["me"] => Route::Me,
        ["me", "password"] => Route::Password,
        ["devices"] => Route::Devices,
        ["devices", d] => Route::Device(id(d)?),
        ["passkeys", "register-options"] => Route::PasskeyRegisterOptions,
        ["passkeys", "register"] => Route::PasskeyRegister,
        ["passkeys", p] => Route::Passkey(id(p)?),
        ["totp", "enroll"] => Route::TotpEnroll,
        ["totp", "confirm"] => Route::TotpConfirm,
        ["totp"] => Route::Totp,
        ["recovery-codes"] => Route::RecoveryCodes,
        ["aktionen"] => Route::Aktionen,
        ["aktionen", a, "people"] => Route::People(id(a)?),
        ["aktionen", a, "push"] => Route::Akteur(id(a)?, Part::Push),
        ["aktionen", a, "snapshot"] => Route::Akteur(id(a)?, Part::Snapshot),
        ["aktionen", a, "marks"] => Route::Akteur(id(a)?, Part::Marks),
        ["aktionen", a, "notes"] => Route::Akteur(id(a)?, Part::Notes),
        ["aktionen", a, "catchup"] => Route::Akteur(id(a)?, Part::Catchup),
        ["aktionen", a, "live"] => Route::Akteur(id(a)?, Part::Live),
        ["invites"] => Route::Invites,
        ["invites", "redeem"] => Route::InviteRedeem,
        ["invites", i] => Route::Invite(id(i)?),
        ["grants", g] => Route::Grant(id(g)?),
        ["audit"] => Route::Audit,
        _ => return None,
    })
}

impl Route {
    /// The path with ids replaced, for log lines and metrics (no ids in the log).
    pub fn template(&self) -> &'static str {
        match self {
            Route::Organisations => "/v6/organisations",
            Route::SignInPassword => "/v6/session/password",
            Route::SignInPasskeyOptions => "/v6/session/passkey-options",
            Route::SignInPasskey => "/v6/session/passkey",
            Route::SignInRecovery => "/v6/session/recovery",
            Route::Logout => "/v6/session/logout",
            Route::Me => "/v6/me",
            Route::Password => "/v6/me/password",
            Route::Devices => "/v6/devices",
            Route::Device(_) => "/v6/devices/:id",
            Route::PasskeyRegisterOptions => "/v6/passkeys/register-options",
            Route::PasskeyRegister => "/v6/passkeys/register",
            Route::Passkey(_) => "/v6/passkeys/:id",
            Route::TotpEnroll => "/v6/totp/enroll",
            Route::TotpConfirm => "/v6/totp/confirm",
            Route::Totp => "/v6/totp",
            Route::RecoveryCodes => "/v6/recovery-codes",
            Route::Aktionen => "/v6/aktionen",
            Route::People(_) => "/v6/aktionen/:id/people",
            Route::Akteur(_, Part::Push) => "/v6/aktionen/:id/push",
            Route::Akteur(_, Part::Snapshot) => "/v6/aktionen/:id/snapshot",
            Route::Akteur(_, Part::Marks) => "/v6/aktionen/:id/marks",
            Route::Akteur(_, Part::Notes) => "/v6/aktionen/:id/notes",
            Route::Akteur(_, Part::Catchup) => "/v6/aktionen/:id/catchup",
            Route::Akteur(_, Part::Live) => "/v6/aktionen/:id/live",
            Route::Invites => "/v6/invites",
            Route::Invite(_) => "/v6/invites/:id",
            Route::InviteRedeem => "/v6/invites/redeem",
            Route::Grant(_) => "/v6/grants/:id",
            Route::Audit => "/v6/audit",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths() {
        assert_eq!(route("/v6/me"), Some(Route::Me));
        assert_eq!(route("/v6/invites/redeem"), Some(Route::InviteRedeem));
        assert_eq!(route("/v6/invites/i_1"), Some(Route::Invite("i_1".into())));
        assert_eq!(route("/v6/aktionen/a1/people"), Some(Route::People("a1".into())));
        assert_eq!(route("/v6/aktionen/a1/push"), Some(Route::Akteur("a1".into(), Part::Push)));
        assert_eq!(route("/v6/aktionen/a1/live"), Some(Route::Akteur("a1".into(), Part::Live)));
        assert_eq!(route("/v6/devices/"), Some(Route::Devices), "a trailing slash is tolerated");
        for bad in ["/v5/me", "/v6/", "/v6/nope", "/v6/devices/a b", "/v6/aktionen/a1", "/v6/me/x/y"] {
            assert_eq!(route(bad), None, "{bad}");
        }
    }
}
