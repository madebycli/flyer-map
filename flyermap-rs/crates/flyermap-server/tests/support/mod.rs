//! A whole server in a test: SQLite, a clock you can move, deterministic "randomness", captured logs.
#![allow(dead_code)]
pub mod akteure;
pub mod aktion;

use akteure::LocalAkteure;
use flyermap_host::{
    db::sqlite::SqliteDb,
    http::request::Request,
    platform::{unlimited, vars_from},
};
use flyermap_identity::{b64, token::hash_token};
use flyermap_server::{directory, kdf::SoftKdf, App, Env};
use serde_json::{json, Value};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

pub const ORIGIN: &str = "https://app.test";
pub const SETUP_KEY: &str = "setup-key-for-tests";

#[derive(Debug)]
pub struct Reply {
    pub status: u16,
    pub json: Value,
    /// `name=value` of the cookie that was set, if any.
    pub cookie: Option<String>,
}

impl Reply {
    pub fn code(&self) -> &str {
        self.json.pointer("/error/code").and_then(Value::as_str).unwrap_or("")
    }
}

pub struct World {
    pub app: App<SqliteDb, LocalAkteure>,
    pub clock: Rc<Cell<u64>>,
    pub logs: Rc<RefCell<Vec<String>>>,
}

impl World {
    pub fn new() -> World {
        World::with(&[])
    }

    pub fn with(extra: &[(&str, &str)]) -> World {
        let db = SqliteDb::in_memory().unwrap();
        futures::executor::block_on(directory::install(&db)).unwrap();
        let clock = Rc::new(Cell::new(1_800_000_000_000u64));
        let logs = Rc::new(RefCell::new(Vec::new()));
        // deterministic but well mixed (splitmix64): every one of the 32 bytes differs from call to call
        let counter = Cell::new(0u64);
        let random = move || {
            let mut out = [0u8; 32];
            for word in out.chunks_mut(8) {
                counter.set(counter.get().wrapping_add(0x9e37_79b9_7f4a_7c15));
                let mut z = counter.get();
                z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
                z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
                word.copy_from_slice(&(z ^ (z >> 31)).to_le_bytes());
            }
            out
        };
        let mut vars: Vec<(String, String)> = vec![
            ("RP_ID".into(), "app.test".into()),
            ("ORIGINS".into(), ORIGIN.into()),
            ("KDF_ITERATIONS".into(), "1000".into()),
            ("SETUP_KEY_SHA256".into(), hash_token(SETUP_KEY)),
            ("SEAL_KEY".into(), b64::encode(&[7u8; 32])),
        ];
        vars.retain(|(k, _)| !extra.iter().any(|(e, _)| e == k));
        vars.extend(extra.iter().map(|(k, v)| (k.to_string(), v.to_string())));
        let (now, log) = (clock.clone(), logs.clone());
        let env = Env::new(
            Box::new(move || now.get()),
            Box::new(random),
            Box::new(move |line| log.borrow_mut().push(line.to_string())),
            Box::new(|| "r-test".into()),
            unlimited(),
            Box::new(SoftKdf),
            &vars_from(vars),
        );
        World { app: App::new(db, env).with_akteure(LocalAkteure::new(clock.clone())), clock, logs }
    }

    pub fn advance(&self, ms: u64) {
        self.clock.set(self.clock.get() + ms);
    }

    pub fn call_with(&self, method: &str, path: &str, body: Option<Value>, cookie: Option<&str>, headers: &[(&str, &str)]) -> Reply {
        let mut request = Request::new(method, &format!("{ORIGIN}{path}"));
        if method != "GET" && !headers.iter().any(|(k, _)| *k == "origin") {
            request = request.with_header("origin", ORIGIN);
        }
        if let Some(c) = cookie {
            request = request.with_header("cookie", c);
        }
        for (k, v) in headers {
            request = request.with_header(k, v);
        }
        if let Some(b) = body {
            request = request.with_header("content-type", "application/json").with_body(b.to_string().into_bytes());
        }
        let response = futures::executor::block_on(self.app.handle(&request)).expect("a /v6 route");
        let cookie = response.header("set-cookie").and_then(|c| c.split(';').next()).map(str::to_string);
        Reply { status: response.status, json: response.body_json(), cookie }
    }

