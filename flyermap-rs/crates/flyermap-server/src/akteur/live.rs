//! The live channel without a socket in sight: what a frame from a device does, whom an Akteur's news goes to, who is online. The Durable Object keeps
//! the sockets and the table of [`Conn`]; everything it has to decide it asks here, so the whole channel is tested natively.
//!
//! A device that has said `Subscribe` is told every new entry it may see (the Akteur's `Audience` decides, by `decide`, per entry). A device that is
//! not (or no longer) allowed into the Aktion is told so and dropped. Nothing a connection says is trusted beyond its [`Link`](super::link::Link).
use super::link::Link;
use flyermap_aktion::{Aktion, Handled, Sql};
use flyermap_identity::{may_enter, AktionId, OrgId};
use flyermap_protocol::{limits::MAX_PAGE_ENTRIES, Catchup, ClientFrame, ClientMsg, Entry, Online, Presence, ProtocolError, ServerFrame, ServerMsg, You};
use serde::{Deserialize, Serialize};

/// Pages of catch-up sent after a `Subscribe` before the device is told to take a snapshot instead.
const MAX_CATCHUP_PAGES: usize = 20;
/// Frames a connection may send per window: a device batches its edits, so this is far above any honest use.
const RATE_FRAMES: u32 = 60;
const RATE_WINDOW_MS: u64 = 10_000;

/// One open connection: who it is and whether it wants the feed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Conn {
    pub id: String,
    pub link: Link,
    pub subscribed: bool,
}

/// What a frame from a connection leads to.
#[derive(Debug, Default)]
pub struct Handling {
    /// Frames for the sender, in order.
    pub reply: Vec<ServerFrame>,
    /// Commands that changed something: to be told to the subscribed connections with [`fan_out`].
    pub handled: Vec<Handled>,
    /// The channel cannot go on: send the error and close.
    pub close: Option<ProtocolError>,
    /// The sender is subscribed now (the host stores it).
    pub subscribed: bool,
}

impl Handling {
    fn closing(code: ProtocolError) -> Handling {
        Handling { close: Some(code), ..Handling::default() }
    }
}

fn org(conn: &Conn) -> OrgId {
    OrgId::new(&conn.link.org)
}

fn aktion(conn: &Conn) -> AktionId {
    AktionId::new(&conn.link.aktion)
}

/// The first frame of a connection.
pub fn hello<S: Sql>(a: &Aktion<S>, conn: &Conn, now: u64) -> ServerFrame {
    ServerFrame::new(ServerMsg::Hello { head: a.head(), floor: a.floor(), server_now: now, you: You { principal: conn.link.principal.clone() } })
}

/// A frame (as text) from `conn`. A malformed frame, one of another version, one from a caller who may not be here any more, ends the channel.
pub fn on_frame<S: Sql>(a: &mut Aktion<S>, conn: &mut Conn, text: &str, now: u64) -> Handling {
    if !may_enter(&conn.link.access, now, &org(conn), &aktion(conn)) {
        return Handling::closing(ProtocolError::Forbidden);
    }
    let Ok(frame) = serde_json::from_str::<ClientFrame>(text) else { return Handling::closing(ProtocolError::Malformed) };
    if !frame.is_supported() {
        return Handling::closing(ProtocolError::Version);
    }
    let caller = conn.link.caller();
    match frame.msg {
        ClientMsg::Ping { n } => Handling { reply: vec![ServerFrame::new(ServerMsg::Pong { n })], subscribed: conn.subscribed, ..Handling::default() },
        ClientMsg::Command { command } => {
            let done = a.handle(&caller, command, now);
            let reply = vec![ServerFrame::new(ServerMsg::Answer { answer: done.reply.clone(), head: done.head })];
            let handled = if done.broadcast.is_empty() { Vec::new() } else { vec![done] };
            Handling { reply, handled, subscribed: conn.subscribed, ..Handling::default() }
        }
        ClientMsg::Subscribe { since } => {
            conn.subscribed = true;
            Handling { reply: since.map(|s| catch_up(a, conn, now, s)).unwrap_or_default(), subscribed: true, ..Handling::default() }
        }
    }
}

