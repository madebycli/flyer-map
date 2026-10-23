//! The Durable Object of one Aktion: the Akteur with its SQLite, and the sockets of the devices that are connected. It carries out what the native parts
//! decide: [`serve`] answers requests, [`Channel`] decides what the sockets are told, and this file does the sending, the sleeping and the alarm.
//!
//! Sockets use the runtime's hibernation: the object may sleep with devices connected and wakes for a frame. What it needs to know about a connection
//! then is in its table (`conns`), not in memory.
use super::{convert, sql::DoSql};
use crate::akteur::{
    channel::{Channel, Out},
    conns,
    link::{Link, HEADER},
    serve::serve,
    Kick,
};
use flyermap_aktion::{Aktion, Limits};
use flyermap_host::http::request::Request;
use flyermap_identity::{AktionId, OrgId};
use std::cell::RefCell;
use worker::{
    durable_object, js_sys, Date, DurableObject, Env, Method, Request as CfRequest, Response, Result, State, WebSocket, WebSocketIncomingMessage, WebSocketPair,
};

/// How soon the alarm looks again while there is something to look after (connections to check, a log to compact).
const ALARM_MS: u64 = 60_000;

struct Host {
    actor: Aktion<DoSql>,
    channel: Channel,
}

#[durable_object]
pub struct AktionObject {
    state: State,
    host: RefCell<Option<Host>>,
}

fn now() -> u64 {
    Date::now().as_millis()
}

fn failure(e: impl std::fmt::Display) -> worker::Error {
    worker::Error::RustError(e.to_string())
}

impl AktionObject {
    /// Run `f` with the Akteur and the channel. `link` names the Aktion for a request; without one (a socket woke the object) it is read from a stored
    /// connection. `None`: there is nobody to speak to and nothing to open.
    fn with_host<T>(&self, link: Option<&Link>, f: impl FnOnce(&mut Host) -> T) -> Result<Option<T>> {
        let mut slot = self.host.borrow_mut();
        if slot.is_none() {
            let mut sql = DoSql::new(&self.state).map_err(failure)?;
            conns::install(&mut sql).map_err(failure)?;
            // a row whose socket the runtime no longer holds (the object crashed, a new version was deployed) is not a connection: it would show as online forever
            let held: Vec<String> = self.state.get_websockets().iter().flat_map(|socket| self.state.get_tags(socket)).collect();
            let (stored, orphaned): (Vec<_>, Vec<_>) = conns::load(&mut sql).map_err(failure)?.into_iter().partition(|c| held.contains(&c.id));
            for conn in &orphaned {
                conns::forget(&mut sql, &conn.id).map_err(failure)?;
            }
            let Some(link) = link.cloned().or_else(|| stored.first().map(|c| c.link.clone())) else { return Ok(None) };
            let actor = Aktion::open(sql, OrgId::new(&link.org), AktionId::new(&link.aktion), Limits::default()).map_err(failure)?;
            *slot = Some(Host { actor, channel: Channel::with(stored) });
        }
        Ok(slot.as_mut().map(f))
    }

    /// Do what the channel decided: send frames, keep rows, close sockets.
    fn carry_out(&self, host: &mut Host, outs: Vec<Out>) {
        for out in outs {
            match out {
                Out::Send(id, frame) => {
                    let Ok(text) = serde_json::to_string(&frame) else { continue };
                    for socket in self.state.get_websockets_with_tag(&id) {
                        let _ = socket.send_with_str(&text);
                    }
                }
                Out::Store(conn) => {
                    if let Err(e) = conns::store(host.actor.storage_mut(), &conn) {
                        worker::console_error!("conn store failed: {e}");
                    }
                }
                Out::Close(id) => {
                    for socket in self.state.get_websockets_with_tag(&id) {
                        let _ = socket.close(Some(1008), Some("closed"));
                    }
                    if let Err(e) = conns::forget(host.actor.storage_mut(), &id) {
                        worker::console_error!("conn forget failed: {e}");
                    }
                }
            }
        }
    }

    /// Make sure the alarm will look at this Aktion soon.
    async fn watch(&self) {
        let storage = self.state.storage();
        if matches!(storage.get_alarm().await, Ok(None)) {
            let _ = storage.set_alarm(std::time::Duration::from_millis(ALARM_MS)).await;
        }
    }

