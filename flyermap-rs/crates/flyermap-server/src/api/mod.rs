//! The HTTP handlers of `/v6`, one file per resource. A handler gets a [`Ctx`], returns `Done<Response>`, and uses `?` for every refusal.
pub mod accounts;
pub mod akteur;
pub mod aktionen;
pub mod devices;
pub mod invites;
pub mod passkeys;
pub mod people;
pub mod recovery;
pub mod route;
pub mod second_factor;
pub mod sign_in;

use crate::{
    akteur::Kick,
    auth::Caller,
    env::Env,
    error::{fail, Code, Done},
};
use flyermap_host::{db::Db, http::request::Request};
use flyermap_identity::{decide, Action, Resource};
use serde_json::{Map, Value};
use std::cell::RefCell;

pub struct Ctx<'a, D: Db> {
    pub db: &'a D,
    pub env: &'a Env,
    pub request: &'a Request,
    pub caller: Option<Caller>,
    /// Live connections to drop once the handler has succeeded (rights ended): `(aktion id, who)`. The app sends them; a failed handler sends none.
    pub kicks: RefCell<Vec<(String, Kick)>>,
}

pub type Json = Map<String, Value>;

impl<'a, D: Db> Ctx<'a, D> {
    pub fn new(db: &'a D, env: &'a Env, request: &'a Request, caller: Option<Caller>) -> Ctx<'a, D> {
        Ctx { db, env, request, caller, kicks: RefCell::new(Vec::new()) }
    }

    /// Ask the app to close the live connections `kick` names in the Akteur of `aktion`, after this request has succeeded.
    pub fn kick(&self, aktion: &str, kick: Kick) {
        self.kicks.borrow_mut().push((aktion.to_string(), kick));
    }

    pub fn now(&self) -> u64 {
        self.env.now()
    }

    /// The signed-in caller, or `unauthorized`.
    pub fn me(&self) -> Done<&Caller> {
        self.caller.as_ref().ok_or_else(|| fail(Code::Unauthorized, "sign in first"))
    }

    /// One right, asked of the one decision function. Strangers get `not_found` for what they may not even see; people inside get `forbidden`.
    pub fn allow(&self, action: Action, resource: &Resource) -> Done<()> {
        let me = self.me()?;
        if decide(&me.access, self.now(), action, resource).is_allowed() {
            return Ok(());
        }
        let may_see = decide(&me.access, self.now(), Action::Enter, resource).is_allowed();
        Err(if may_see { fail(Code::Forbidden, "not allowed") } else { fail(Code::NotFound, "not found") })
    }

    /// The JSON object of the request body (at most `max` characters).
    pub fn body(&self, max: usize) -> Done<Json> {
        if !self.request.header("content-type").unwrap_or("").contains("application/json") {
            return Err(fail(Code::UnsupportedMediaType, "JSON expected"));
        }
        let text = self.request.body_text();
        if text.encode_utf16().count() > max {
            return Err(fail(Code::TooLarge, "body too large"));
        }
        match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(map)) => Ok(map),
            _ => Err(fail(Code::InvalidRequest, "JSON object expected")),
        }
    }
}

/// A text field of 1..=`max` characters.
pub fn text(body: &Json, key: &str, max: usize) -> Done<String> {
    match body.get(key).and_then(Value::as_str).map(str::trim) {
        Some(t) if !t.is_empty() && t.encode_utf16().count() <= max => Ok(t.to_string()),
        _ => Err(fail(Code::InvalidRequest, format!("{key} missing or too long"))),
    }
}

pub fn opt_text(body: &Json, key: &str, max: usize) -> Done<Option<String>> {
    match body.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => text(body, key, max).map(Some),
    }
}

/// An optional whole number in `min..=max`.
pub fn opt_int(body: &Json, key: &str, min: u64, max: u64) -> Done<Option<u64>> {
    match body.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_u64() {
            Some(n) if (min..=max).contains(&n) => Ok(Some(n)),
            _ => Err(fail(Code::InvalidRequest, format!("{key} out of range"))),
        },
    }
}

/// Base64url bytes from a field.
pub fn bytes(body: &Json, key: &str, max: usize) -> Done<Vec<u8>> {
    flyermap_identity::b64::decode(&text(body, key, max)?).ok_or_else(|| fail(Code::InvalidRequest, format!("{key} is not base64url")))
}