/// What happened after `since`, as frames: pages of entries, or a request for a snapshot.
fn catch_up<S: Sql>(a: &mut Aktion<S>, conn: &Conn, now: u64, since: u64) -> Vec<ServerFrame> {
    let caller = conn.link.caller();
    let (mut frames, mut from) = (Vec::new(), since);
    for _ in 0..MAX_CATCHUP_PAGES {
        match a.catchup(&caller, now, from, MAX_PAGE_ENTRIES) {
            Ok(Catchup::Entries { entries, next, head, more }) => {
                if !entries.is_empty() {
                    frames.push(ServerFrame::new(ServerMsg::Entries { entries, head }));
                }
                if !more {
                    return frames;
                }
                from = next;
            }
            Ok(Catchup::Resync { head, floor }) => return vec![ServerFrame::new(ServerMsg::Resync { head, floor })],
            Err(_) => return vec![ServerFrame::new(ServerMsg::Error { code: ProtocolError::Forbidden })],
        }
    }
    vec![ServerFrame::new(ServerMsg::Resync { head: a.head(), floor: a.floor() })]
}

/// The news of commands for every subscribed connection: `(connection id, frame)`, each cut to what that caller may see. When a command changed who
/// may read a Gebiet, every subscribed device is also told to take a new snapshot: one that lost the right is not shown the entry that took it away
/// (it is about a Gebiet it may not see any more), and would otherwise keep what it had.
pub fn fan_out(handled: &[Handled], conns: &[Conn], now: u64) -> Vec<(String, ServerFrame)> {
    let mut out = Vec::new();
    for conn in conns.iter().filter(|c| c.subscribed) {
        let caller = conn.link.caller();
        for h in handled {
            let entries: Vec<Entry> = h.audience.filter(&caller, now, &h.broadcast);
            if !entries.is_empty() {
                out.push((conn.id.clone(), ServerFrame::new(ServerMsg::Entries { entries, head: h.head })));
            }
            if h.rights_moved {
                out.push((conn.id.clone(), ServerFrame::new(ServerMsg::Resync { head: h.head, floor: h.floor })));
            }
        }
    }
    out
}

/// Who is online: the devices' principals, each once. Which Lauf a person is in is not known to the channel; `lauf` stays empty until the Akteur says.
pub fn presence(conns: &[Conn]) -> ServerFrame {
    let mut names: Vec<&str> = conns.iter().map(|c| c.link.principal.as_str()).collect();
    names.sort_unstable();
    names.dedup();
    ServerFrame::new(ServerMsg::Presence {
        presence: Presence { online: names.into_iter().map(|p| Online { principal: p.to_string(), lauf: None }).collect() },
    })
}

/// Connections whose caller may not be in this Aktion any more (a grant ran out): the alarm closes them.
pub fn lapsed(conns: &[Conn], now: u64) -> Vec<&Conn> {
    conns.iter().filter(|c| !may_enter(&c.link.access, now, &org(c), &aktion(c))).collect()
}

/// Whom to drop when rights end: a person (all their devices), one session, or all of a person's sessions but one (signing the other devices out).
/// The edge sends it when a grant or a session is revoked.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Kick {
    #[serde(default)]
    pub principal: Option<String>,
    #[serde(default)]
    pub session: Option<String>,
    #[serde(default)]
    pub except_session: Option<String>,
}

impl Kick {
    pub fn person(principal: &str) -> Kick {
        Kick { principal: Some(principal.into()), ..Kick::default() }
    }

    pub fn session(principal: &str, session: &str) -> Kick {
        Kick { principal: Some(principal.into()), session: Some(session.into()), ..Kick::default() }
    }

    pub fn others(principal: &str, keep: &str) -> Kick {
        Kick { principal: Some(principal.into()), except_session: Some(keep.into()), ..Kick::default() }
    }

