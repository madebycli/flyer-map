//! The Akteur's own HTTP surface, the same in the Durable Object and in the tests (it is generic over the storage). The edge forwards a request here
//! after it has worked out who asks; the answers are the protocol's types as JSON.
//!
//! - `POST /push` (`PushRequest`): commands, one answer each, in order. The new entries of every command that changed something come back to the host
//!   in [`Served::handled`] to be told to the live connections.
//! - `GET /snapshot`, `GET /marks`, `GET /notes`, `GET /catchup`: the reads, cut to what the caller may see.
//!
//! A refusal of a command is part of its answer (status 200); a read that cannot be done is `{"error":{"code","reason"}}` with a status that follows
//! the reason.
use super::link::Link;
use flyermap_aktion::{Aktion, Handled, Sql};
use flyermap_host::http::{request::Request, response::Response};
use flyermap_protocol::{
    limits::{MAX_COMMANDS, MAX_PAGE_ENTRIES, MAX_PAGE_ROWS},
    MarkCursor, NoteCursor, PushReply, PushRequest, Reason,
};
use serde::de::DeserializeOwned;
use serde_json::json;

/// What serving a request gives: the answer, and the commands' results the host has to tell the live connections about.
pub struct Served {
    pub response: Response,
    pub handled: Vec<Handled>,
}

impl Served {
    fn only(response: Response) -> Served {
        Served { response, handled: Vec::new() }
    }
}

pub fn serve<S: Sql>(a: &mut Aktion<S>, link: &Link, now: u64, request: &Request) -> Served {
    let caller = link.caller();
    match (request.method.as_str(), request.path()) {
        ("POST", "/push") => push(a, link, now, request),
        ("GET", "/snapshot") => Served::only(reply(a.snapshot(&caller, now))),
        ("GET", "/marks") => {
            let Some(after) = cursor::<MarkCursor>(request, "after_gebiet", "after_key", ("gebiet", "key")) else { return Served::only(malformed()) };
            Served::only(reply(a.marks_page(&caller, now, after.as_ref(), limit(request, 500, MAX_PAGE_ROWS))))
        }
        ("GET", "/notes") => {
            let Some(after) = cursor::<NoteCursor>(request, "after_gebiet", "after_id", ("gebiet", "id")) else { return Served::only(malformed()) };
            Served::only(reply(a.notes_page(&caller, now, after.as_ref(), limit(request, 500, MAX_PAGE_ROWS))))
        }
        ("GET", "/catchup") => {
            let Some(since) = request.query("since").and_then(|s| s.parse().ok()) else { return Served::only(malformed()) };
            Served::only(reply(a.catchup(&caller, now, since, limit(request, 500, MAX_PAGE_ENTRIES))))
        }
        _ => Served::only(Response::error(404, "not_found", "unknown route")),
    }
}

fn push<S: Sql>(a: &mut Aktion<S>, link: &Link, now: u64, request: &Request) -> Served {
    let Ok(PushRequest { commands }) = serde_json::from_slice(&request.body) else { return Served::only(malformed()) };
    if commands.len() > MAX_COMMANDS {
        return Served::only(error(&Reason::TooLarge { limit: MAX_COMMANDS as u32 }));
    }
    let caller = link.caller();
    let (mut answers, mut handled) = (Vec::with_capacity(commands.len()), Vec::new());
    for command in commands {
        let done = a.handle(&caller, command, now);
        answers.push(done.reply.clone());
        if !done.broadcast.is_empty() {
            handled.push(done);
        }
    }
    Served { response: Response::json(200, &PushReply { answers, head: a.head(), server_now: now }), handled }
}

fn limit(request: &Request, default: u32, max: u32) -> u32 {
    request.query("limit").and_then(|l| l.parse().ok()).unwrap_or(default).clamp(1, max)
}

/// The cursor named by two query parameters: `Some(None)` when neither is there, `None` when it is half there or not one.
fn cursor<T: DeserializeOwned>(request: &Request, first: &str, second: &str, fields: (&str, &str)) -> Option<Option<T>> {
    match (request.query(first), request.query(second)) {
        (None, None) => Some(None),
        (Some(a), Some(b)) => serde_json::from_value(json!({ fields.0: a, fields.1: b })).ok().map(Some),
        _ => None,
    }
}

fn reply<T: serde::Serialize>(read: Result<T, Reason>) -> Response {
    match read {
        Ok(value) => Response::json(200, &value),
        Err(reason) => error(&reason),
    }
}

fn status_of(reason: &Reason) -> u16 {
    match reason {
        Reason::Forbidden { .. } => 403,
        Reason::NotFound => 404,
        Reason::Storage => 503,
        _ => 400,
    }
}

fn error(reason: &Reason) -> Response {
    Response::json(status_of(reason), &json!({ "error": { "code": reason.code(), "reason": reason } }))
}

fn malformed() -> Response {
    Response::error(400, "malformed", "the request does not have the shape the route takes")
}
