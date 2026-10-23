//! The live connections of one Akteur, as a state machine without sockets: events in (a device connects, sends a frame, goes; a command was pushed
//! over HTTP; rights ended; time passed), instructions out ([`Out`]: send this frame, remember this connection, close this one). The Durable Object does
//! nothing but carry the instructions out, so everything that matters here is tested natively.
use super::{
    link::Link,
    live::{self, Conn, Kick, Rate},
};
use flyermap_aktion::{Aktion, Handled, Sql};
use flyermap_protocol::{ProtocolError, ServerFrame, ServerMsg};
use std::collections::HashMap;

/// What the host has to do.
#[derive(Clone, Debug, PartialEq)]
pub enum Out {
    /// Send this frame to the connection.
    Send(String, ServerFrame),
    /// Keep (or update) this connection's row: it survives the Durable Object sleeping.
    Store(Conn),
    /// Close the connection and forget its row.
    Close(String),
}

#[derive(Default)]
pub struct Channel {
    conns: Vec<Conn>,
    rates: HashMap<String, Rate>,
}

impl Channel {
    /// The connections that were open when the Durable Object went to sleep.
    pub fn with(conns: Vec<Conn>) -> Channel {
        Channel { conns, rates: HashMap::new() }
    }

    pub fn conns(&self) -> &[Conn] {
        &self.conns
    }

    /// A device connected: it is greeted, and the others learn who is online. It hears no news until it subscribes.
    pub fn open<S: Sql>(&mut self, a: &Aktion<S>, id: &str, link: Link, now: u64) -> Vec<Out> {
        let conn = Conn { id: id.to_string(), link, subscribed: false };
        let mut out = vec![Out::Send(conn.id.clone(), live::hello(a, &conn, now)), Out::Store(conn.clone())];
        self.conns.push(conn);
        out.extend(self.presence());
        out
    }

    /// A frame (as text) from a connection.
    pub fn frame<S: Sql>(&mut self, a: &mut Aktion<S>, id: &str, text: &str, now: u64) -> Vec<Out> {
        let Some(at) = self.conns.iter().position(|c| c.id == id) else { return vec![Out::Close(id.to_string())] };
        if !self.rates.entry(id.to_string()).or_default().allow(now) {
            return self.drop_with(id, ProtocolError::Slow);
        }
        let was = self.conns[at].subscribed;
        let handling = live::on_frame(a, &mut self.conns[at], text, now);
        if let Some(code) = handling.close {
            return self.drop_with(id, code);
        }
        let mut out: Vec<Out> = handling.reply.into_iter().map(|f| Out::Send(id.to_string(), f)).collect();
        out.extend(self.fan_out(&handling.handled, now));
        if self.conns[at].subscribed != was {
            out.push(Out::Store(self.conns[at].clone()));
            out.extend(self.presence());
        }
        out
    }

    /// The device went (or the socket broke).
    pub fn closed(&mut self, id: &str) -> Vec<Out> {
        self.rates.remove(id);
        let before = self.conns.len();
        self.conns.retain(|c| c.id != id);
        let mut out = vec![Out::Close(id.to_string())];
        if self.conns.len() != before {
            out.extend(self.presence());
        }
        out
    }

    /// Commands that were pushed over HTTP: the news goes to the subscribed connections.
    pub fn pushed(&self, handled: &[Handled], now: u64) -> Vec<Out> {
        self.fan_out(handled, now)
    }

    /// Rights ended: the connections `kick` names are dropped.
    pub fn kick(&mut self, kick: &Kick) -> Vec<Out> {
        let gone: Vec<String> = self.conns.iter().filter(|c| kick.hits(&c.link)).map(|c| c.id.clone()).collect();
        self.drop_all(gone, ProtocolError::Forbidden)
    }

    /// Time passed: connections whose grants have run out are dropped.
    pub fn sweep(&mut self, now: u64) -> Vec<Out> {
        let gone: Vec<String> = live::lapsed(&self.conns, now).iter().map(|c| c.id.clone()).collect();
        self.drop_all(gone, ProtocolError::Forbidden)
    }

    fn fan_out(&self, handled: &[Handled], now: u64) -> Vec<Out> {
        live::fan_out(handled, &self.conns, now).into_iter().map(|(id, frame)| Out::Send(id, frame)).collect()
    }

    fn presence(&self) -> Vec<Out> {
        let frame = live::presence(&self.conns);
        self.conns.iter().filter(|c| c.subscribed).map(|c| Out::Send(c.id.clone(), frame.clone())).collect()
    }

    fn drop_with(&mut self, id: &str, code: ProtocolError) -> Vec<Out> {
        self.drop_all(vec![id.to_string()], code)
    }

    /// Tell each one why, close it, and tell the rest who is left.
    fn drop_all(&mut self, ids: Vec<String>, code: ProtocolError) -> Vec<Out> {
        if ids.is_empty() {
            return Vec::new();
        }
        let mut out = Vec::new();
        for id in &ids {
            self.rates.remove(id);
            out.push(Out::Send(id.clone(), ServerFrame::new(ServerMsg::Error { code })));
            out.push(Out::Close(id.clone()));
        }
        self.conns.retain(|c| !ids.contains(&c.id));
        out.extend(self.presence());
        out
    }
}