    /// A kick that names neither a person nor a session hits nobody (never everybody).
    pub fn hits(&self, link: &Link) -> bool {
        (self.principal.is_some() || self.session.is_some())
            && self.principal.as_ref().is_none_or(|p| *p == link.principal)
            && self.session.as_ref().is_none_or(|s| *s == link.session)
            && self.except_session.as_ref().is_none_or(|s| *s != link.session)
    }
}

/// Frames per window, per connection. Lives in the host's memory: a connection that wakes from hibernation starts a fresh window.
#[derive(Clone, Copy, Debug, Default)]
pub struct Rate {
    /// When the window began: `None` until the first frame.
    start: Option<u64>,
    count: u32,
}

impl Rate {
    /// `false` when this frame is one too many.
    pub fn allow(&mut self, now: u64) -> bool {
        if self.start.is_none_or(|start| now.saturating_sub(start) >= RATE_WINDOW_MS) {
            *self = Rate { start: Some(now), count: 0 };
        }
        self.count += 1;
        self.count <= RATE_FRAMES
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flyermap_identity::{AccessSet, Grant, Role, Scope};

    fn conn(id: &str, principal: &str, session: &str, grants: Vec<Grant>) -> Conn {
        Conn { id: id.into(), link: Link::new("o1", "a1", principal, session, &AccessSet::new(grants)), subscribed: true }
    }
    fn admin() -> Grant {
        Grant::new(Role::Admin, Scope::Aktion { org: OrgId::new("o1"), aktion: AktionId::new("a1") })
    }

    #[test]
    fn an_empty_kick_hits_nobody_and_a_full_one_only_what_it_names() {
        let c = conn("c", "per_1", "ses_1", vec![admin()]);
        assert!(!Kick::default().hits(&c.link), "nothing named, nobody hit");
        assert!(Kick::person("per_1").hits(&c.link));
        assert!(Kick { session: Some("ses_1".into()), ..Kick::default() }.hits(&c.link));
        assert!(!Kick::session("per_1", "ses_2").hits(&c.link), "both must match");
        assert!(!Kick { principal: Some("per_2".into()), ..Kick::default() }.hits(&c.link));
        assert!(Kick::others("per_1", "ses_2").hits(&c.link), "the other devices go");
        assert!(!Kick::others("per_1", "ses_1").hits(&c.link), "the device that asked stays");
        assert!(!Kick { except_session: Some("ses_9".into()), ..Kick::default() }.hits(&c.link), "an exception alone names nobody");
    }

    #[test]
    fn the_rate_allows_a_burst_and_starts_over_with_the_next_window() {
        let mut rate = Rate::default();
        assert!((0..RATE_FRAMES).all(|_| rate.allow(1_000)));
        assert!(!rate.allow(1_000 + RATE_WINDOW_MS - 1), "one too many inside the window");
        assert!(rate.allow(1_000 + RATE_WINDOW_MS), "the window is over");
    }

    #[test]
    fn presence_names_each_principal_once() {
        let conns = [conn("1", "per_b", "s1", vec![admin()]), conn("2", "per_a", "s2", vec![admin()]), conn("3", "per_b", "s3", vec![admin()])];
        let ServerMsg::Presence { presence } = presence(&conns).msg else { panic!("not a presence frame") };
        let names: Vec<_> = presence.online.iter().map(|o| o.principal.as_str()).collect();
        assert_eq!(names, ["per_a", "per_b"]);
    }

    #[test]
    fn a_grant_that_ran_out_lapses_the_connection() {
        let conns = [conn("1", "per_a", "s1", vec![admin().until(1_000)]), conn("2", "per_b", "s2", vec![admin()])];
        assert!(lapsed(&conns, 999).is_empty());
        let gone: Vec<_> = lapsed(&conns, 1_000).iter().map(|c| c.id.as_str()).collect();
        assert_eq!(gone, ["1"]);
    }
}
