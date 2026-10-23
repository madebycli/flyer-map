//! A request through the server: origin check, caller, route, handler, headers and the log line.
use crate::{
    akteur::{link::Link, Akteure, NoAkteure},
    api::{
        self,
        route::{route, Part, Route},
        Ctx,
    },
    auth,
    env::Env,
    error::{fail, Code, Done},
};
use flyermap_host::{
    db::Db,
    http::{
        observe::{log_line, request_id, server_timing, DbStats},
        request::Request,
        response::Response,
    },
};

pub struct App<D: Db, A: Akteure = NoAkteure> {
    pub db: D,
    pub env: Env,
    pub akteure: A,
}

impl<D: Db> App<D> {
    /// The directory only; give it Akteure with [`App::with_akteure`].
    pub fn new(db: D, env: Env) -> App<D> {
        App { db, env, akteure: NoAkteure }
    }
}

impl<D: Db, A: Akteure> App<D, A> {
    pub fn with_akteure<B: Akteure>(self, akteure: B) -> App<D, B> {
        App { db: self.db, env: self.env, akteure }
    }

    /// `None` for anything outside `/v6/`.
    pub async fn handle(&self, request: &Request) -> Option<Response> {
        let path = request.path();
        if !path.starts_with("/v6/") {
            return None;
        }
        let started = self.env.now();
        let rid = request_id(request.header("x-request-id"), || (self.env.new_id)());
        let found = route(path);
        let template = found.as_ref().map_or("/v6/?", Route::template);
        let mut response = match self.dispatch(request, found).await {
            Ok(r) => r,
            Err(f) => {
                if matches!(f.code, Code::Internal | Code::Unavailable) {
                    let what = f.cause.as_deref().unwrap_or(&f.detail);
                    (self.env.log)(&serde_json::json!({ "lvl": "error", "msg": "v6 internal", "rid": rid, "route": template, "cause": what }).to_string());
                }
                f.response()
            }
        };
        let ms = self.env.now().saturating_sub(started) as f64;
        let code = response.body_json().pointer("/error/code").and_then(|c| c.as_str()).map(str::to_string);
        (self.env.log)(&log_line(&rid, template, &request.method, response.status, ms, &DbStats::default(), code.as_deref()));
        response.set_header("x-request-id", &rid);
        response.set_header("server-timing", &server_timing(ms, &DbStats::default()));
        response.set_header("x-content-type-options", "nosniff");
        Some(response)
    }

    /// Writes come from our own pages only: an `Origin` that is not ours is refused (requests without one are not browser pages).
    fn origin_ok(&self, request: &Request) -> bool {
        match request.header("origin") {
            None => true,
            Some(o) if self.env.config.origins.is_empty() => o == request.origin(),
            Some(o) => self.env.config.origins.iter().any(|a| a == o),
        }
    }

    /// The link for a live connection (`GET /v6/aktionen/:id/live` with an upgrade), or `None` when the request is not one. The host upgrades the
    /// connection at the Akteur itself, because a socket does not fit a [`Response`]. The `Origin` of a page is checked here as for every write: a
    /// socket opened from another site would carry the person's cookie.
    pub async fn live_link(&self, request: &Request) -> Option<Done<Link>> {
        let Some(Route::Akteur(aktion, Part::Live)) = route(request.path()) else { return None };
        if request.method != "GET" {
            return None;
        }
        Some(self.authorize_live(request, &aktion).await)
    }

    async fn authorize_live(&self, request: &Request, aktion: &str) -> Done<Link> {
        if !self.origin_ok(request) {
            return Err(fail(Code::CrossOrigin, "request from another origin"));
        }
        let caller = auth::resolve(&self.db, &self.env, request).await?;
        api::akteur::live_link(&Ctx::new(&self.db, &self.env, request, caller), aktion).await
    }

    async fn dispatch(&self, request: &Request, found: Option<Route>) -> Done {
        let Some(found) = found else { return Err(fail(Code::NotFound, "unknown route")) };
        let method = request.method.as_str();
        if !matches!(method, "GET" | "HEAD") && !self.origin_ok(request) {
            return Err(fail(Code::CrossOrigin, "request from another origin"));
        }
        let caller = auth::resolve(&self.db, &self.env, request).await?;
        let c = Ctx::new(&self.db, &self.env, request, caller);
        let response = self.handle_route(&c, found, method).await?;
        // Rights that ended close the connections they let in; this is after the change was made, and it is best effort (the alarm of the Akteur
        // drops what the rights no longer allow within a minute).
        for (aktion, kick) in c.kicks.take() {
            if let Err(cause) = self.akteure.kick(&aktion, &kick).await {
                (self.env.log)(&serde_json::json!({ "lvl": "warn", "msg": "v6 kick failed", "cause": cause }).to_string());
            }
        }
        Ok(response)
    }

    async fn handle_route(&self, c: &Ctx<'_, D>, found: Route, method: &str) -> Done {
        use api::*;
        match (found, method) {
            (Route::Akteur(_, Part::Live), _) => Err(fail(Code::InvalidRequest, "this is a WebSocket route")),
            (Route::Akteur(aktion, part), _) => akteur::forward(c, &self.akteure, &aktion, part).await,
            (Route::Organisations, "POST") => accounts::create_organisation(c).await,
            (Route::SignInPassword, "POST") => sign_in::password(c).await,
            (Route::SignInPasskeyOptions, "POST") => passkeys::sign_in_options(c).await,
            (Route::SignInPasskey, "POST") => passkeys::sign_in(c).await,
            (Route::SignInRecovery, "POST") => recovery::sign_in(c).await,
            (Route::Logout, "POST") => sign_in::logout(c).await,
            (Route::Me, "GET") => c.me().and(accounts::me(c).await),
            (Route::Me, "PATCH") => accounts::update_me(c).await,
            (Route::Password, "POST") => accounts::change_password(c).await,
            (Route::Devices, "GET") => devices::list(c).await,
            (Route::Device(id), "DELETE") => devices::revoke(c, &id).await,
            (Route::PasskeyRegisterOptions, "POST") => passkeys::register_options(c).await,
            (Route::PasskeyRegister, "POST") => passkeys::register(c).await,
            (Route::Passkey(id), "DELETE") => passkeys::remove(c, &id).await,
            (Route::TotpEnroll, "POST") => second_factor::enroll(c).await,
            (Route::TotpConfirm, "POST") => second_factor::confirm(c).await,
            (Route::Totp, "DELETE") => second_factor::remove(c).await,
            (Route::RecoveryCodes, "POST") => recovery::generate(c).await,
            (Route::Aktionen, "POST") => aktionen::create(c).await,
            (Route::Aktionen, "GET") => aktionen::list(c).await,
            (Route::People(id), "GET") => people::list(c, &id).await,
            (Route::Invites, "POST") => invites::create(c).await,
            (Route::Invites, "GET") => invites::list(c).await,
            (Route::Invite(id), "DELETE") => invites::revoke(c, &id).await,
            (Route::InviteRedeem, "POST") => invites::redeem(c).await,
            (Route::Grant(id), "DELETE") => people::revoke(c, &id).await,
            (Route::Audit, "GET") => people::audit_log(c).await,
            _ => Err(fail(Code::MethodNotAllowed, "method not allowed")),
        }
    }
}