    async fn upgrade(&self, link: Link) -> Result<Response> {
        let pair = WebSocketPair::new()?;
        let id = format!("{:016x}{:016x}", (js_sys::Math::random() * 1.8e19) as u64, now());
        // not `accept()`: the runtime keeps the socket across sleep
        self.state.accept_websocket_with_tags(&pair.server, &[&id]);
        let outs = self.with_host(Some(&link), |h| {
            let outs = h.channel.open(&h.actor, &id, link.clone(), now());
            self.carry_out(h, outs);
        })?;
        outs.ok_or_else(|| failure("no Akteur"))?;
        self.watch().await;
        Response::from_websocket(pair.client)
    }

    async fn push(&self, request: Request, link: Link) -> Result<Response> {
        let done = self.with_host(Some(&link), |h| {
            let served = serve(&mut h.actor, &link, now(), &request);
            let outs = h.channel.pushed(&served.handled, now());
            self.carry_out(h, outs);
            served.response
        })?;
        self.watch().await;
        convert::response_of(done.ok_or_else(|| failure("no Akteur"))?)
    }

    fn kick(&self, request: &Request) -> Result<Response> {
        let Ok(kick) = serde_json::from_slice::<Kick>(&request.body) else { return Response::error("malformed", 400) };
        self.with_host(None, |h| {
            let outs = h.channel.kick(&kick);
            self.carry_out(h, outs);
        })?;
        Response::ok("ok")
    }
}

impl DurableObject for AktionObject {
    fn new(state: State, _env: Env) -> Self {
        AktionObject { state, host: RefCell::new(None) }
    }

    async fn fetch(&self, mut req: CfRequest) -> Result<Response> {
        let request = convert::request_of(&mut req).await?;
        #[cfg(feature = "probe")]
        if request.path() == "/probe" {
            let mut sql = DoSql::new(&self.state).map_err(failure)?;
            return Response::from_json(&super::probe::run(&mut sql));
        }
        if request.path() == "/kick" && request.method == "POST" {
            return self.kick(&request);
        }
        let Some(link) = request.header(HEADER).and_then(Link::decode_unbound) else { return Response::error("no link", 400) };
        if request.path() == "/live" && matches!(req.method(), Method::Get) && request.header("upgrade") == Some("websocket") {
            return self.upgrade(link).await;
        }
        self.push(request, link).await
    }

    async fn websocket_message(&self, ws: WebSocket, message: WebSocketIncomingMessage) -> Result<()> {
        let WebSocketIncomingMessage::String(text) = message else {
            let _ = ws.close(Some(1003), Some("text frames only"));
            return Ok(());
        };
        let Some(id) = self.state.get_tags(&ws).into_iter().next() else { return Ok(()) };
        self.with_host(None, |h| {
            let outs = h.channel.frame(&mut h.actor, &id, &text, now());
            self.carry_out(h, outs);
        })?;
        self.watch().await;
        Ok(())
    }

    async fn websocket_close(&self, ws: WebSocket, _code: usize, _reason: String, _was_clean: bool) -> Result<()> {
        let _ = ws.close(Some(1000), Some("bye"));
        self.gone(&ws)
    }

    async fn websocket_error(&self, ws: WebSocket, _error: worker::Error) -> Result<()> {
        self.gone(&ws)
    }

    async fn alarm(&self) -> Result<Response> {
        let open = self.with_host(None, |h| {
            let outs = h.channel.sweep(now());
            self.carry_out(h, outs);
            if let Err(e) = h.actor.compact() {
                worker::console_error!("compact failed: {}", e.0);
            }
            !h.channel.conns().is_empty()
        })?;
        if open == Some(true) {
            self.watch().await;
        }
        Response::ok("ok")
    }
}

impl AktionObject {
    fn gone(&self, ws: &WebSocket) -> Result<()> {
        let Some(id) = self.state.get_tags(ws).into_iter().next() else { return Ok(()) };
        self.with_host(None, |h| {
            let outs = h.channel.closed(&id);
            self.carry_out(h, outs);
        })?;
        Ok(())
    }
}