    pub fn call(&self, method: &str, path: &str, body: Option<Value>, cookie: Option<&str>) -> Reply {
        self.call_with(method, path, body, cookie, &[])
    }

    pub fn get(&self, path: &str, cookie: &str) -> Reply {
        self.call("GET", path, None, Some(cookie))
    }

    pub fn post(&self, path: &str, body: Value, cookie: Option<&str>) -> Reply {
        self.call("POST", path, Some(body), cookie)
    }

    /// An Organisation with its owner; returns the owner's cookie and the Organisation id.
    pub fn organisation(&self, handle: &str) -> (String, String) {
        let r = self.call_with(
            "POST",
            "/v6/organisations",
            Some(json!({ "name": "Verein", "owner": { "handle": handle, "display_name": "Anna", "password": "correct horse battery" } })),
            None,
            &[("x-setup-key", SETUP_KEY)],
        );
        assert_eq!(r.status, 201, "{:?}", r.json);
        (r.cookie.unwrap(), r.json["organisation"]["id"].as_str().unwrap().to_string())
    }

    pub fn aktion(&self, owner: &str, org: &str) -> String {
        let r = self.post("/v6/aktionen", json!({ "org_id": org, "name": "Herbst" }), Some(owner));
        assert_eq!(r.status, 201, "{:?}", r.json);
        r.json["aktion"]["id"].as_str().unwrap().to_string()
    }

    /// The person id behind a cookie.
    pub fn who(&self, cookie: &str) -> String {
        self.get("/v6/me", cookie).json["person"]["id"].as_str().unwrap().to_string()
    }
}

impl World {
    /// The error lines in the log (for tests that expect a 500 and want to know why).
    pub fn errors(&self) -> Vec<String> {
        self.logs.borrow().iter().filter(|l| l.contains("\"lvl\":\"error\"")).cloned().collect()
    }
}

impl World {
    /// Commands pushed to the Akteur of an Aktion (`POST /v6/aktionen/:id/push`).
    pub fn push(&self, cookie: &str, aktion: &str, commands: &[flyermap_protocol::Command]) -> Reply {
        self.post(&format!("/v6/aktionen/{aktion}/push"), json!({ "commands": commands }), Some(cookie))
    }

    /// One command, and the verdict it got (the answer inside the 200).
    pub fn command(&self, cookie: &str, aktion: &str, body: flyermap_protocol::Body) -> Value {
        let cid = format!("c{}", self.clock.get());
        self.advance(1);
        let r = self.push(cookie, aktion, &[flyermap_protocol::Command { cid: flyermap_protocol::CommandId::new(&cid), body }]);
        assert_eq!(r.status, 200, "{:?}", r.json);
        r.json["answers"][0]["verdict"].clone()
    }

    /// A WebSocket the way a page opens it: with the cookie and the `Origin` of the page. Returns the connection, or the refusal.
    pub fn connect(&self, cookie: &str, aktion: &str) -> Result<String, Reply> {
        self.connect_from(cookie, aktion, ORIGIN)
    }

    pub fn connect_from(&self, cookie: &str, aktion: &str, origin: &str) -> Result<String, Reply> {
        let request = Request::new("GET", &format!("{ORIGIN}/v6/aktionen/{aktion}/live")).with_header("cookie", cookie).with_header("origin", origin);
        match futures::executor::block_on(self.app.live_link(&request)).expect("a live route") {
            Ok(link) => Ok(self.app.akteure.connect(link)),
            Err(f) => Err(Reply { status: f.code.status(), json: f.response().body_json(), cookie: None }),
        }
    }

    /// Someone who joined with an invitation: the guest's cookie.
    pub fn guest(&self, owner: &str, role: &str, scope: Value) -> String {
        let made = self.post("/v6/invites", json!({ "role": role, "scope": scope }), Some(owner));
        assert_eq!(made.status, 201, "{:?}", made.json);
        let joined = self.post("/v6/invites/redeem", json!({ "code": made.json["code"], "display_name": "Berta", "label": "Handy" }), None);
        assert_eq!(joined.status, 200, "{:?}", joined.json);
        joined.cookie.unwrap()
    }
}
